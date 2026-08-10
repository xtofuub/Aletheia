use std::{
    collections::HashSet,
    fs::{self, File},
    io::{BufRead, BufReader, Read, Seek, SeekFrom},
    mem,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

use encoding_rs::{Encoding, UTF_8};
use flate2::read::GzDecoder;
use once_cell::sync::Lazy;
use regex::Regex;
use rusqlite::{Connection, OptionalExtension, params};
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
    storage::{AppState, JobControl, open_database},
};

const MAX_LINE_BYTES: usize = 1024 * 1024;
const MAX_FIELD_BYTES: usize = 256 * 1024;
const MAX_FIELDS: usize = 256;
const MAX_JSON_DEPTH: usize = 32;
const MAX_DECOMPRESSION_RATIO: u64 = 100;
const MIN_DECOMPRESSION_LIMIT: u64 = 64 * 1024 * 1024;
const BATCH_RECORDS: usize = 10_000;
const MIN_BATCH_BYTES: usize = 4 * 1024 * 1024;
const MAX_BATCH_BYTES: usize = 64 * 1024 * 1024;
const MIN_WRITER_BYTES: usize = 64 * 1024 * 1024;
const MAX_WRITER_BYTES: usize = 2 * 1024 * 1024 * 1024;
const INDEX_CHECKPOINT_RECORDS: u64 = 1_000_000;
const PARSER_VERSION: &str = "aletheia-parser/1";

static EMBEDDED_EMAIL: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)(?:^|[^a-z0-9.!#$%&'*+/=?^_`{|}~-])([a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+)",
    )
    .expect("embedded email regex")
});
static EMBEDDED_DOMAIN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})\b")
        .expect("embedded domain regex")
});

#[derive(Clone)]
struct WorkerFile {
    id: String,
    inspection: FileInspection,
    resume_offset: u64,
    resume_line: u64,
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

impl ProcessedRecord {
    fn estimated_memory_bytes(&self) -> usize {
        let field_bytes = self.fields.iter().fold(0_usize, |total, field| {
            total.saturating_add(
                mem::size_of::<ProcessedField>()
                    .saturating_add(field.name.len())
                    .saturating_add(field.original.len())
                    .saturating_add(field.normalized.len()),
            )
        });
        let domain_bytes = self.domains.iter().fold(0_usize, |total, (domain, url)| {
            let domain_size = domain
                .hostname
                .len()
                .saturating_add(domain.registrable_domain.len())
                .saturating_add(domain.public_suffix.as_ref().map_or(0, String::len));
            let url_size = url.as_ref().map_or(0, |url| {
                url.normalized_url
                    .len()
                    .saturating_add(url.scheme.len())
                    .saturating_add(url.hostname.len())
                    .saturating_add(url.path.len())
                    .saturating_add(url.query_keys.iter().map(String::len).sum::<usize>())
            });
            total.saturating_add(domain_size).saturating_add(url_size)
        });
        mem::size_of::<Self>()
            .saturating_add(self.id.len())
            .saturating_add(self.source_location.len())
            .saturating_add(self.fingerprint.len())
            .saturating_add(field_bytes)
            .saturating_add(domain_bytes)
    }
}

#[derive(Clone, Copy)]
struct Counters {
    bytes_read: u64,
    records_processed: u64,
    records_indexed: u64,
    invalid_records: u64,
    duplicate_records: u64,
}

struct CountingReader<R> {
    inner: R,
    bytes_read: u64,
}

impl<R> CountingReader<R> {
    fn new(inner: R) -> Self {
        Self {
            inner,
            bytes_read: 0,
        }
    }

    fn with_bytes_read(inner: R, bytes_read: u64) -> Self {
        Self { inner, bytes_read }
    }
}

impl<R: Read> Read for CountingReader<R> {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        let count = self.inner.read(buffer)?;
        self.bytes_read = self.bytes_read.saturating_add(count as u64);
        Ok(count)
    }
}

enum SourceReader {
    Plain(CountingReader<File>),
    Gzip(Box<GzDecoder<CountingReader<File>>>),
}

impl SourceReader {
    fn source_bytes_read(&self) -> u64 {
        match self {
            Self::Plain(reader) => reader.bytes_read,
            Self::Gzip(reader) => reader.get_ref().bytes_read,
        }
    }
}

impl Read for SourceReader {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        match self {
            Self::Plain(reader) => reader.read(buffer),
            Self::Gzip(reader) => reader.read(buffer),
        }
    }
}

struct BoundedLineRead {
    bytes_consumed: u64,
    exceeded_limit: bool,
}

#[tauri::command]
pub async fn start_import(
    plan: ImportPlan,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<ImportStartResult, String> {
    validate_plan(&plan)?;
    let (worker_limit, memory_limit_mb) = import_resource_limits(&state.database)?;
    if !state
        .jobs
        .lock()
        .map_err(|_| "import job registry is unavailable".to_string())?
        .is_empty()
    {
        return Err(
            "another import is active; Aletheia uses one writer with multiple index workers"
                .to_string(),
        );
    }
    let dataset_id = Uuid::new_v4().to_string();
    let job_id = Uuid::new_v4().to_string();
    let total_bytes = total_source_bytes(&plan);
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
        let run_result = open_database(&storage_root)
            .map_err(|_| "metadata database worker could not start".to_string())
            .and_then(|worker_connection| {
                prepare_import_database(&worker_connection)?;
                let worker_database = Arc::new(Mutex::new(worker_connection));
                run_import(
                    Some(&app),
                    &worker_database,
                    &storage_root,
                    &job_id,
                    &dataset_id,
                    total_bytes,
                    worker_limit,
                    memory_limit_mb,
                    worker_files,
                    &plan,
                    &control,
                )
            });
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
pub async fn resume_dataset_import(
    dataset_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<ImportStartResult, String> {
    if dataset_id.len() > 128 {
        return Err("dataset identifier is invalid".to_string());
    }
    let (worker_limit, memory_limit_mb) = import_resource_limits(&state.database)?;
    if !state
        .jobs
        .lock()
        .map_err(|_| "import job registry is unavailable".to_string())?
        .is_empty()
    {
        return Err("another import is already active".to_string());
    }

    let (job_id, mut plan) = load_resume_plan(&state.database, &dataset_id)?;
    validate_plan(&plan)?;
    let worker_files = prepare_resume_files(&state.database, &dataset_id, &mut plan)?;
    if worker_files.is_empty() {
        return Err("this dataset has no unfinished source files".to_string());
    }
    let total_bytes = total_source_bytes(&plan);
    let plan_json =
        serde_json::to_string(&plan).map_err(|_| "saved import plan is invalid".to_string())?;
    {
        let connection = state
            .database
            .lock()
            .map_err(|_| "metadata database is unavailable".to_string())?;
        connection
            .execute(
                "UPDATE import_jobs
                 SET status = 'queued', finished_at = NULL, plan_json = ?2
                 WHERE id = ?1",
                params![job_id, plan_json],
            )
            .map_err(sanitized)?;
        connection
            .execute(
                "UPDATE datasets SET status = 'queued' WHERE id = ?1",
                [&dataset_id],
            )
            .map_err(sanitized)?;
    }

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
        let run_result = open_database(&storage_root)
            .map_err(|_| "metadata database worker could not start".to_string())
            .and_then(|worker_connection| {
                prepare_import_database(&worker_connection)?;
                let worker_database = Arc::new(Mutex::new(worker_connection));
                run_import(
                    Some(&app),
                    &worker_database,
                    &storage_root,
                    &job_id,
                    &dataset_id,
                    total_bytes,
                    worker_limit,
                    memory_limit_mb,
                    worker_files,
                    &plan,
                    &control,
                )
            });
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
pub async fn rebuild_identities(state: State<'_, AppState>) -> Result<u64, String> {
    if !state
        .jobs
        .lock()
        .map_err(|_| "import job registry is unavailable".to_string())?
        .is_empty()
    {
        return Err("finish or cancel the active import before rebuilding identities".to_string());
    }
    let storage_root = state
        .current_storage_root()
        .map_err(|_| "storage location is unavailable".to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut connection = open_database(&storage_root)
            .map_err(|_| "identity database worker could not start".to_string())?;
        rebuild_identity_groups(&mut connection)
    })
    .await
    .map_err(|_| "identity rebuild task failed".to_string())?
}

#[tauri::command]
pub async fn rebuild_domains(state: State<'_, AppState>) -> Result<u64, String> {
    let database = state.database.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut connection = database
            .lock()
            .map_err(|_| "metadata database is unavailable".to_string())?;
        rebuild_domain_groups(&mut connection)
    })
    .await
    .map_err(|_| "domain rebuild task failed".to_string())?
}

fn rebuild_domain_groups(connection: &mut Connection) -> Result<u64, String> {
    let mut cursor = 0_i64;
    loop {
        let rows = {
            let mut statement = connection
                .prepare(
                    "SELECT fv.id, fv.record_id, r.dataset_id, fv.field_type,
                            fv.original_value
                     FROM field_values fv
                     JOIN records r ON r.id = fv.record_id
                     WHERE fv.id > ?1
                       AND fv.field_type IN ('domain', 'url', 'email', 'unknown')
                     ORDER BY fv.id
                     LIMIT 10000",
                )
                .map_err(sanitized)?;
            statement
                .query_map([cursor], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                    ))
                })
                .map_err(sanitized)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(sanitized)?
        };
        if rows.is_empty() {
            break;
        }
        cursor = rows.last().map(|row| row.0).unwrap_or(cursor);
        let transaction = connection.transaction().map_err(sanitized)?;
        for (_, record_id, dataset_id, field_type, original) in &rows {
            let mut seen = HashSet::new();
            if field_type == "url"
                && let Some(url) = normalize_url(original)
                && seen.insert(url.domain.hostname.clone())
            {
                store_domain(&transaction, record_id, dataset_id, &url.domain, Some(&url))
                    .map_err(sanitized)?;
            }
            if field_type == "domain"
                && let Some(domain) = normalize_domain(original)
                && seen.insert(domain.hostname.clone())
            {
                store_domain(&transaction, record_id, dataset_id, &domain, None)
                    .map_err(sanitized)?;
            }
            for domain in extract_embedded_domains(original) {
                if seen.insert(domain.hostname.clone()) {
                    store_domain(&transaction, record_id, dataset_id, &domain, None)
                        .map_err(sanitized)?;
                }
            }
        }
        transaction.commit().map_err(sanitized)?;
        if rows.len() < 10_000 {
            break;
        }
    }
    connection
        .execute("DELETE FROM domain_link_repairs", [])
        .map_err(sanitized)?;
    connection
        .query_row(
            "SELECT COUNT(DISTINCT registrable_domain) FROM domains",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map(|count| count.max(0) as u64)
        .map_err(sanitized)
}

fn rebuild_identity_groups(connection: &mut Connection) -> Result<u64, String> {
    connection
        .execute_batch(
            "DELETE FROM identity_memberships
             WHERE user_status = 'automatic'
               AND link_type IN ('exact_email', 'exact_phone', 'exact_user_id');
             DELETE FROM identity_groups
             WHERE NOT EXISTS (
               SELECT 1 FROM identity_memberships im
               WHERE im.identity_group_id = identity_groups.id
             )
               AND NOT EXISTS (
                 SELECT 1 FROM identity_live_evidence le
                 WHERE le.identity_group_id = identity_groups.id
             );
             DELETE FROM identity_candidates;",
        )
        .map_err(sanitized)?;
    let mut cursor = 0_i64;
    loop {
        let rows = {
            let mut statement = connection
                .prepare(
                    "SELECT fv.id, fv.record_id, r.source_file_id,
                            fv.field_type, fv.normalized_value, fv.original_value
                     FROM field_values fv
                     JOIN records r ON r.id = fv.record_id
                     WHERE fv.id > ?1
                       AND fv.field_type IN ('email', 'phone', 'user_id', 'unknown', 'url')
                     ORDER BY fv.id
                     LIMIT 10000",
                )
                .map_err(sanitized)?;
            statement
                .query_map([cursor], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                    ))
                })
                .map_err(sanitized)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(sanitized)?
        };
        if rows.is_empty() {
            break;
        }
        cursor = rows.last().map(|row| row.0).unwrap_or(cursor);
        let transaction = connection.transaction().map_err(sanitized)?;
        for (_, record_id, source_file_id, field_type, normalized_value, original_value) in rows {
            let stored_type = parse_stored_field_type(&field_type);
            if matches!(
                stored_type,
                FieldType::Email | FieldType::Phone | FieldType::UserId
            ) {
                store_identity(
                    &transaction,
                    &record_id,
                    &source_file_id,
                    stored_type,
                    &normalized_value,
                )?;
            } else {
                for (detected_type, detected_value) in extract_embedded_identifiers(&original_value)
                {
                    store_identity(
                        &transaction,
                        &record_id,
                        &source_file_id,
                        detected_type,
                        &detected_value,
                    )?;
                }
            }
        }
        transaction.commit().map_err(sanitized)?;
    }
    connection
        .execute(
            "DELETE FROM identity_groups
             WHERE NOT EXISTS (
               SELECT 1 FROM identity_memberships im
               WHERE im.identity_group_id = identity_groups.id
             )
               AND NOT EXISTS (
                 SELECT 1 FROM identity_live_evidence le
                 WHERE le.identity_group_id = identity_groups.id
             )",
            [],
        )
        .map_err(sanitized)?;
    connection
        .query_row(
            "SELECT COUNT(*) FROM identity_groups
             WHERE EXISTS (
               SELECT 1 FROM identity_memberships im
               WHERE im.identity_group_id = identity_groups.id
             )",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map(|count| count.max(0) as u64)
        .map_err(sanitized)
}

fn prepare_import_database(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "DROP INDEX IF EXISTS field_values_normalized_idx;
             DROP INDEX IF EXISTS records_fingerprint_idx;
             DROP INDEX IF EXISTS records_dataset_fingerprint_idx;",
        )
        .map_err(sanitized)
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
    update_job_status(&state.database, &job_id, "cancelling")?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "metadata database is unavailable".to_string())?;
    connection
        .execute(
            "UPDATE datasets SET status = 'cancelling'
             WHERE id = (SELECT dataset_id FROM import_jobs WHERE id = ?1)",
            [&job_id],
        )
        .map_err(sanitized)?;
    Ok(())
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

#[tauri::command]
pub async fn delete_dataset(dataset_id: String, state: State<'_, AppState>) -> Result<(), String> {
    if dataset_id.is_empty() || dataset_id.len() > 128 {
        return Err("dataset identifier is invalid".to_string());
    }
    if !state
        .jobs
        .lock()
        .map_err(|_| "job registry is unavailable".to_string())?
        .is_empty()
    {
        return Err("finish or cancel active work before removing a dataset".to_string());
    }
    let storage_root = state
        .current_storage_root()
        .map_err(|_| "storage location is unavailable".to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        delete_dataset_from_workspace(&storage_root, &dataset_id)
    })
    .await
    .map_err(|_| "dataset removal task failed".to_string())?
}

fn delete_dataset_from_workspace(storage_root: &Path, dataset_id: &str) -> Result<(), String> {
    let mut connection = open_database(storage_root)
        .map_err(|_| "dataset database worker could not start".to_string())?;
    let transaction = connection.transaction().map_err(sanitized)?;
    let removed = transaction
        .execute("DELETE FROM datasets WHERE id = ?1", [dataset_id])
        .map_err(sanitized)?;
    if removed == 0 {
        return Err("dataset was not found".to_string());
    }
    transaction
        .execute_batch(
            "UPDATE domains
             SET record_count = (
               SELECT COUNT(*) FROM record_domains rd
               WHERE rd.hostname = domains.hostname
             );
             DELETE FROM domains WHERE record_count = 0;
             DELETE FROM identity_groups
             WHERE NOT EXISTS (
               SELECT 1 FROM identity_memberships im
               WHERE im.identity_group_id = identity_groups.id
             )
               AND NOT EXISTS (
                 SELECT 1 FROM identity_live_evidence le
                 WHERE le.identity_group_id = identity_groups.id
             );
             DELETE FROM identity_candidates
             WHERE group_id NOT IN (SELECT id FROM identity_groups);
             DELETE FROM domain_link_repairs
             WHERE registrable_domain NOT IN (
               SELECT DISTINCT registrable_domain FROM domains
             );",
        )
        .map_err(sanitized)?;
    transaction
        .execute(
            "INSERT INTO audit_events(
               id, event_type, entity_type, entity_id, details_json
             ) VALUES (?1, 'dataset_removed', 'dataset', ?2, ?3)",
            params![
                Uuid::new_v4().to_string(),
                dataset_id,
                r#"{"sourceFilesDeleted":false,"generatedDataOnly":true}"#
            ],
        )
        .map_err(sanitized)?;
    transaction.commit().map_err(sanitized)?;

    SearchIndex::open_or_create(storage_root)?.delete_dataset(dataset_id)
}

fn validate_plan(plan: &ImportPlan) -> Result<(), String> {
    if plan.dataset_label.trim().is_empty() || plan.dataset_label.len() > 160 {
        return Err("dataset label must contain 1 to 160 characters".to_string());
    }
    if plan.authorization_note.len() > 500 {
        return Err("authorization note must contain at most 500 characters".to_string());
    }
    if plan.files.is_empty() || plan.files.len() > 10_000 {
        return Err("select between 1 and 10,000 source files".to_string());
    }
    Ok(())
}

fn total_source_bytes(plan: &ImportPlan) -> u64 {
    plan.files
        .iter()
        .fold(0_u64, |total, file| total.saturating_add(file.file_size))
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
        read("memory_limit_mb", 512).clamp(256, 4096),
    ))
}

fn persist_checkpoint(
    database: &Arc<Mutex<Connection>>,
    job_id: &str,
    file_id: &str,
    counters: &Counters,
) -> Result<(), String> {
    let checkpoint = serde_json::json!({
        "sourceFileId": file_id,
        "sourceBytesRead": counters.bytes_read,
        "recordsProcessed": counters.records_processed,
        "recordsIndexed": counters.records_indexed,
        "parserVersion": PARSER_VERSION,
    });
    let connection = database
        .lock()
        .map_err(|_| "metadata database is unavailable".to_string())?;
    connection
        .execute(
            "UPDATE import_jobs SET current_file_id = ?2, bytes_read = ?3,
                    records_processed = ?4, records_indexed = ?5,
                    invalid_records = ?6, duplicate_records = ?7,
                    checkpoint_json = ?8
             WHERE id = ?1",
            params![
                job_id,
                file_id,
                counters.bytes_read as i64,
                counters.records_processed as i64,
                counters.records_indexed as i64,
                counters.invalid_records as i64,
                counters.duplicate_records as i64,
                checkpoint.to_string(),
            ],
        )
        .map_err(sanitized)?;
    Ok(())
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
    let total_bytes = total_source_bytes(plan);
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
            "INSERT INTO import_jobs(id, dataset_id, status, total_bytes, plan_json)
             VALUES (?1, ?2, 'queued', ?3, ?4)",
            params![
                job_id,
                dataset_id,
                total_bytes as i64,
                serde_json::to_string(plan)
                    .map_err(|_| "import plan could not be saved".to_string())?
            ],
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
            resume_offset: 0,
            resume_line: 0,
        });
    }
    transaction.commit().map_err(sanitized)?;
    Ok(worker_files)
}

fn load_resume_plan(
    database: &Arc<Mutex<Connection>>,
    dataset_id: &str,
) -> Result<(String, ImportPlan), String> {
    let connection = database
        .lock()
        .map_err(|_| "metadata database is unavailable".to_string())?;
    let saved = connection
        .query_row(
            "SELECT j.id, j.plan_json, d.name, d.authorization_note
             FROM import_jobs j
             JOIN datasets d ON d.id = j.dataset_id
             WHERE j.dataset_id = ?1
               AND j.status IN ('cancelled', 'interrupted', 'failed')
             ORDER BY j.created_at DESC
             LIMIT 1",
            [dataset_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .optional()
        .map_err(sanitized)?
        .ok_or_else(|| "this dataset has no resumable import".to_string())?;
    if let Some(plan_json) = saved.1 {
        let plan = serde_json::from_str::<ImportPlan>(&plan_json)
            .map_err(|_| "saved import plan is invalid".to_string())?;
        return Ok((saved.0, plan));
    }

    let mut path_statement = connection
        .prepare(
            "SELECT absolute_path FROM source_files
             WHERE dataset_id = ?1 ORDER BY rowid",
        )
        .map_err(sanitized)?;
    let paths = path_statement
        .query_map([dataset_id], |row| row.get::<_, String>(0))
        .map_err(sanitized)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(sanitized)?
        .into_iter()
        .map(PathBuf::from)
        .collect::<Vec<_>>();
    drop(path_statement);
    drop(connection);

    let inspection = crate::detection::inspect_paths(&paths)?;
    if !inspection.rejected_paths.is_empty() || inspection.files.len() != paths.len() {
        return Err("one or more original source files are unavailable".to_string());
    }
    let mut plan = ImportPlan {
        dataset_label: saved.2,
        authorization_note: saved.3,
        files: inspection.files,
        options: crate::models::ImportOptions {
            skip_invalid_rows: true,
            stop_on_severe_error: true,
            extract_urls: true,
            extract_domains: true,
            group_identities: true,
            deduplicate: true,
            store_offsets: true,
        },
    };
    restore_saved_mappings(database, dataset_id, &mut plan)?;
    Ok((saved.0, plan))
}

fn restore_saved_mappings(
    database: &Arc<Mutex<Connection>>,
    dataset_id: &str,
    plan: &mut ImportPlan,
) -> Result<(), String> {
    let connection = database
        .lock()
        .map_err(|_| "metadata database is unavailable".to_string())?;
    for inspection in &mut plan.files {
        let file_id = connection
            .query_row(
                "SELECT id FROM source_files
                 WHERE dataset_id = ?1 AND lower(absolute_path) = lower(?2)",
                params![dataset_id, inspection.absolute_path],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(sanitized)?
            .ok_or_else(|| "saved source mapping is unavailable".to_string())?;
        let mut mapping_statement = connection
            .prepare(
                "SELECT source_name, field_type, confidence, is_sensitive
                 FROM field_mappings WHERE source_file_id = ?1 ORDER BY id",
            )
            .map_err(sanitized)?;
        inspection.mappings = mapping_statement
            .query_map([file_id], |row| {
                let field_type: String = row.get(1)?;
                Ok(FieldMapping {
                    source_name: row.get(0)?,
                    field_type: parse_stored_field_type(&field_type),
                    confidence: row.get(2)?,
                    is_sensitive: row.get(3)?,
                })
            })
            .map_err(sanitized)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(sanitized)?;
    }
    Ok(())
}

fn prepare_resume_files(
    database: &Arc<Mutex<Connection>>,
    dataset_id: &str,
    plan: &mut ImportPlan,
) -> Result<Vec<WorkerFile>, String> {
    let connection = database
        .lock()
        .map_err(|_| "metadata database is unavailable".to_string())?;
    let mut statement = connection
        .prepare(
            "SELECT id, absolute_path, file_size, index_status
             FROM source_files WHERE dataset_id = ?1 ORDER BY rowid",
        )
        .map_err(sanitized)?;
    let source_files = statement
        .query_map([dataset_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)? as u64,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(sanitized)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(sanitized)?;
    drop(statement);

    let mut worker_files = Vec::new();
    for (file_id, absolute_path, expected_size, status) in source_files {
        if status == "indexed" {
            continue;
        }
        let inspection = plan
            .files
            .iter()
            .find(|file| file.absolute_path.eq_ignore_ascii_case(&absolute_path))
            .cloned()
            .ok_or_else(|| "saved source inspection is unavailable".to_string())?;
        let metadata = fs::metadata(&absolute_path)
            .map_err(|_| "an original source file is unavailable".to_string())?;
        if !metadata.is_file() || metadata.len() != expected_size {
            return Err("an original source changed; resume was stopped safely".to_string());
        }
        let checkpoint = connection
            .query_row(
                "SELECT byte_offset, source_location
                 FROM records WHERE source_file_id = ?1
                 ORDER BY rowid DESC LIMIT 1",
                [&file_id],
                |row| {
                    Ok((
                        row.get::<_, Option<i64>>(0)?.unwrap_or(0).max(0) as u64,
                        row.get::<_, String>(1)?,
                    ))
                },
            )
            .optional()
            .map_err(sanitized)?;
        let (resume_offset, resume_line) = checkpoint
            .map(|(offset, location)| (offset, parse_source_line(&location)))
            .unwrap_or((0, 0));
        worker_files.push(WorkerFile {
            id: file_id,
            inspection,
            resume_offset,
            resume_line,
        });
    }
    Ok(worker_files)
}

fn load_initial_counters(
    database: &Arc<Mutex<Connection>>,
    dataset_id: &str,
    job_id: &str,
    files: &[WorkerFile],
) -> Result<Counters, String> {
    let connection = database
        .lock()
        .map_err(|_| "metadata database is unavailable".to_string())?;
    let records_indexed = connection
        .query_row(
            "SELECT COUNT(*) FROM records WHERE dataset_id = ?1",
            [dataset_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(sanitized)?
        .max(0) as u64;
    let (invalid_records, duplicate_records) = connection
        .query_row(
            "SELECT invalid_records, duplicate_records
             FROM import_jobs WHERE id = ?1",
            [job_id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )
        .map_err(sanitized)?;
    let indexed_bytes = connection
        .query_row(
            "SELECT COALESCE(SUM(file_size), 0) FROM source_files
             WHERE dataset_id = ?1 AND index_status = 'indexed'",
            [dataset_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(sanitized)?
        .max(0) as u64;
    let resumed_plain_bytes = files
        .iter()
        .filter(|file| !file.inspection.compressed)
        .map(|file| file.resume_offset)
        .sum::<u64>();
    let invalid_records = invalid_records.max(0) as u64;
    let duplicate_records = duplicate_records.max(0) as u64;
    Ok(Counters {
        bytes_read: indexed_bytes.saturating_add(resumed_plain_bytes),
        records_processed: records_indexed
            .saturating_add(invalid_records)
            .saturating_add(duplicate_records),
        records_indexed,
        invalid_records,
        duplicate_records,
    })
}

fn parse_source_line(value: &str) -> u64 {
    value
        .strip_prefix("line ")
        .and_then(|line| line.parse().ok())
        .unwrap_or(0)
}

fn parse_stored_field_type(value: &str) -> FieldType {
    match value {
        "email" => FieldType::Email,
        "username" => FieldType::Username,
        "first_name" => FieldType::FirstName,
        "last_name" => FieldType::LastName,
        "full_name" => FieldType::FullName,
        "phone" => FieldType::Phone,
        "ip_address" => FieldType::IpAddress,
        "domain" => FieldType::Domain,
        "url" => FieldType::Url,
        "password" => FieldType::Password,
        "password_hash" => FieldType::PasswordHash,
        "salt" => FieldType::Salt,
        "date_of_birth" => FieldType::DateOfBirth,
        "address" => FieldType::Address,
        "city" => FieldType::City,
        "country" => FieldType::Country,
        "postal_code" => FieldType::PostalCode,
        "company" => FieldType::Company,
        "job_title" => FieldType::JobTitle,
        "user_id" => FieldType::UserId,
        "timestamp" => FieldType::Timestamp,
        _ => FieldType::Unknown,
    }
}

#[allow(clippy::too_many_arguments)]
fn run_import(
    app: Option<&AppHandle>,
    database: &Arc<Mutex<Connection>>,
    storage_root: &Path,
    job_id: &str,
    dataset_id: &str,
    total_bytes: u64,
    worker_limit: u32,
    memory_limit_mb: u32,
    files: Vec<WorkerFile>,
    plan: &ImportPlan,
    control: &JobControl,
) -> Result<(), String> {
    update_job_status(database, job_id, "running")?;
    update_dataset_status(database, dataset_id, "indexing")?;
    let search = SearchIndex::open_or_create(storage_root)?;
    let writer_memory = writer_memory_budget(memory_limit_mb);
    let batch_byte_limit = batch_byte_limit(memory_limit_mb);
    let mut writer = search.writer_with_limits(worker_limit as usize, writer_memory)?;
    let mut counters = load_initial_counters(database, dataset_id, job_id, &files)?;
    let mut last_emit = Instant::now();
    let mut last_index_checkpoint = 0_u64;

    for file in files {
        if control.is_cancelled() {
            writer.commit().map_err(sanitized)?;
            return finish_cancelled(app, database, job_id, dataset_id, total_bytes, &counters);
        }
        mark_file(database, job_id, &file.id, "indexing")?;
        let mut batch = Vec::with_capacity(BATCH_RECORDS);
        let mut batch_bytes = 0_usize;
        let stream_result = stream_file(&file, plan, control, &mut counters, |record, counters| {
            batch_bytes = batch_bytes.saturating_add(record.estimated_memory_bytes());
            batch.push(record);
            if batch.len() >= BATCH_RECORDS || batch_bytes >= batch_byte_limit {
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
                batch_bytes = 0;
                if counters
                    .records_indexed
                    .saturating_sub(last_index_checkpoint)
                    >= INDEX_CHECKPOINT_RECORDS
                {
                    writer.commit().map_err(sanitized)?;
                    persist_checkpoint(database, job_id, &file.id, counters)?;
                    last_index_checkpoint = counters.records_indexed;
                }
                if last_emit.elapsed() >= Duration::from_millis(250) {
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
        writer.commit().map_err(sanitized)?;
        persist_checkpoint(database, job_id, &file.id, &counters)?;
        last_index_checkpoint = counters.records_indexed;
        mark_file(database, job_id, &file.id, "indexed")?;
    }

    if control.is_cancelled() {
        writer.commit().map_err(sanitized)?;
        return finish_cancelled(app, database, job_id, dataset_id, total_bytes, &counters);
    }
    writer.commit().map_err(sanitized)?;
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
    let mut source = File::open(&file.inspection.absolute_path)
        .map_err(|_| "source file could not be opened read-only".to_string())?;
    if !file.inspection.compressed && file.resume_offset > 0 {
        source
            .seek(SeekFrom::Start(file.resume_offset))
            .map_err(|_| "source resume position is unavailable".to_string())?;
    }
    let source_reader = if file.inspection.compressed {
        SourceReader::Gzip(Box::new(GzDecoder::new(CountingReader::new(source))))
    } else {
        SourceReader::Plain(CountingReader::with_bytes_read(source, file.resume_offset))
    };
    let mut reader = BufReader::with_capacity(64 * 1024, source_reader);
    let encoding = Encoding::for_label(file.inspection.encoding.as_bytes()).unwrap_or(UTF_8);
    let decompression_limit = decompression_limit(file.inspection.file_size);
    let mut line = Vec::with_capacity(4096);
    let mut line_number = if file.inspection.compressed {
        0
    } else {
        file.resume_line.saturating_sub(1)
    };
    let mut decompressed_bytes = if file.inspection.compressed {
        0
    } else {
        file.resume_offset
    };
    let mut accounted_source_bytes = if file.inspection.compressed {
        0
    } else {
        file.resume_offset
    };
    loop {
        wait_if_paused(control)?;
        let line_start = decompressed_bytes;
        let bounded = read_bounded_line(&mut reader, &mut line, MAX_LINE_BYTES, control)?;
        let source_bytes = reader.get_ref().source_bytes_read();
        counters.bytes_read = counters
            .bytes_read
            .saturating_add(source_bytes.saturating_sub(accounted_source_bytes));
        accounted_source_bytes = source_bytes;
        if bounded.bytes_consumed == 0 {
            break;
        }
        line_number += 1;
        decompressed_bytes = decompressed_bytes.saturating_add(bounded.bytes_consumed);
        if file.inspection.compressed && decompressed_bytes > decompression_limit {
            return Err("compressed source exceeded the safe decompression limit".to_string());
        }
        let replaying_from_start =
            file.resume_line > 0 && (file.inspection.compressed || file.resume_offset == 0);
        let rereading_seek_checkpoint = !file.inspection.compressed
            && file.resume_offset > 0
            && line_number == file.resume_line;
        if (replaying_from_start && line_number <= file.resume_line) || rereading_seek_checkpoint {
            continue;
        }
        if bounded.exceeded_limit {
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
        let record = process_record(
            values,
            &file.inspection.mappings,
            format!("line {line_number}"),
            plan.options.store_offsets.then_some(line_start),
            plan.options.extract_domains,
            plan.options.extract_urls,
        )?;
        on_record(record, counters)?;
    }
    Ok(())
}

fn read_bounded_line<R: BufRead>(
    reader: &mut R,
    line: &mut Vec<u8>,
    limit: usize,
    control: &JobControl,
) -> Result<BoundedLineRead, String> {
    line.clear();
    let retained_limit = limit.saturating_add(2);
    let mut bytes_consumed = 0_u64;
    let mut discarded = false;

    loop {
        wait_if_paused(control)?;
        let available = reader
            .fill_buf()
            .map_err(|_| "source read failed".to_string())?;
        if available.is_empty() {
            break;
        }
        let newline = available.iter().position(|byte| *byte == b'\n');
        let consume = newline.map_or(available.len(), |index| index + 1);
        bytes_consumed = bytes_consumed.saturating_add(consume as u64);

        if line.len() < retained_limit {
            let copy = consume.min(retained_limit - line.len());
            line.extend_from_slice(&available[..copy]);
            discarded |= copy < consume;
        } else {
            discarded = true;
        }
        reader.consume(consume);
        if newline.is_some() {
            break;
        }
    }

    while matches!(line.last(), Some(b'\n' | b'\r')) {
        line.pop();
    }
    Ok(BoundedLineRead {
        bytes_consumed,
        exceeded_limit: discarded || line.len() > limit,
    })
}

fn decompression_limit(file_size: u64) -> u64 {
    file_size
        .saturating_mul(MAX_DECOMPRESSION_RATIO)
        .max(MIN_DECOMPRESSION_LIMIT)
}

fn batch_byte_limit(memory_limit_mb: u32) -> usize {
    ((memory_limit_mb as usize * 1024 * 1024) / 16).clamp(MIN_BATCH_BYTES, MAX_BATCH_BYTES)
}

fn writer_memory_budget(memory_limit_mb: u32) -> usize {
    (memory_limit_mb as usize * 1024 * 1024)
        .saturating_mul(3)
        .checked_div(4)
        .unwrap_or(MIN_WRITER_BYTES)
        .clamp(MIN_WRITER_BYTES, MAX_WRITER_BYTES)
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
    let mut seen_domains = HashSet::new();
    let mut detected_identifiers = Vec::new();
    let mut seen_identifiers = HashSet::new();
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
                if seen_domains.insert(url.domain.hostname.clone()) {
                    domains.push((url.domain.clone(), Some(url)));
                }
            }
        } else if extract_domains
            && mapping.field_type == FieldType::Domain
            && let Some(domain) = normalize_domain(&original)
        {
            normalized = domain.hostname.clone();
            if seen_domains.insert(domain.hostname.clone()) {
                domains.push((domain, None));
            }
        }
        if matches!(mapping.field_type, FieldType::Unknown | FieldType::Url) {
            for (field_type, value) in extract_embedded_identifiers(&original) {
                if seen_identifiers.insert((field_type, value.clone())) {
                    detected_identifiers.push((field_type, value));
                }
            }
            if extract_domains {
                for domain in extract_embedded_domains(&original) {
                    if seen_domains.insert(domain.hostname.clone()) {
                        domains.push((domain, None));
                    }
                }
            }
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
    for (index, (field_type, value)) in detected_identifiers.into_iter().enumerate() {
        fields.push(ProcessedField {
            name: format!("detected_{}_{}", field_type.as_str(), index + 1),
            field_type,
            original: value.clone(),
            normalized: value,
            sensitive: field_type.is_sensitive(),
            confidence: 0.9,
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

fn extract_embedded_identifiers(value: &str) -> Vec<(FieldType, String)> {
    let mut identifiers = Vec::new();
    let mut seen = HashSet::new();
    for captures in EMBEDDED_EMAIL.captures_iter(value) {
        let Some(email) = captures.get(1) else {
            continue;
        };
        let normalized = normalize_value(FieldType::Email, email.as_str());
        if !normalized.is_empty() && seen.insert((FieldType::Email, normalized.clone())) {
            identifiers.push((FieldType::Email, normalized));
        }
    }
    for candidate in value.split(['\t', '|', ';', ',', ':']) {
        let candidate = candidate.trim();
        if candidate.len() < 7
            || candidate.len() > 32
            || !candidate.chars().all(|character| {
                character.is_ascii_digit() || matches!(character, '+' | ' ' | '(' | ')' | '-')
            })
        {
            continue;
        }
        let normalized = normalize_value(FieldType::Phone, candidate);
        let digit_count = normalized.chars().filter(char::is_ascii_digit).count();
        if (7..=15).contains(&digit_count) && seen.insert((FieldType::Phone, normalized.clone())) {
            identifiers.push((FieldType::Phone, normalized));
        }
    }
    identifiers
}

fn extract_embedded_domains(value: &str) -> Vec<NormalizedDomain> {
    let mut domains = Vec::new();
    let mut seen = HashSet::new();
    for captures in EMBEDDED_DOMAIN.captures_iter(value) {
        let Some(candidate) = captures.get(1) else {
            continue;
        };
        let Some(domain) = normalize_domain(candidate.as_str()) else {
            continue;
        };
        if seen.insert(domain.hostname.clone()) {
            domains.push(domain);
        }
    }
    domains
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
    let mut duplicate_statement = if plan.options.deduplicate {
        Some(
            transaction
                .prepare_cached(
                    "SELECT EXISTS(
                        SELECT 1 FROM records WHERE dataset_id = ?1 AND record_fingerprint = ?2
                     )",
                )
                .map_err(sanitized)?,
        )
    } else {
        None
    };
    let mut record_statement = transaction
        .prepare_cached(
            "INSERT INTO records(
                id, dataset_id, source_file_id, source_location, byte_offset,
                record_fingerprint, parser
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )
        .map_err(sanitized)?;
    let mut field_statement = transaction
        .prepare_cached(
            "INSERT INTO field_values(
                record_id, field_name, field_type, original_value, normalized_value,
                is_sensitive, confidence
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )
        .map_err(sanitized)?;
    for record in batch.drain(..) {
        if let Some(statement) = duplicate_statement.as_mut() {
            let exists = statement
                .query_row(params![dataset_id, record.fingerprint], |row| {
                    row.get::<_, bool>(0)
                })
                .map_err(sanitized)?;
            if exists {
                counters.duplicate_records += 1;
                continue;
            }
        }
        record_statement
            .execute(params![
                record.id,
                dataset_id,
                file.id,
                record.source_location,
                record.byte_offset.map(|value| value as i64),
                record.fingerprint,
                PARSER_VERSION,
            ])
            .map_err(sanitized)?;
        let mut exact_values = Vec::new();
        for field in &record.fields {
            field_statement
                .execute(params![
                    record.id,
                    field.name,
                    field.field_type.as_str(),
                    field.original,
                    field.normalized,
                    field.sensitive,
                    field.confidence,
                ])
                .map_err(sanitized)?;
            if plan.options.group_identities {
                store_identity(
                    &transaction,
                    &record.id,
                    &file.id,
                    field.field_type,
                    &field.normalized,
                )?;
            }
            if !field.field_type.is_secret() && !field.normalized.is_empty() {
                exact_values.push(field.normalized.clone());
                exact_values.push(format!(
                    "{}:{}",
                    field.field_type.as_str(),
                    field.normalized
                ));
            }
        }
        if plan.options.extract_domains || plan.options.extract_urls {
            for (domain, url) in &record.domains {
                exact_values.push(domain.hostname.clone());
                exact_values.push(format!("domain:{}", domain.hostname));
                if domain.registrable_domain != domain.hostname {
                    exact_values.push(domain.registrable_domain.clone());
                    exact_values.push(format!("domain:{}", domain.registrable_domain));
                }
                store_domain(&transaction, &record.id, dataset_id, domain, url.as_ref())
                    .map_err(sanitized)?;
            }
        }
        exact_values.sort_unstable();
        exact_values.dedup();
        writer
            .add_document(make_document(
                index_fields,
                &record.id,
                dataset_id,
                &exact_values,
            ))
            .map_err(sanitized)?;
        counters.records_indexed += 1;
    }
    drop(field_statement);
    drop(record_statement);
    drop(duplicate_statement);
    transaction.commit().map_err(sanitized)?;
    connection
        .execute(
            "UPDATE datasets
             SET record_count = ?2, warning_count = ?3,
                 last_indexed_at = CURRENT_TIMESTAMP
             WHERE id = ?1",
            params![
                dataset_id,
                counters.records_indexed as i64,
                counters.invalid_records as i64
            ],
        )
        .map_err(sanitized)?;
    Ok(())
}

fn store_identity(
    connection: &Connection,
    record_id: &str,
    source_file_id: &str,
    field_type: FieldType,
    value: &str,
) -> Result<(), String> {
    if value.is_empty()
        || !matches!(
            field_type,
            FieldType::Email | FieldType::Phone | FieldType::UserId
        )
    {
        return Ok(());
    }
    let field_type_name = field_type.as_str();
    let key = if field_type == FieldType::UserId {
        format!("{source_file_id}\u{1f}{value}")
    } else {
        value.to_string()
    };
    let group_id = stable_id("identity", &format!("{field_type_name}\u{1f}{key}"));
    let candidate_key = stable_id(
        "identity-candidate",
        &format!("{field_type_name}\u{1f}{key}"),
    );
    let display = value.to_string();
    let candidate = connection
        .prepare_cached(
            "SELECT first_record_id, member_count
             FROM identity_candidates WHERE candidate_key = ?1",
        )
        .map_err(sanitized)?
        .query_row([&candidate_key], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .optional()
        .map_err(sanitized)?;
    let Some((first_record_id, member_count)) = candidate else {
        connection
            .prepare_cached(
                "INSERT INTO identity_candidates(
                    candidate_key, link_type, display_label, first_record_id,
                    group_id, member_count
                 ) VALUES (?1, ?2, ?3, ?4, ?5, 1)
                 ON CONFLICT(candidate_key) DO NOTHING",
            )
            .map_err(sanitized)?
            .execute(params![
                candidate_key,
                field_type_name,
                display,
                record_id,
                group_id
            ])
            .map_err(sanitized)?;
        return Ok(());
    };
    if first_record_id == record_id {
        return Ok(());
    }
    connection
        .prepare_cached(
            "INSERT INTO identity_groups(id, display_label, confidence_level)
             VALUES (?1, ?2, 'high')
             ON CONFLICT(id) DO NOTHING",
        )
        .map_err(sanitized)?
        .execute(params![group_id, display])
        .map_err(sanitized)?;
    let explanation = serde_json::json!({
        "rule": format!("exact_normalized_{field_type_name}"),
        "deterministic": true
    });
    if member_count <= 1 {
        connection
            .prepare_cached(
                "INSERT OR IGNORE INTO identity_memberships(
                    identity_group_id, record_id, link_type, confidence_score,
                    explanation_json, user_status
                 )
                 SELECT ?1, r.id, ?3, 1.0, ?4, 'automatic'
                 FROM records r WHERE r.id = ?2",
            )
            .map_err(sanitized)?
            .execute(params![
                group_id,
                first_record_id,
                format!("exact_{field_type_name}"),
                explanation.to_string()
            ])
            .map_err(sanitized)?;
    }
    let inserted = connection
        .prepare_cached(
            "INSERT OR IGNORE INTO identity_memberships(
                identity_group_id, record_id, link_type, confidence_score,
                explanation_json, user_status
             ) VALUES (?1, ?2, ?3, 1.0, ?4, 'automatic')",
        )
        .map_err(sanitized)?
        .execute(params![
            group_id,
            record_id,
            format!("exact_{field_type_name}"),
            explanation.to_string()
        ])
        .map_err(sanitized)?;
    if inserted > 0 {
        connection
            .prepare_cached(
                "UPDATE identity_candidates
                 SET member_count = member_count + 1
                 WHERE candidate_key = ?1",
            )
            .map_err(sanitized)?
            .execute([candidate_key])
            .map_err(sanitized)?;
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
        io::{self, BufReader, BufWriter, Cursor, Read, Write},
        sync::{Arc, Mutex},
        time::Instant,
    };

    use flate2::{Compression, write::GzEncoder};
    use tempfile::tempdir;

    use super::{
        BATCH_RECORDS, Counters, INDEX_CHECKPOINT_RECORDS, JobControl, MAX_LINE_BYTES,
        batch_byte_limit, decompression_limit, delete_dataset_from_workspace,
        extract_embedded_domains, extract_embedded_identifiers, finish_cancelled, flush_batch,
        load_resume_plan, normalize_value, prepare_database_rows, prepare_import_database,
        prepare_resume_files, process_record, read_bounded_line, rebuild_domain_groups,
        rebuild_identity_groups, run_import, store_identity, stream_file, validate_plan,
        writer_memory_budget,
    };
    use crate::{
        detection::inspect_paths,
        models::{FieldMapping, FieldType, ImportOptions, ImportPlan, SearchMode},
        search_index::{SearchIndex, make_document},
        storage::open_database,
    };

    struct RepeatingRecordReader {
        pattern: Vec<u8>,
        pattern_offset: usize,
        remaining: u64,
    }

    #[test]
    fn import_authorization_note_is_optional_but_bounded() {
        let source = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("tests")
            .join("fixtures")
            .join("records_valid.csv");
        let inspection = inspect_paths(&[source]).expect("inspection");
        let mut plan = synthetic_plan(inspection.files);
        plan.authorization_note.clear();
        assert!(validate_plan(&plan).is_ok());
        plan.authorization_note = "x".repeat(501);
        assert!(validate_plan(&plan).is_err());
    }

    impl RepeatingRecordReader {
        fn new(total_bytes: u64) -> Self {
            let mut pattern = vec![b'a'; 4095];
            pattern.push(b'\n');
            Self {
                pattern,
                pattern_offset: 0,
                remaining: total_bytes,
            }
        }
    }

    impl Read for RepeatingRecordReader {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            let requested = buffer.len().min(self.remaining as usize);
            let mut written = 0;
            while written < requested {
                let available = self.pattern.len() - self.pattern_offset;
                let copy = available.min(requested - written);
                buffer[written..written + copy].copy_from_slice(
                    &self.pattern[self.pattern_offset..self.pattern_offset + copy],
                );
                written += copy;
                self.pattern_offset = (self.pattern_offset + copy) % self.pattern.len();
            }
            self.remaining = self.remaining.saturating_sub(written as u64);
            Ok(written)
        }
    }

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
    fn extracts_domains_from_unstructured_combo_text() {
        let domains = extract_embedded_domains(
            "https://portal.example.co.uk/login:person@example.test:synthetic-secret",
        );
        let hostnames = domains
            .iter()
            .map(|domain| domain.hostname.as_str())
            .collect::<Vec<_>>();
        assert!(hostnames.contains(&"portal.example.co.uk"));
        assert!(hostnames.contains(&"example.test"));
    }

    #[test]
    fn extracts_identifiers_from_combo_text_without_treating_ports_as_phones() {
        let identifiers = extract_embedded_identifiers(
            "https://portal.example.test:8443/login:Person@Example.test:+1 (202) 555-0142:secret",
        );
        assert!(identifiers.contains(&(FieldType::Email, "person@example.test".to_string())));
        assert!(identifiers.contains(&(FieldType::Phone, "+12025550142".to_string())));
        assert!(!identifiers.iter().any(|(_, value)| value == "8443"));
    }

    #[test]
    fn automatic_identities_require_repeated_exact_identifiers_and_rebuild_cleanly() {
        let workspace = tempdir().expect("temporary workspace");
        let mut connection = open_database(workspace.path()).expect("database");
        connection
            .execute_batch(
                "INSERT INTO datasets(
                   id, name, parser_version, status, record_count, file_count
                 ) VALUES ('dataset-id', 'Synthetic identities', 'test', 'ready', 2, 1);
                 INSERT INTO source_files(
                   id, dataset_id, absolute_path, relative_path, file_size, format
                 ) VALUES (
                   'file-id', 'dataset-id', 'C:\\Synthetic\\identities.csv',
                   'identities.csv', 128, 'csv'
                 );
                 INSERT INTO records(
                   id, dataset_id, source_file_id, source_location,
                   record_fingerprint, parser
                 ) VALUES
                   ('record-a', 'dataset-id', 'file-id', 'line 2', 'fp-a', 'test'),
                   ('record-b', 'dataset-id', 'file-id', 'line 3', 'fp-b', 'test');
                 INSERT INTO field_values(
                   record_id, field_name, field_type, original_value,
                   normalized_value, is_sensitive, confidence
                 ) VALUES
                   ('record-a', 'email', 'email', 'same@example.test',
                    'same@example.test', 0, 1.0),
                   ('record-b', 'email', 'email', 'same@example.test',
                    'same@example.test', 0, 1.0);",
            )
            .expect("synthetic identity records");

        store_identity(
            &connection,
            "record-a",
            "file-id",
            FieldType::Email,
            "same@example.test",
        )
        .expect("first candidate");
        store_identity(
            &connection,
            "record-b",
            "file-id",
            FieldType::Email,
            "same@example.test",
        )
        .expect("second candidate");
        store_identity(
            &connection,
            "record-b",
            "file-id",
            FieldType::Email,
            "same@example.test",
        )
        .expect("duplicate candidate");

        let before: (i64, i64, i64) = connection
            .query_row(
                "SELECT
                   (SELECT COUNT(*) FROM identity_groups),
                   (SELECT COUNT(*) FROM identity_memberships),
                   (SELECT member_count FROM identity_candidates LIMIT 1)",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("automatic identity");
        assert_eq!(before, (1, 2, 2));
        let display_label: String = connection
            .query_row("SELECT display_label FROM identity_groups", [], |row| {
                row.get(0)
            })
            .expect("identity label");
        assert_eq!(display_label, "same@example.test");

        let rebuilt = rebuild_identity_groups(&mut connection).expect("rebuild identities");
        let after_members: i64 = connection
            .query_row("SELECT COUNT(*) FROM identity_memberships", [], |row| {
                row.get(0)
            })
            .expect("rebuilt members");
        assert_eq!(rebuilt, 1);
        assert_eq!(after_members, 2);
    }

    #[test]
    fn rebuild_domains_links_unstructured_records_from_multiple_datasets() {
        let workspace = tempdir().expect("temporary workspace");
        let mut connection = open_database(workspace.path()).expect("database");
        connection
            .execute_batch(
                "INSERT INTO datasets(
                   id, name, parser_version, status, record_count, file_count
                 ) VALUES
                   ('dataset-a', 'Synthetic A', 'test', 'ready', 1, 1),
                   ('dataset-b', 'Synthetic B', 'test', 'ready', 1, 1);
                 INSERT INTO source_files(
                   id, dataset_id, absolute_path, relative_path, file_size, format
                 ) VALUES
                   ('file-a', 'dataset-a', 'C:\\Synthetic\\a.txt', 'a.txt', 64, 'text'),
                   ('file-b', 'dataset-b', 'C:\\Synthetic\\b.txt', 'b.txt', 64, 'text');
                 INSERT INTO records(
                   id, dataset_id, source_file_id, source_location,
                   record_fingerprint, parser
                 ) VALUES
                   ('record-a', 'dataset-a', 'file-a', 'line 1', 'fp-a', 'test'),
                   ('record-b', 'dataset-b', 'file-b', 'line 1', 'fp-b', 'test');
                 INSERT INTO field_values(
                   record_id, field_name, field_type, original_value,
                   normalized_value, is_sensitive, confidence
                 ) VALUES
                   ('record-a', 'line', 'unknown',
                    'https://portal.example.test/a:user@example.test', 'opaque-a', 0, 0.4),
                   ('record-b', 'line', 'unknown',
                    'https://api.example.test/b:user@example.test', 'opaque-b', 0, 0.4);",
            )
            .expect("synthetic domain records");

        let groups = rebuild_domain_groups(&mut connection).expect("domain rebuild");
        let linked_datasets: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM domain_dataset_counts
                 WHERE registrable_domain = 'example.test'",
                [],
                |row| row.get(0),
            )
            .expect("linked datasets");
        assert_eq!(groups, 1);
        assert_eq!(linked_datasets, 2);
    }

    #[test]
    fn rebuild_finds_repeated_emails_inside_combo_text() {
        let workspace = tempdir().expect("temporary workspace");
        let mut connection = open_database(workspace.path()).expect("database");
        connection
            .execute_batch(
                "INSERT INTO datasets(
                   id, name, parser_version, status, record_count, file_count
                 ) VALUES ('dataset-id', 'Synthetic combo rows', 'test', 'ready', 2, 1);
                 INSERT INTO source_files(
                   id, dataset_id, absolute_path, relative_path, file_size, format
                 ) VALUES (
                   'file-id', 'dataset-id', 'C:\\Synthetic\\combo.txt',
                   'combo.txt', 128, 'text'
                 );
                 INSERT INTO records(
                   id, dataset_id, source_file_id, source_location,
                   record_fingerprint, parser
                 ) VALUES
                   ('record-a', 'dataset-id', 'file-id', 'line 1', 'fp-a', 'test'),
                   ('record-b', 'dataset-id', 'file-id', 'line 2', 'fp-b', 'test');
                 INSERT INTO field_values(
                   record_id, field_name, field_type, original_value,
                   normalized_value, is_sensitive, confidence
                 ) VALUES
                   ('record-a', 'line', 'url',
                    'https://one.example:shared@example.test:first-secret',
                    'https://one.example/', 0, 1.0),
                   ('record-b', 'line', 'unknown',
                    'https://two.example:shared@example.test:second-secret',
                    'opaque', 0, 0.4);",
            )
            .expect("synthetic combo records");

        let rebuilt = rebuild_identity_groups(&mut connection).expect("combo identity rebuild");
        let memberships: i64 = connection
            .query_row("SELECT COUNT(*) FROM identity_memberships", [], |row| {
                row.get(0)
            })
            .expect("identity memberships");
        assert_eq!(rebuilt, 1);
        assert_eq!(memberships, 2);
    }

    #[test]
    fn oversized_lines_are_discarded_with_bounded_memory() {
        let mut source = vec![b'x'; MAX_LINE_BYTES * 3];
        source.extend_from_slice(b"\nnext-record\n");
        let mut reader = BufReader::with_capacity(64 * 1024, Cursor::new(source));
        let mut line = Vec::new();
        let control = JobControl::default();

        let oversized = read_bounded_line(&mut reader, &mut line, MAX_LINE_BYTES, &control)
            .expect("oversized line");
        assert!(oversized.exceeded_limit);
        assert!(line.len() <= MAX_LINE_BYTES + 2);

        let next = read_bounded_line(&mut reader, &mut line, MAX_LINE_BYTES, &control)
            .expect("following line");
        assert!(!next.exceeded_limit);
        assert_eq!(line, b"next-record");
    }

    #[test]
    fn resource_math_supports_multi_terabyte_sources_without_overflow() {
        let three_hundred_gib = 300_u64 * 1024 * 1024 * 1024;
        let four_tebibytes = 4_u64 * 1024 * 1024 * 1024 * 1024;
        assert_eq!(
            decompression_limit(three_hundred_gib),
            three_hundred_gib * 100
        );
        assert_eq!(decompression_limit(four_tebibytes), four_tebibytes * 100);
        assert_eq!(batch_byte_limit(256), 16 * 1024 * 1024);
        assert_eq!(batch_byte_limit(4_096), 64 * 1024 * 1024);
        assert_eq!(writer_memory_budget(256), 192 * 1024 * 1024);
        assert_eq!(writer_memory_budget(4_096), 2 * 1024 * 1024 * 1024);
        assert_eq!(BATCH_RECORDS, 10_000);
        assert_eq!(INDEX_CHECKPOINT_RECORDS, 1_000_000);
    }

    #[test]
    fn background_import_preparation_removes_legacy_redundant_indexes() {
        let workspace = tempdir().expect("temporary workspace");
        let connection = open_database(workspace.path()).expect("database");
        connection
            .execute(
                "CREATE INDEX field_values_normalized_idx
                 ON field_values(field_type, normalized_value)",
                [],
            )
            .expect("legacy index");
        connection
            .execute(
                "CREATE INDEX records_fingerprint_idx
                 ON records(record_fingerprint)",
                [],
            )
            .expect("legacy fingerprint index");

        prepare_import_database(&connection).expect("background preparation");

        let remaining: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'index'
                   AND name IN (
                     'field_values_normalized_idx',
                     'records_fingerprint_idx',
                     'records_dataset_fingerprint_idx'
                   )",
                [],
                |row| row.get(0),
            )
            .expect("index state");
        assert_eq!(remaining, 0);
    }

    #[test]
    #[ignore = "manual generated-stream soak test"]
    fn generated_gibibyte_stream_stays_bounded() {
        let gibibytes = std::env::var("ALETHEIA_SOAK_GIB")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(1)
            .clamp(1, 4_096);
        let target_bytes = gibibytes * 1024 * 1024 * 1024;
        let source = RepeatingRecordReader::new(target_bytes);
        let mut reader = BufReader::with_capacity(64 * 1024, source);
        let mut line = Vec::new();
        let control = JobControl::default();
        let mut consumed = 0_u64;
        let mut max_retained = 0_usize;

        while consumed < target_bytes {
            let read = read_bounded_line(&mut reader, &mut line, MAX_LINE_BYTES, &control)
                .expect("generated line");
            assert!(!read.exceeded_limit);
            consumed = consumed.saturating_add(read.bytes_consumed);
            max_retained = max_retained.max(line.len());
        }

        assert_eq!(consumed, target_bytes);
        assert!(max_retained <= 4095);
        assert!(line.capacity() <= 8192);
    }

    #[test]
    #[ignore = "manual generated full-index throughput soak test"]
    fn generated_full_index_pipeline_soak() {
        let record_count = std::env::var("ALETHEIA_INDEX_SOAK_RECORDS")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(100_000)
            .clamp(10_000, 5_000_000);
        let workspace = tempdir().expect("temporary workspace");
        let source = workspace.path().join("generated-index-soak.csv");
        let mut writer = BufWriter::new(File::create(&source).expect("generated synthetic source"));
        writeln!(writer, "user_id,email,url").expect("header");
        for record in 0..record_count {
            writeln!(
                writer,
                "user-{record:010},person-{record:010}@example.com,https://node-{record:010}.example.net/item/{record}"
            )
            .expect("synthetic record");
        }
        writer.flush().expect("flush synthetic source");

        let inspection = inspect_paths(std::slice::from_ref(&source)).expect("inspection");
        let plan = ImportPlan {
            dataset_label: "Generated index soak".to_string(),
            authorization_note: "Invented generated records only".to_string(),
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
            open_database(workspace.path()).expect("database"),
        ));
        let files =
            prepare_database_rows(&database, "dataset-soak", "job-soak", &plan).expect("rows");
        let started = Instant::now();
        run_import(
            None,
            &database,
            workspace.path(),
            "job-soak",
            "dataset-soak",
            plan.files.iter().map(|file| file.file_size).sum(),
            2,
            512,
            files,
            &plan,
            &JobControl::default(),
        )
        .expect("full index import");

        let indexed: i64 = database
            .lock()
            .expect("database")
            .query_row(
                "SELECT COUNT(*) FROM records WHERE dataset_id = 'dataset-soak'",
                [],
                |row| row.get(0),
            )
            .expect("indexed count");
        assert_eq!(indexed as u64, record_count);
        let domain_links: i64 = database
            .lock()
            .expect("database")
            .query_row(
                "SELECT record_count FROM domain_dataset_counts
                 WHERE registrable_domain = 'example.net'
                   AND dataset_id = 'dataset-soak'",
                [],
                |row| row.get(0),
            )
            .expect("domain aggregate");
        assert_eq!(domain_links as u64, record_count);
        let identity_candidates: i64 = database
            .lock()
            .expect("database")
            .query_row("SELECT COUNT(*) FROM identity_candidates", [], |row| {
                row.get(0)
            })
            .expect("identity candidates");
        let identity_groups: i64 = database
            .lock()
            .expect("database")
            .query_row("SELECT COUNT(*) FROM identity_groups", [], |row| row.get(0))
            .expect("identity groups");
        assert_eq!(identity_candidates as u64, record_count * 2);
        assert_eq!(identity_groups, 0);
        eprintln!(
            "indexed {record_count} generated records in {:.2?}",
            started.elapsed()
        );
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
            2,
            512,
            files,
            &plan,
            &JobControl::default(),
        )
        .expect("import");

        let mut connection = database.lock().expect("database lock");
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
        let linked_domain_records: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM record_domains
                 WHERE registrable_domain = 'example.co.uk'",
                [],
                |row| row.get(0),
            )
            .expect("record domain links");
        assert!(linked_domain_records > 0);
        let username_links: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM identity_memberships
                 WHERE link_type LIKE '%username%'",
                [],
                |row| row.get(0),
            )
            .expect("username links");
        assert_eq!(username_links, 0);
        let identity_links: i64 = connection
            .query_row("SELECT COUNT(*) FROM identity_memberships", [], |row| {
                row.get(0)
            })
            .expect("identity links");
        assert_eq!(identity_links, 0);
        let identity_candidates: i64 = connection
            .query_row("SELECT COUNT(*) FROM identity_candidates", [], |row| {
                row.get(0)
            })
            .expect("identity candidates");
        assert!(identity_candidates > 0);
        let rebuilt =
            rebuild_identity_groups(&mut connection).expect("rebuild deterministic identities");
        assert_eq!(rebuilt, 0);
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
        let (_, domain_record_ids) = search
            .search_record_ids(
                "example.co.uk",
                SearchMode::Exact,
                None,
                Some("domain"),
                0,
                20,
            )
            .expect("exact domain search");
        assert!(!domain_record_ids.is_empty());
    }

    #[test]
    fn cancelled_plain_import_resumes_without_reindexing_stored_records() {
        let workspace = tempdir().expect("temporary workspace");
        let fixture = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("tests")
            .join("fixtures")
            .join("records_valid.csv");
        let inspection = inspect_paths(&[fixture]).expect("inspection");
        let plan = synthetic_plan(inspection.files);
        let database = Arc::new(Mutex::new(
            open_database(workspace.path()).expect("database"),
        ));
        let files = prepare_database_rows(&database, "dataset-resume", "job-resume", &plan)
            .expect("database rows");
        let search = SearchIndex::open_or_create(workspace.path()).expect("index");
        let mut writer = search.writer().expect("writer");
        let control = JobControl::default();
        let mut counters = Counters {
            bytes_read: 0,
            records_processed: 0,
            records_indexed: 0,
            invalid_records: 0,
            duplicate_records: 0,
        };
        let mut first_batch = Vec::new();
        let partial = stream_file(
            &files[0],
            &plan,
            &control,
            &mut counters,
            |record, counters| {
                first_batch.push(record);
                flush_batch(
                    &database,
                    &mut writer,
                    search.fields,
                    "dataset-resume",
                    &files[0],
                    &plan,
                    counters,
                    &mut first_batch,
                )?;
                control.cancel();
                Ok(())
            },
        );
        assert!(partial.is_err());
        writer.commit().expect("partial commit");
        drop(writer);
        finish_cancelled(
            None,
            &database,
            "job-resume",
            "dataset-resume",
            plan.files[0].file_size,
            &counters,
        )
        .expect("cancelled status");

        let (job_id, mut resumed_plan) =
            load_resume_plan(&database, "dataset-resume").expect("saved plan");
        let resumed_files = prepare_resume_files(&database, "dataset-resume", &mut resumed_plan)
            .expect("resume files");
        assert!(resumed_files[0].resume_offset > 0);
        run_import(
            None,
            &database,
            workspace.path(),
            &job_id,
            "dataset-resume",
            resumed_plan.files[0].file_size,
            2,
            512,
            resumed_files,
            &resumed_plan,
            &JobControl::default(),
        )
        .expect("resumed import");

        let connection = database.lock().expect("database");
        let record_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM records WHERE dataset_id = 'dataset-resume'",
                [],
                |row| row.get(0),
            )
            .expect("record count");
        let status: String = connection
            .query_row(
                "SELECT status FROM datasets WHERE id = 'dataset-resume'",
                [],
                |row| row.get(0),
            )
            .expect("dataset status");
        assert_eq!(record_count, 3);
        assert_eq!(status, "ready");
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
                2,
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

        let inspection = inspect_paths(std::slice::from_ref(&gzip_path)).expect("inspection");
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
            2,
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
        let imported_bytes: i64 = database
            .lock()
            .expect("database")
            .query_row(
                "SELECT bytes_read FROM import_jobs WHERE id = 'job-gzip'",
                [],
                |row| row.get(0),
            )
            .expect("source bytes");
        assert_eq!(
            imported_bytes as u64,
            std::fs::metadata(gzip_path).expect("gzip metadata").len()
        );
    }

    #[test]
    fn deleting_dataset_removes_generated_rows_and_keeps_source_file() {
        let workspace = tempdir().expect("temporary workspace");
        let source = workspace.path().join("synthetic-source.txt");
        std::fs::write(&source, "invented fixture").expect("source fixture");
        let connection = open_database(workspace.path()).expect("database");
        connection
            .execute_batch(&format!(
                "INSERT INTO datasets(
                   id, name, status, parser_version, record_count, file_count
                 ) VALUES ('dataset-delete', 'Synthetic', 'ready', 'test', 1, 1);
                 INSERT INTO source_files(
                   id, dataset_id, absolute_path, relative_path, file_size,
                   format, index_status
                 ) VALUES (
                   'file-delete', 'dataset-delete', '{}', 'synthetic-source.txt',
                   16, 'text', 'ready'
                 );
                 INSERT INTO records(
                   id, dataset_id, source_file_id, source_location,
                   record_fingerprint, parser
                 ) VALUES (
                   'record-delete', 'dataset-delete', 'file-delete',
                   'line 1', 'synthetic-delete', 'test'
                 );",
                source.to_string_lossy().replace('\\', "\\\\")
            ))
            .expect("synthetic dataset");
        let search = SearchIndex::open_or_create(workspace.path()).expect("search index");
        let mut writer = search.writer().expect("writer");
        writer
            .add_document(make_document(
                search.fields,
                "record-delete",
                "dataset-delete",
                &["synthetic-search-value".to_string()],
            ))
            .expect("search document");
        writer.commit().expect("commit");
        drop(writer);

        delete_dataset_from_workspace(workspace.path(), "dataset-delete")
            .expect("dataset deletion");
        let reopened = open_database(workspace.path()).expect("reopen database");
        let dataset_count: i64 = reopened
            .query_row("SELECT COUNT(*) FROM datasets", [], |row| row.get(0))
            .expect("dataset count");
        let audit_count: i64 = reopened
            .query_row(
                "SELECT COUNT(*) FROM audit_events WHERE event_type = 'dataset_removed'",
                [],
                |row| row.get(0),
            )
            .expect("audit count");
        let (_, hits) = SearchIndex::open_or_create(workspace.path())
            .expect("search index")
            .search_record_ids(
                "synthetic-search-value",
                SearchMode::Exact,
                None,
                None,
                0,
                20,
            )
            .expect("search after deletion");
        assert_eq!(dataset_count, 0);
        assert_eq!(audit_count, 1);
        assert!(hits.is_empty());
        assert!(source.exists(), "source files must never be deleted");
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
