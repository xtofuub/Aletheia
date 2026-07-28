use std::{
    collections::HashMap,
    fs::{self, File},
    io::{BufRead, BufReader, Read},
    path::Path,
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

use encoding_rs::{Encoding, UTF_8};
use flate2::read::GzDecoder;
use rusqlite::{Connection, params};
use serde_json::{Map, Value};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::{
    domain_analysis::{
        NormalizedDomain, NormalizedUrl, normalize_domain, normalize_url, store_domain,
    },
    models::{
        DatasetSummary, FieldMapping, FieldType, FileInspection, ImportPlan, ImportProgress,
        ImportStartResult, SourceFormat,
    },
    search_index::{SearchIndex, make_document},
    storage::{AppState, JobControl},
};

const MAX_LINE_BYTES: usize = 1024 * 1024;
const MAX_FIELD_BYTES: usize = 256 * 1024;
const MAX_FIELDS: usize = 256;
const MAX_JSON_DEPTH: usize = 32;
const MAX_DECOMPRESSION_RATIO: u64 = 100;
const MIN_DECOMPRESSION_LIMIT: u64 = 64 * 1024 * 1024;
const BATCH_RECORDS: usize = 1_000;
const PARSER_VERSION: &str = "aletheia-parser/1";

#[derive(Clone)]
struct WorkerFile {
    id: String,
    inspection: FileInspection,
}

struct ProcessedField {
    name: String,
    field_type: FieldType,
    original: String,
    normalized: String,
    sensitive: bool,
    confidence: f32,
}

struct ProcessedRecord {
    id: String,
    source_location: String,
    byte_offset: Option<u64>,
    fingerprint: String,
    fields: Vec<ProcessedField>,
    domains: Vec<(NormalizedDomain, Option<NormalizedUrl>)>,
}

struct Counters {
    bytes_read: u64,
    records_processed: u64,
    records_indexed: u64,
    invalid_records: u64,
    duplicate_records: u64,
}

#[tauri::command]
pub async fn start_import(
    plan: ImportPlan,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<ImportStartResult, String> {
    validate_plan(&plan)?;
    let (worker_limit, memory_limit_mb) = import_resource_limits(&state.database)?;
    if state
        .jobs
        .lock()
        .map_err(|_| "import job registry is unavailable".to_string())?
        .len()
        >= worker_limit as usize
    {
        return Err("the configured local worker limit is already in use".to_string());
    }
    let dataset_id = Uuid::new_v4().to_string();
    let job_id = Uuid::new_v4().to_string();
    let total_bytes = plan.files.iter().map(|file| file.file_size).sum::<u64>();
    let worker_files = prepare_database_rows(&state.database, &dataset_id, &job_id, &plan)?;
    let control = Arc::new(JobControl::default());
    state
        .jobs
        .lock()
        .map_err(|_| "import job registry is unavailable".to_string())?
        .insert(job_id.clone(), control.clone());

    let database = state.database.clone();
    let storage_root = state
        .current_storage_root()
        .map_err(|_| "storage location is unavailable".to_string())?;
    let jobs = state.jobs.clone();
    let result = ImportStartResult {
        job_id: job_id.clone(),
        dataset_id: dataset_id.clone(),
    };
    tauri::async_runtime::spawn_blocking(move || {
        let run_result = run_import(
            Some(&app),
            &database,
            &storage_root,
            &job_id,
            &dataset_id,
            total_bytes,
            memory_limit_mb,
            worker_files,
            &plan,
            &control,
        );
        if let Err(error) = run_result {
            mark_failed(&database, &job_id, &dataset_id);
            let _ = app.emit(
                "import-progress",
                ImportProgress {
                    job_id: job_id.clone(),
                    dataset_id: dataset_id.clone(),
                    status: "failed".to_string(),
                    current_file: None,
                    bytes_read: 0,
                    total_bytes,
                    records_processed: 0,
                    records_indexed: 0,
                    invalid_records: 0,
                    duplicate_records: 0,
                    message: error,
                },
            );
        }
        if let Ok(mut registry) = jobs.lock() {
            registry.remove(&job_id);
        }
    });
    Ok(result)
}

#[tauri::command]
pub fn pause_import(job_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let registry = state
        .jobs
        .lock()
        .map_err(|_| "import job registry is unavailable".to_string())?;
    let control = registry
        .get(&job_id)
        .ok_or_else(|| "import job is no longer active".to_string())?;
    control.set_paused(true);
    update_job_status(&state.database, &job_id, "paused")
}

#[tauri::command]
pub fn resume_import(job_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let registry = state
        .jobs
        .lock()
        .map_err(|_| "import job registry is unavailable".to_string())?;
    let control = registry
        .get(&job_id)
        .ok_or_else(|| "import job is no longer active".to_string())?;
    control.set_paused(false);
    update_job_status(&state.database, &job_id, "running")
}

#[tauri::command]
pub fn cancel_import(job_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let registry = state
        .jobs
        .lock()
        .map_err(|_| "import job registry is unavailable".to_string())?;
    let control = registry
        .get(&job_id)
        .ok_or_else(|| "import job is no longer active".to_string())?;
    control.cancel();
    update_job_status(&state.database, &job_id, "cancelling")
}

#[tauri::command]
pub fn list_datasets(state: State<'_, AppState>) -> Result<Vec<DatasetSummary>, String> {
    let connection = state
        .database
        .lock()
        .map_err(|_| "metadata database is unavailable".to_string())?;
    let mut statement = connection
        .prepare(
            "SELECT id, name, status, record_count, file_count, total_bytes,
                    warning_count, created_at, last_indexed_at
             FROM datasets ORDER BY created_at DESC",
        )
        .map_err(sanitized)?;
    let rows = statement
        .query_map([], |row| {
            Ok(DatasetSummary {
                id: row.get(0)?,
                name: row.get(1)?,
                status: row.get(2)?,
                record_count: row.get::<_, i64>(3)? as u64,
                file_count: row.get::<_, i64>(4)? as u64,
                total_bytes: row.get::<_, i64>(5)? as u64,
                warning_count: row.get::<_, i64>(6)? as u64,
                created_at: row.get(7)?,
                last_indexed_at: row.get(8)?,
            })
        })
        .map_err(sanitized)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(sanitized)
}

fn validate_plan(plan: &ImportPlan) -> Result<(), String> {
    if plan.dataset_label.trim().is_empty() || plan.dataset_label.len() > 160 {
        return Err("dataset label must contain 1 to 160 characters".to_string());
    }
    if plan.authorization_note.trim().is_empty() || plan.authorization_note.len() > 500 {
        return Err("authorization note must contain 1 to 500 characters".to_string());
    }
    if plan.files.is_empty() || plan.files.len() > 10_000 {
        return Err("select between 1 and 10,000 source files".to_string());
    }
    Ok(())
}

fn import_resource_limits(database: &Arc<Mutex<Connection>>) -> Result<(u32, u32), String> {
    let connection = database
        .lock()
        .map_err(|_| "metadata database is unavailable".to_string())?;
    let read = |key: &str, fallback: u32| -> u32 {
        connection
            .query_row(
                "SELECT value_json FROM settings WHERE key = ?1",
                [key],
                |row| row.get::<_, String>(0),
            )
            .ok()
            .and_then(|value| serde_json::from_str::<u32>(&value).ok())
            .unwrap_or(fallback)
    };
    Ok((
        read("worker_limit", 2).clamp(1, 8),
        read("memory_limit_mb", 512).clamp(256, 8192),
    ))
}

fn prepare_database_rows(
    database: &Arc<Mutex<Connection>>,
    dataset_id: &str,
    job_id: &str,
    plan: &ImportPlan,
) -> Result<Vec<WorkerFile>, String> {
    let mut connection = database
        .lock()
        .map_err(|_| "metadata database is unavailable".to_string())?;
    let transaction = connection.transaction().map_err(sanitized)?;
    let total_bytes = plan.files.iter().map(|file| file.file_size).sum::<u64>();
    transaction
        .execute(
            "INSERT INTO datasets(
                id, name, authorization_note, status, file_count, total_bytes, parser_version
             ) VALUES (?1, ?2, ?3, 'queued', ?4, ?5, ?6)",
            params![
                dataset_id,
                plan.dataset_label.trim(),
                plan.authorization_note.trim(),
                plan.files.len() as i64,
                total_bytes as i64,
                PARSER_VERSION
            ],
        )
        .map_err(sanitized)?;
    transaction
        .execute(
            "INSERT INTO import_jobs(id, dataset_id, status, total_bytes)
             VALUES (?1, ?2, 'queued', ?3)",
            params![job_id, dataset_id, total_bytes as i64],
        )
        .map_err(sanitized)?;

    let mut worker_files = Vec::with_capacity(plan.files.len());
    for inspection in &plan.files {
        let path = fs::canonicalize(&inspection.absolute_path)
            .map_err(|_| "a selected source is no longer available".to_string())?;
        let metadata = fs::metadata(&path)
            .map_err(|_| "a selected source is no longer available".to_string())?;
        if !metadata.is_file() || metadata.len() != inspection.file_size {
            return Err("a selected source changed after inspection".to_string());
        }
        let file_id = Uuid::new_v4().to_string();
        transaction
            .execute(
                "INSERT INTO source_files(
                    id, dataset_id, absolute_path, relative_path, file_size, format,
                    encoding, delimiter, modified_at, index_status
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'pending')",
                params![
                    file_id,
                    dataset_id,
                    path.to_string_lossy(),
                    inspection.relative_path,
                    inspection.file_size as i64,
                    format_name(inspection.format),
                    inspection.encoding,
                    inspection.delimiter,
                    inspection.modified_at,
                ],
            )
            .map_err(sanitized)?;
        for mapping in &inspection.mappings {
            transaction
                .execute(
                    "INSERT INTO field_mappings(
                        source_file_id, source_name, field_type, confidence, is_sensitive
                     ) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![
                        file_id,
                        mapping.source_name,
                        mapping.field_type.as_str(),
                        mapping.confidence,
                        mapping.is_sensitive,
                    ],
                )
                .map_err(sanitized)?;
        }
        let mut cloned = inspection.clone();
        cloned.absolute_path = path.to_string_lossy().into_owned();
        worker_files.push(WorkerFile {
            id: file_id,
            inspection: cloned,
        });
    }
    transaction.commit().map_err(sanitized)?;
    Ok(worker_files)
}

#[allow(clippy::too_many_arguments)]
fn run_import(
    app: Option<&AppHandle>,
    database: &Arc<Mutex<Connection>>,
    storage_root: &Path,
    job_id: &str,
    dataset_id: &str,
    total_bytes: u64,
    memory_limit_mb: u32,
    files: Vec<WorkerFile>,
    plan: &ImportPlan,
    control: &JobControl,
) -> Result<(), String> {
    update_job_status(database, job_id, "running")?;
    update_dataset_status(database, dataset_id, "indexing")?;
    let search = SearchIndex::open_or_create(storage_root)?;
    let writer_memory =
        ((memory_limit_mb as usize * 1024 * 1024) / 4).clamp(15_000_000, 256_000_000);
    let mut writer = search.writer_with_memory(writer_memory)?;
    let mut counters = Counters {
        bytes_read: 0,
        records_processed: 0,
        records_indexed: 0,
        invalid_records: 0,
        duplicate_records: 0,
    };
    let mut last_emit = Instant::now();

    for file in files {
        if control.is_cancelled() {
            writer.commit().map_err(sanitized)?;
            return finish_cancelled(app, database, job_id, dataset_id, total_bytes, &counters);
        }
        mark_file(database, job_id, &file.id, "indexing")?;
        let mut batch = Vec::with_capacity(BATCH_RECORDS);
        let stream_result = stream_file(&file, plan, control, &mut counters, |record, counters| {
            batch.push(record);
            if batch.len() >= BATCH_RECORDS {
                flush_batch(
                    database,
                    &mut writer,
                    search.fields,
                    dataset_id,
                    &file,
                    plan,
                    counters,
                    &mut batch,
                )?;
                if last_emit.elapsed() >= Duration::from_millis(150) {
                    emit_progress(
                        app,
                        job_id,
                        dataset_id,
                        total_bytes,
                        Some(&file.inspection.file_name),
                        "running",
                        "Indexing local records",
                        counters,
                    );
                    last_emit = Instant::now();
                }
            }
            Ok(())
        });
        if control.is_cancelled() {
            writer.commit().map_err(sanitized)?;
            return finish_cancelled(app, database, job_id, dataset_id, total_bytes, &counters);
        }
        stream_result?;
        flush_batch(
            database,
            &mut writer,
            search.fields,
            dataset_id,
            &file,
            plan,
            &mut counters,
            &mut batch,
        )?;
        mark_file(database, job_id, &file.id, "indexed")?;
    }

    if control.is_cancelled() {
        writer.commit().map_err(sanitized)?;
        return finish_cancelled(app, database, job_id, dataset_id, total_bytes, &counters);
    }
    writer.commit().map_err(sanitized)?;
    if plan.options.group_identities {
        let connection = database
            .lock()
            .map_err(|_| "metadata database is unavailable".to_string())?;
        materialize_identities(&connection)?;
    }
    let connection = database
        .lock()
        .map_err(|_| "metadata database is unavailable".to_string())?;
    connection
        .execute(
            "UPDATE datasets SET status = 'ready', record_count = ?2,
                    warning_count = ?3, last_indexed_at = CURRENT_TIMESTAMP
             WHERE id = ?1",
            params![
                dataset_id,
                counters.records_indexed as i64,
                counters.invalid_records as i64
            ],
        )
        .map_err(sanitized)?;
    connection
        .execute(
            "UPDATE import_jobs SET status = 'completed', bytes_read = ?2,
                    records_processed = ?3, records_indexed = ?4, invalid_records = ?5,
                    duplicate_records = ?6, finished_at = CURRENT_TIMESTAMP
             WHERE id = ?1",
            params![
                job_id,
                counters.bytes_read as i64,
                counters.records_processed as i64,
                counters.records_indexed as i64,
                counters.invalid_records as i64,
                counters.duplicate_records as i64,
            ],
        )
        .map_err(sanitized)?;
    drop(connection);
    emit_progress(
        app,
        job_id,
        dataset_id,
        total_bytes,
        None,
        "completed",
        "Index ready",
        &counters,
    );
    Ok(())
}

fn stream_file<F>(
    file: &WorkerFile,
    plan: &ImportPlan,
    control: &JobControl,
    counters: &mut Counters,
    mut on_record: F,
) -> Result<(), String>
where
    F: FnMut(ProcessedRecord, &mut Counters) -> Result<(), String>,
{
    let source = File::open(&file.inspection.absolute_path)
        .map_err(|_| "source file could not be opened read-only".to_string())?;
    let reader: Box<dyn Read> = if file.inspection.compressed {
        Box::new(GzDecoder::new(source))
    } else {
        Box::new(source)
    };
    let mut reader = BufReader::with_capacity(64 * 1024, reader);
    let encoding = Encoding::for_label(file.inspection.encoding.as_bytes()).unwrap_or(UTF_8);
    let decompression_limit =
        (file.inspection.file_size * MAX_DECOMPRESSION_RATIO).max(MIN_DECOMPRESSION_LIMIT);
    let mut line = Vec::with_capacity(4096);
    let mut line_number = 0_u64;
    let mut decompressed_bytes = 0_u64;
    loop {
        wait_if_paused(control)?;
        line.clear();
        let count = reader
            .read_until(b'\n', &mut line)
            .map_err(|_| "source read failed".to_string())?;
        if count == 0 {
            break;
        }
        line_number += 1;
        decompressed_bytes += count as u64;
        counters.bytes_read = counters.bytes_read.saturating_add(count as u64);
        if file.inspection.compressed && decompressed_bytes > decompression_limit {
            return Err("compressed source exceeded the safe decompression limit".to_string());
        }
        if line.len() > MAX_LINE_BYTES {
            counters.invalid_records += 1;
            if plan.options.stop_on_severe_error {
                return Err("a source line exceeded the 1 MiB safety limit".to_string());
            }
            continue;
        }
        while matches!(line.last(), Some(b'\n' | b'\r')) {
            line.pop();
        }
        if line.is_empty() {
            continue;
        }
        if file.inspection.has_header && line_number == 1 {
            continue;
        }
        counters.records_processed += 1;
        let (decoded, _, had_errors) = encoding.decode(&line);
        if had_errors && !plan.options.skip_invalid_rows {
            return Err("source contains undecodable records".to_string());
        }
        let values = match parse_values(&decoded, &file.inspection) {
            Ok(values) => values,
            Err(_) => {
                counters.invalid_records += 1;
                if plan.options.skip_invalid_rows {
                    continue;
                }
                return Err("source record did not match the approved mapping".to_string());
            }
        };
        let byte_offset = counters.bytes_read.saturating_sub(count as u64);
        let record = process_record(
            values,
            &file.inspection.mappings,
            format!("line {line_number}"),
            plan.options.store_offsets.then_some(byte_offset),
            plan.options.extract_domains,
            plan.options.extract_urls,
        )?;
        on_record(record, counters)?;
    }
    Ok(())
}

fn parse_values(text: &str, inspection: &FileInspection) -> Result<Vec<String>, ()> {
    let values = match inspection.format {
        SourceFormat::Jsonl => {
            let object = serde_json::from_str::<Map<String, Value>>(text).map_err(|_| ())?;
            if object
                .values()
                .any(|value| json_depth(value) > MAX_JSON_DEPTH)
            {
                return Err(());
            }
            inspection
                .mappings
                .iter()
                .map(|mapping| {
                    object
                        .get(&mapping.source_name)
                        .map(scalar_json)
                        .unwrap_or_default()
                })
                .collect()
        }
        SourceFormat::Csv | SourceFormat::Tsv | SourceFormat::Delimited => {
            let delimiter = delimiter_byte(inspection);
            let mut reader = csv::ReaderBuilder::new()
                .delimiter(delimiter)
                .has_headers(false)
                .flexible(true)
                .from_reader(text.as_bytes());
            let record = reader.records().next().ok_or(())?.map_err(|_| ())?;
            record.iter().map(ToString::to_string).collect()
        }
        SourceFormat::Text | SourceFormat::Gzip => vec![text.to_string()],
    };
    if values.len() > MAX_FIELDS || values.iter().any(|value| value.len() > MAX_FIELD_BYTES) {
        return Err(());
    }
    Ok(values)
}

fn json_depth(value: &Value) -> usize {
    match value {
        Value::Array(values) => 1 + values.iter().map(json_depth).max().unwrap_or(0),
        Value::Object(values) => 1 + values.values().map(json_depth).max().unwrap_or(0),
        _ => 1,
    }
}

fn process_record(
    values: Vec<String>,
    mappings: &[FieldMapping],
    source_location: String,
    byte_offset: Option<u64>,
    extract_domains: bool,
    extract_urls: bool,
) -> Result<ProcessedRecord, String> {
    let mut fields = Vec::with_capacity(mappings.len());
    let mut domains = Vec::new();
    let mut fingerprint = blake3::Hasher::new();
    for (index, mapping) in mappings.iter().enumerate() {
        let original = values.get(index).cloned().unwrap_or_default();
        fingerprint.update(mapping.source_name.as_bytes());
        fingerprint.update(&[0x1f]);
        fingerprint.update(original.as_bytes());
        fingerprint.update(&[0x1e]);

        let mut normalized = normalize_value(mapping.field_type, &original);
        if mapping.field_type.is_secret() {
            normalized = format!("blake3:{}", blake3::hash(normalized.as_bytes()).to_hex());
        }
        if extract_urls && mapping.field_type == FieldType::Url {
            if let Some(url) = normalize_url(&original) {
                normalized = url.normalized_url.clone();
                domains.push((url.domain.clone(), Some(url)));
            }
        } else if extract_domains
            && mapping.field_type == FieldType::Domain
            && let Some(domain) = normalize_domain(&original)
        {
            normalized = domain.hostname.clone();
            domains.push((domain, None));
        }
        fields.push(ProcessedField {
            name: mapping.source_name.clone(),
            field_type: mapping.field_type,
            original: if mapping.field_type.is_secret() {
                "[REDACTED]".to_string()
            } else {
                original
            },
            normalized,
            sensitive: mapping.is_sensitive || mapping.field_type.is_sensitive(),
            confidence: mapping.confidence,
        });
    }
    Ok(ProcessedRecord {
        id: Uuid::new_v4().to_string(),
        source_location,
        byte_offset,
        fingerprint: fingerprint.finalize().to_hex().to_string(),
        fields,
        domains,
    })
}

#[allow(clippy::too_many_arguments)]
fn flush_batch(
    database: &Arc<Mutex<Connection>>,
    writer: &mut tantivy::IndexWriter,
    index_fields: crate::search_index::IndexFields,
    dataset_id: &str,
    file: &WorkerFile,
    plan: &ImportPlan,
    counters: &mut Counters,
    batch: &mut Vec<ProcessedRecord>,
) -> Result<(), String> {
    if batch.is_empty() {
        return Ok(());
    }
    let mut connection = database
        .lock()
        .map_err(|_| "metadata database is unavailable".to_string())?;
    let transaction = connection.transaction().map_err(sanitized)?;
    for record in batch.drain(..) {
        if plan.options.deduplicate {
            let exists = transaction
                .query_row(
                    "SELECT EXISTS(
                        SELECT 1 FROM records WHERE dataset_id = ?1 AND record_fingerprint = ?2
                     )",
                    params![dataset_id, record.fingerprint],
                    |row| row.get::<_, bool>(0),
                )
                .map_err(sanitized)?;
            if exists {
                counters.duplicate_records += 1;
                continue;
            }
        }
        transaction
            .execute(
                "INSERT INTO records(
                    id, dataset_id, source_file_id, source_location, byte_offset,
                    record_fingerprint, parser
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    record.id,
                    dataset_id,
                    file.id,
                    record.source_location,
                    record.byte_offset.map(|value| value as i64),
                    record.fingerprint,
                    PARSER_VERSION,
                ],
            )
            .map_err(sanitized)?;
        let mut exact_values = Vec::new();
        let mut search_text = Vec::new();
        for field in &record.fields {
            transaction
                .execute(
                    "INSERT INTO field_values(
                        record_id, field_name, field_type, original_value, normalized_value,
                        is_sensitive, confidence
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        record.id,
                        field.name,
                        field.field_type.as_str(),
                        field.original,
                        field.normalized,
                        field.sensitive,
                        field.confidence,
                    ],
                )
                .map_err(sanitized)?;
            if !field.field_type.is_secret() && !field.normalized.is_empty() {
                exact_values.push(field.normalized.clone());
                exact_values.push(format!(
                    "{}:{}",
                    field.field_type.as_str(),
                    field.normalized
                ));
                search_text.push(field.normalized.clone());
            }
        }
        if plan.options.extract_domains || plan.options.extract_urls {
            for (domain, url) in &record.domains {
                store_domain(&transaction, &record.id, domain, url.as_ref()).map_err(sanitized)?;
            }
        }
        writer
            .add_document(make_document(
                index_fields,
                &record.id,
                dataset_id,
                &file.id,
                &record.source_location,
                &exact_values,
                &search_text.join(" "),
            ))
            .map_err(sanitized)?;
        counters.records_indexed += 1;
    }
    transaction.commit().map_err(sanitized)?;
    Ok(())
}

fn materialize_identities(connection: &Connection) -> Result<(), String> {
    let mut groups: HashMap<(String, String), Vec<(String, String)>> = HashMap::new();
    let mut statement = connection
        .prepare(
            "SELECT fv.field_type, fv.normalized_value, r.id, r.source_file_id
             FROM field_values fv
             JOIN records r ON r.id = fv.record_id
             WHERE fv.field_type IN ('email', 'phone', 'user_id')
               AND fv.normalized_value <> ''",
        )
        .map_err(sanitized)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(sanitized)?;
    for row in rows {
        let (field_type, value, record_id, source_file_id) = row.map_err(sanitized)?;
        let key = if field_type == "user_id" {
            (field_type, format!("{source_file_id}\u{1f}{value}"))
        } else {
            (field_type, value)
        };
        groups
            .entry(key)
            .or_default()
            .push((record_id, source_file_id));
    }
    drop(statement);

    for ((field_type, key), members) in groups {
        let group_id = stable_id("identity", &format!("{field_type}\u{1f}{key}"));
        let display = match field_type.as_str() {
            "email" => mask_email(&key),
            "phone" => mask_phone(&key),
            "user_id" => "Service-scoped ID".to_string(),
            _ => "Deterministic identity".to_string(),
        };
        connection
            .execute(
                "INSERT INTO identity_groups(id, display_label, confidence_level)
                 VALUES (?1, ?2, 'high')
                 ON CONFLICT(id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP",
                params![group_id, display],
            )
            .map_err(sanitized)?;
        for (record_id, _) in members {
            let explanation = serde_json::json!({
                "rule": format!("exact_normalized_{field_type}"),
                "deterministic": true
            });
            connection
                .execute(
                    "INSERT OR IGNORE INTO identity_memberships(
                        identity_group_id, record_id, link_type, confidence_score,
                        explanation_json, user_status
                     ) VALUES (?1, ?2, ?3, 1.0, ?4, 'automatic')",
                    params![
                        group_id,
                        record_id,
                        format!("exact_{field_type}"),
                        explanation.to_string()
                    ],
                )
                .map_err(sanitized)?;
        }
    }
    Ok(())
}

fn wait_if_paused(control: &JobControl) -> Result<(), String> {
    while control.is_paused() {
        if control.is_cancelled() {
            return Err("import cancelled".to_string());
        }
        thread::sleep(Duration::from_millis(100));
    }
    if control.is_cancelled() {
        return Err("import cancelled".to_string());
    }
    Ok(())
}

fn normalize_value(field_type: FieldType, value: &str) -> String {
    let trimmed = value.trim();
    match field_type {
        FieldType::Email
        | FieldType::Username
        | FieldType::FirstName
        | FieldType::LastName
        | FieldType::FullName
        | FieldType::City
        | FieldType::Country
        | FieldType::Company
        | FieldType::JobTitle
        | FieldType::Domain => trimmed.to_lowercase(),
        FieldType::Phone => {
            let digits: String = trimmed.chars().filter(char::is_ascii_digit).collect();
            if trimmed.starts_with('+') {
                format!("+{digits}")
            } else {
                digits
            }
        }
        FieldType::Url => normalize_url(trimmed)
            .map(|url| url.normalized_url)
            .unwrap_or_else(|| trimmed.to_lowercase()),
        FieldType::IpAddress => trimmed
            .parse::<std::net::IpAddr>()
            .map(|address| address.to_string())
            .unwrap_or_else(|_| trimmed.to_lowercase()),
        _ => trimmed.to_string(),
    }
}

fn scalar_json(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        Value::String(value) => value.clone(),
        nested => nested.to_string(),
    }
}

fn delimiter_byte(inspection: &FileInspection) -> u8 {
    match inspection.delimiter.as_deref() {
        Some("tab") => b'\t',
        Some("semicolon") => b';',
        Some("pipe") => b'|',
        _ if inspection.format == SourceFormat::Tsv => b'\t',
        _ => b',',
    }
}

fn format_name(format: SourceFormat) -> &'static str {
    match format {
        SourceFormat::Text => "text",
        SourceFormat::Csv => "csv",
        SourceFormat::Tsv => "tsv",
        SourceFormat::Delimited => "delimited",
        SourceFormat::Jsonl => "jsonl",
        SourceFormat::Gzip => "gzip",
    }
}

#[allow(clippy::too_many_arguments)]
fn emit_progress(
    app: Option<&AppHandle>,
    job_id: &str,
    dataset_id: &str,
    total_bytes: u64,
    current_file: Option<&str>,
    status: &str,
    message: &str,
    counters: &Counters,
) {
    if let Some(app) = app {
        let _ = app.emit(
            "import-progress",
            ImportProgress {
                job_id: job_id.to_string(),
                dataset_id: dataset_id.to_string(),
                status: status.to_string(),
                current_file: current_file.map(str::to_string),
                bytes_read: counters.bytes_read,
                total_bytes,
                records_processed: counters.records_processed,
                records_indexed: counters.records_indexed,
                invalid_records: counters.invalid_records,
                duplicate_records: counters.duplicate_records,
                message: message.to_string(),
            },
        );
    }
}

fn mark_file(
    database: &Arc<Mutex<Connection>>,
    job_id: &str,
    file_id: &str,
    status: &str,
) -> Result<(), String> {
    let connection = database
        .lock()
        .map_err(|_| "metadata database is unavailable".to_string())?;
    connection
        .execute(
            "UPDATE source_files SET index_status = ?2 WHERE id = ?1",
            params![file_id, status],
        )
        .map_err(sanitized)?;
    connection
        .execute(
            "UPDATE import_jobs SET current_file_id = ?2, started_at = COALESCE(started_at, CURRENT_TIMESTAMP)
             WHERE id = ?1",
            params![job_id, file_id],
        )
        .map_err(sanitized)?;
    Ok(())
}

fn update_job_status(
    database: &Arc<Mutex<Connection>>,
    job_id: &str,
    status: &str,
) -> Result<(), String> {
    let connection = database
        .lock()
        .map_err(|_| "metadata database is unavailable".to_string())?;
    connection
        .execute(
            "UPDATE import_jobs SET status = ?2,
                    started_at = CASE WHEN ?2 = 'running' THEN COALESCE(started_at, CURRENT_TIMESTAMP)
                                      ELSE started_at END
             WHERE id = ?1",
            params![job_id, status],
        )
        .map_err(sanitized)?;
    Ok(())
}

fn update_dataset_status(
    database: &Arc<Mutex<Connection>>,
    dataset_id: &str,
    status: &str,
) -> Result<(), String> {
    let connection = database
        .lock()
        .map_err(|_| "metadata database is unavailable".to_string())?;
    connection
        .execute(
            "UPDATE datasets SET status = ?2 WHERE id = ?1",
            params![dataset_id, status],
        )
        .map_err(sanitized)?;
    Ok(())
}

fn finish_cancelled(
    app: Option<&AppHandle>,
    database: &Arc<Mutex<Connection>>,
    job_id: &str,
    dataset_id: &str,
    total_bytes: u64,
    counters: &Counters,
) -> Result<(), String> {
    let connection = database
        .lock()
        .map_err(|_| "metadata database is unavailable".to_string())?;
    connection
        .execute(
            "UPDATE datasets SET status = 'cancelled', record_count = ?2,
                    warning_count = ?3, last_indexed_at = CURRENT_TIMESTAMP
             WHERE id = ?1",
            params![
                dataset_id,
                counters.records_indexed as i64,
                counters.invalid_records as i64
            ],
        )
        .map_err(sanitized)?;
    connection
        .execute(
            "UPDATE import_jobs SET status = 'cancelled', bytes_read = ?2,
                    records_processed = ?3, records_indexed = ?4, invalid_records = ?5,
                    duplicate_records = ?6, finished_at = CURRENT_TIMESTAMP
             WHERE id = ?1",
            params![
                job_id,
                counters.bytes_read as i64,
                counters.records_processed as i64,
                counters.records_indexed as i64,
                counters.invalid_records as i64,
                counters.duplicate_records as i64,
            ],
        )
        .map_err(sanitized)?;
    drop(connection);
    emit_progress(
        app,
        job_id,
        dataset_id,
        total_bytes,
        None,
        "cancelled",
        "Import cancelled; the source was not changed",
        counters,
    );
    Ok(())
}

fn mark_failed(database: &Arc<Mutex<Connection>>, job_id: &str, dataset_id: &str) {
    let _ = update_job_status(database, job_id, "failed");
    let _ = update_dataset_status(database, dataset_id, "failed");
}

fn mask_email(value: &str) -> String {
    let Some((local, domain)) = value.split_once('@') else {
        return "masked email".to_string();
    };
    let first = local.chars().next().unwrap_or('•');
    format!("{first}•••@{domain}")
}

fn mask_phone(value: &str) -> String {
    let suffix: String = value
        .chars()
        .rev()
        .take(2)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("••••••{suffix}")
}

fn stable_id(namespace: &str, value: &str) -> String {
    let hash = blake3::hash(format!("{namespace}\u{1f}{value}").as_bytes());
    format!("{namespace}-{}", &hash.to_hex()[..24])
}

fn sanitized(error: impl std::fmt::Display) -> String {
    let _ = error;
    "local import operation failed".to_string()
}

#[cfg(test)]
mod tests {
    use std::{
        fs::File,
        io,
        sync::{Arc, Mutex},
    };

    use flate2::{Compression, write::GzEncoder};
    use tempfile::tempdir;

    use super::{
        JobControl, mask_email, normalize_value, prepare_database_rows, process_record, run_import,
    };
    use crate::{
        detection::inspect_paths,
        models::{FieldMapping, FieldType, ImportOptions, ImportPlan, SearchMode},
        search_index::SearchIndex,
        storage::open_database,
    };

    #[test]
    fn secret_values_are_replaced_before_storage_and_indexing() {
        let mappings = vec![FieldMapping {
            source_name: "password".to_string(),
            field_type: FieldType::Password,
            confidence: 1.0,
            is_sensitive: true,
        }];
        let record = process_record(
            vec!["invented-secret".to_string()],
            &mappings,
            "line 1".to_string(),
            Some(0),
            true,
            true,
        )
        .expect("record");
        assert_eq!(record.fields[0].original, "[REDACTED]");
        assert!(record.fields[0].normalized.starts_with("blake3:"));
        assert!(!record.fields[0].normalized.contains("invented-secret"));
    }

    #[test]
    fn normalization_is_deterministic() {
        assert_eq!(
            normalize_value(FieldType::Email, " Person@Example.COM "),
            "person@example.com"
        );
        assert_eq!(
            normalize_value(FieldType::Phone, "+1 (202) 555-0142"),
            "+12025550142"
        );
    }

    #[test]
    fn labels_are_masked() {
        assert_eq!(mask_email("person@example.com"), "p•••@example.com");
    }

    #[test]
    fn synthetic_csv_import_builds_sqlite_tantivy_domains_and_identities() {
        let directory = tempdir().expect("temporary workspace");
        let fixture = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("tests")
            .join("fixtures")
            .join("records_valid.csv");
        let inspection = inspect_paths(&[fixture]).expect("inspection");
        let plan = ImportPlan {
            dataset_label: "Synthetic import".to_string(),
            authorization_note: "Invented fixture".to_string(),
            files: inspection.files,
            options: ImportOptions {
                skip_invalid_rows: true,
                stop_on_severe_error: true,
                extract_urls: true,
                extract_domains: true,
                group_identities: true,
                deduplicate: true,
                store_offsets: true,
            },
        };
        let database = Arc::new(Mutex::new(
            open_database(directory.path()).expect("database"),
        ));
        let files = prepare_database_rows(&database, "dataset-test", "job-test", &plan)
            .expect("database rows");
        run_import(
            None,
            &database,
            directory.path(),
            "job-test",
            "dataset-test",
            plan.files.iter().map(|file| file.file_size).sum(),
            512,
            files,
            &plan,
            &JobControl::default(),
        )
        .expect("import");

        let connection = database.lock().expect("database lock");
        let record_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM records", [], |row| row.get(0))
            .expect("record count");
        assert_eq!(record_count, 3);
        let secret: String = connection
            .query_row(
                "SELECT original_value FROM field_values
                 WHERE field_type = 'password' LIMIT 1",
                [],
                |row| row.get(0),
            )
            .expect("secret placeholder");
        assert_eq!(secret, "[REDACTED]");
        let co_uk_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM domains WHERE registrable_domain = 'example.co.uk'",
                [],
                |row| row.get(0),
            )
            .expect("domain count");
        assert_eq!(co_uk_count, 1);
        let username_links: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM identity_memberships
                 WHERE link_type LIKE '%username%'",
                [],
                |row| row.get(0),
            )
            .expect("username links");
        assert_eq!(username_links, 0);
        drop(connection);

        let search = SearchIndex::open_or_create(directory.path()).expect("index");
        let (_, record_ids) = search
            .search_record_ids(
                "email:ava.research@example.com",
                SearchMode::Exact,
                None,
                None,
                0,
                20,
            )
            .expect("search");
        assert_eq!(record_ids.len(), 1);
    }

    #[test]
    fn synthetic_tsv_jsonl_and_text_sources_stream_to_completion() {
        for (index, name) in [
            "records_valid.tsv",
            "records_valid.jsonl",
            "synthetic_848_shape.txt",
        ]
        .into_iter()
        .enumerate()
        {
            let workspace = tempdir().expect("temporary workspace");
            let source = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .join("tests")
                .join("fixtures")
                .join(name);
            let inspection = inspect_paths(&[source]).expect("inspection");
            let plan = synthetic_plan(inspection.files);
            let database = Arc::new(Mutex::new(
                open_database(workspace.path()).expect("database"),
            ));
            let dataset_id = format!("dataset-format-{index}");
            let job_id = format!("job-format-{index}");
            let files = prepare_database_rows(&database, &dataset_id, &job_id, &plan)
                .expect("database rows");
            run_import(
                None,
                &database,
                workspace.path(),
                &job_id,
                &dataset_id,
                plan.files.iter().map(|file| file.file_size).sum(),
                512,
                files,
                &plan,
                &JobControl::default(),
            )
            .expect("format import");
            let count: i64 = database
                .lock()
                .expect("database")
                .query_row(
                    "SELECT COUNT(*) FROM records WHERE dataset_id = ?1",
                    [&dataset_id],
                    |row| row.get(0),
                )
                .expect("record count");
            assert!(count > 0, "{name} should produce records");
        }
    }

    #[test]
    fn gzip_wrapped_synthetic_csv_is_decompressed_within_limits() {
        let workspace = tempdir().expect("temporary workspace");
        let fixture = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("tests")
            .join("fixtures")
            .join("records_valid.csv");
        let gzip_path = workspace.path().join("synthetic.csv.gz");
        let mut encoder = GzEncoder::new(
            File::create(&gzip_path).expect("gzip destination"),
            Compression::default(),
        );
        io::copy(&mut File::open(fixture).expect("fixture"), &mut encoder)
            .expect("compress fixture");
        encoder.finish().expect("finish gzip");

        let inspection = inspect_paths(&[gzip_path]).expect("inspection");
        assert!(inspection.files[0].compressed);
        let plan = synthetic_plan(inspection.files);
        let database = Arc::new(Mutex::new(
            open_database(workspace.path()).expect("database"),
        ));
        let files = prepare_database_rows(&database, "dataset-gzip", "job-gzip", &plan)
            .expect("database rows");
        run_import(
            None,
            &database,
            workspace.path(),
            "job-gzip",
            "dataset-gzip",
            plan.files.iter().map(|file| file.file_size).sum(),
            512,
            files,
            &plan,
            &JobControl::default(),
        )
        .expect("gzip import");
        let count: i64 = database
            .lock()
            .expect("database")
            .query_row("SELECT COUNT(*) FROM records", [], |row| row.get(0))
            .expect("record count");
        assert_eq!(count, 3);
    }

    fn synthetic_plan(files: Vec<crate::models::FileInspection>) -> ImportPlan {
        ImportPlan {
            dataset_label: "Synthetic format import".to_string(),
            authorization_note: "Invented fixtures only".to_string(),
            files,
            options: ImportOptions {
                skip_invalid_rows: true,
                stop_on_severe_error: true,
                extract_urls: true,
                extract_domains: true,
                group_identities: true,
                deduplicate: true,
                store_offsets: true,
            },
        }
    }
}
