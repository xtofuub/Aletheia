use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
};

use rusqlite::{Connection, params};
use serde::Serialize;
use tauri::State;
use uuid::Uuid;

use crate::{
    models::{CleanupRequest, ExportHistoryItem, ExportRequest, ExportResult},
    storage::AppState,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportRecord {
    record_id: String,
    dataset_id: String,
    source_file: String,
    source_location: String,
    fields: BTreeMap<String, String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportManifest {
    export_id: String,
    created_at: String,
    format: String,
    record_count: usize,
    protections: Vec<&'static str>,
    contains_raw_records: bool,
    source_files_modified: bool,
}

#[tauri::command]
pub fn export_records(
    request: ExportRequest,
    state: State<'_, AppState>,
) -> Result<ExportResult, String> {
    validate_export_request(&request)?;
    let destination = validate_destination(&request.destination_path)?;
    let records = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "metadata database is unavailable".to_string())?;
        load_export_records(&connection, &request)?
    };
    let export_id = Uuid::new_v4().to_string();
    let payload = render_export(&request.format, &records)?;
    atomic_write(&destination, &payload)?;
    let manifest_path = PathBuf::from(format!("{}.manifest.json", destination.to_string_lossy()));
    let manifest = ExportManifest {
        export_id: export_id.clone(),
        created_at: chrono::Utc::now().to_rfc3339(),
        format: request.format.clone(),
        record_count: records.len(),
        protections: vec![
            "secret fields excluded",
            "URL credentials and query values excluded",
        ],
        contains_raw_records: false,
        source_files_modified: false,
    };
    let manifest_payload =
        serde_json::to_vec_pretty(&manifest).map_err(|_| "export manifest failed".to_string())?;
    if let Err(error) = atomic_write(&manifest_path, &manifest_payload) {
        let _ = fs::remove_file(&destination);
        return Err(error);
    }
    let connection = state
        .database
        .lock()
        .map_err(|_| "metadata database is unavailable".to_string())?;
    let protections_json = serde_json::json!({
        "strict": true,
        "identifiers": "complete",
        "secretFields": "excluded"
    })
    .to_string();
    connection
        .execute(
            "INSERT INTO export_history(
                id, format, destination_path, record_count, redactions_json
             ) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                export_id,
                request.format,
                destination.to_string_lossy(),
                records.len() as i64,
                protections_json,
            ],
        )
        .map_err(sanitized)?;
    connection
        .execute(
            "INSERT INTO audit_events(
                id, event_type, entity_type, entity_id, details_json
             ) VALUES (?1, 'protected_export', 'export', ?2, ?3)",
            params![
                Uuid::new_v4().to_string(),
                export_id,
                serde_json::json!({
                    "format": request.format,
                    "recordCount": records.len(),
                    "secretFieldsExcluded": true
                })
                .to_string()
            ],
        )
        .map_err(sanitized)?;
    Ok(ExportResult {
        export_id,
        destination_path: destination.to_string_lossy().into_owned(),
        manifest_path: manifest_path.to_string_lossy().into_owned(),
        record_count: records.len(),
    })
}

#[tauri::command]
pub fn list_exports(state: State<'_, AppState>) -> Result<Vec<ExportHistoryItem>, String> {
    let connection = state
        .database
        .lock()
        .map_err(|_| "metadata database is unavailable".to_string())?;
    let mut statement = connection
        .prepare(
            "SELECT id, format, destination_path, record_count, created_at
             FROM export_history ORDER BY created_at DESC LIMIT 1000",
        )
        .map_err(sanitized)?;
    let rows = statement
        .query_map([], |row| {
            Ok(ExportHistoryItem {
                id: row.get(0)?,
                format: row.get(1)?,
                destination_path: row.get(2)?,
                record_count: row.get::<_, i64>(3)? as usize,
                created_at: row.get(4)?,
            })
        })
        .map_err(sanitized)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(sanitized)
}

#[tauri::command]
pub fn cleanup_generated(
    request: CleanupRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let import_active = !state
        .import_jobs
        .lock()
        .map_err(|_| "import job registry is unavailable".to_string())?
        .is_empty();
    let scan_active = !state
        .scan_jobs
        .lock()
        .map_err(|_| "search job registry is unavailable".to_string())?
        .is_empty();
    if import_active || scan_active {
        return Err("cancel active indexing or live search before cleanup".to_string());
    }
    let root = state
        .current_storage_root()
        .map_err(|_| "storage location is unavailable".to_string())?;
    let canonical_root = fs::canonicalize(&root)
        .map_err(|_| "storage location could not be verified".to_string())?;
    for (enabled, name) in [
        (request.index || request.all_generated, "search-index"),
        (request.cache || request.all_generated, "cache"),
        (request.temp || request.all_generated, "temp"),
    ] {
        if enabled {
            remove_generated_directory(&canonical_root, name)?;
        }
    }
    let mut connection = state
        .database
        .lock()
        .map_err(|_| "metadata database is unavailable".to_string())?;
    let transaction = connection.transaction().map_err(sanitized)?;
    if request.index && !request.all_generated {
        transaction
            .execute(
                "UPDATE datasets SET status = 'needs_reindex' WHERE status = 'ready'",
                [],
            )
            .map_err(sanitized)?;
    }
    if request.search_history || request.all_generated {
        transaction
            .execute_batch(
                "DELETE FROM search_history;
                 DELETE FROM live_scan_sessions;",
            )
            .map_err(sanitized)?;
    }
    if request.all_generated {
        transaction
            .execute_batch(
                "DELETE FROM entity_tags;
                 DELETE FROM tags;
                 DELETE FROM notes;
                 DELETE FROM saved_searches;
                 DELETE FROM identity_memberships;
                 DELETE FROM identity_live_evidence;
                 DELETE FROM identity_groups;
                 DELETE FROM identity_candidates;
                 DELETE FROM live_domain_evidence;
                 DELETE FROM domain_link_repairs;
                 DELETE FROM urls;
                 DELETE FROM domains;
                 DELETE FROM field_values;
                 DELETE FROM records;
                 DELETE FROM field_mappings;
                 DELETE FROM import_jobs;
                 DELETE FROM source_files;
                 DELETE FROM datasets;
                 DELETE FROM export_history;
                 DELETE FROM audit_events;",
            )
            .map_err(sanitized)?;
    }
    transaction.commit().map_err(sanitized)?;
    Ok(())
}

fn validate_export_request(request: &ExportRequest) -> Result<(), String> {
    if request.record_ids.is_empty() || request.record_ids.len() > 100_000 {
        return Err("select between 1 and 100,000 records".to_string());
    }
    if !matches!(
        request.format.as_str(),
        "csv" | "json" | "jsonl" | "markdown"
    ) {
        return Err("unsupported export format".to_string());
    }
    Ok(())
}

fn validate_destination(value: &str) -> Result<PathBuf, String> {
    let destination = PathBuf::from(value);
    if !destination.is_absolute() {
        return Err("export destination must be an absolute local path".to_string());
    }
    let parent = destination
        .parent()
        .ok_or_else(|| "export destination has no parent folder".to_string())?;
    let canonical_parent = fs::canonicalize(parent)
        .map_err(|_| "export destination folder does not exist".to_string())?;
    let file_name = destination
        .file_name()
        .ok_or_else(|| "export destination requires a file name".to_string())?;
    Ok(canonical_parent.join(file_name))
}

fn load_export_records(
    connection: &Connection,
    request: &ExportRequest,
) -> Result<Vec<ExportRecord>, String> {
    let mut records = Vec::with_capacity(request.record_ids.len());
    for record_id in &request.record_ids {
        let base = connection
            .query_row(
                "SELECT r.dataset_id, sf.relative_path, r.source_location
                 FROM records r
                 JOIN source_files sf ON sf.id = r.source_file_id
                 WHERE r.id = ?1",
                params![record_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .map_err(sanitized)?;
        let mut statement = connection
            .prepare(
                "SELECT field_name, field_type, original_value, normalized_value, is_sensitive
                 FROM field_values WHERE record_id = ?1 ORDER BY id",
            )
            .map_err(sanitized)?;
        let rows = statement
            .query_map(params![record_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, bool>(4)?,
                ))
            })
            .map_err(sanitized)?;
        let mut fields = BTreeMap::new();
        for row in rows {
            let (name, field_type, original, _normalized, _sensitive) = row.map_err(sanitized)?;
            if matches!(field_type.as_str(), "password" | "password_hash" | "salt") {
                continue;
            }
            let value = match field_type.as_str() {
                "url" => protected_url(&original),
                _ => original,
            };
            fields.insert(name, value);
        }
        records.push(ExportRecord {
            record_id: record_id.clone(),
            dataset_id: base.0,
            source_file: base.1,
            source_location: base.2,
            fields,
        });
    }
    Ok(records)
}

fn render_export(format: &str, records: &[ExportRecord]) -> Result<Vec<u8>, String> {
    match format {
        "json" => serde_json::to_vec_pretty(records).map_err(|_| "JSON export failed".to_string()),
        "jsonl" => {
            let mut output = Vec::new();
            for record in records {
                serde_json::to_writer(&mut output, record)
                    .map_err(|_| "JSONL export failed".to_string())?;
                output.push(b'\n');
            }
            Ok(output)
        }
        "csv" => {
            let mut columns = BTreeSet::new();
            for record in records {
                columns.extend(record.fields.keys().cloned());
            }
            let columns: Vec<String> = columns.into_iter().collect();
            let mut writer = csv::Writer::from_writer(Vec::new());
            let mut header = vec![
                "record_id".to_string(),
                "dataset_id".to_string(),
                "source_file".to_string(),
                "source_location".to_string(),
            ];
            header.extend(columns.iter().cloned());
            writer
                .write_record(&header)
                .map_err(|_| "CSV export failed".to_string())?;
            for record in records {
                let mut row = vec![
                    record.record_id.clone(),
                    record.dataset_id.clone(),
                    record.source_file.clone(),
                    record.source_location.clone(),
                ];
                row.extend(
                    columns
                        .iter()
                        .map(|column| record.fields.get(column).cloned().unwrap_or_default()),
                );
                writer
                    .write_record(&row)
                    .map_err(|_| "CSV export failed".to_string())?;
            }
            writer
                .into_inner()
                .map_err(|_| "CSV export failed".to_string())
        }
        "markdown" => {
            let mut output = format!(
                "# Aletheia findings\n\nRecords: {}\n\n| Record | Dataset | Source | Location |\n|---|---|---|---|\n",
                records.len()
            );
            for record in records {
                output.push_str(&format!(
                    "| `{}` | `{}` | `{}` | {} |\n",
                    record.record_id,
                    record.dataset_id,
                    record.source_file.replace('|', "\\|"),
                    record.source_location.replace('|', "\\|")
                ));
            }
            output.push_str("\nSecret fields were excluded. See the sidecar manifest.\n");
            Ok(output.into_bytes())
        }
        _ => Err("unsupported export format".to_string()),
    }
}

fn atomic_write(destination: &Path, payload: &[u8]) -> Result<(), String> {
    let parent = destination
        .parent()
        .ok_or_else(|| "destination has no parent folder".to_string())?;
    let temporary = parent.join(format!(".aletheia-export-{}.tmp", Uuid::new_v4()));
    fs::write(&temporary, payload).map_err(|_| "export could not be written".to_string())?;
    if destination.exists() {
        fs::remove_file(destination)
            .map_err(|_| "existing export could not be replaced".to_string())?;
    }
    fs::rename(&temporary, destination).map_err(|_| "export could not be finalized".to_string())
}

fn remove_generated_directory(root: &Path, name: &str) -> Result<(), String> {
    if !matches!(name, "search-index" | "cache" | "temp") {
        return Err("cleanup target is not permitted".to_string());
    }
    let canonical_root =
        fs::canonicalize(root).map_err(|_| "cleanup root could not be verified".to_string())?;
    let target = canonical_root.join(name);
    if !target.exists() {
        return Ok(());
    }
    let canonical_target = fs::canonicalize(&target)
        .map_err(|_| "cleanup target could not be verified".to_string())?;
    if canonical_target.parent() != Some(canonical_root.as_path()) {
        return Err("cleanup target escaped the generated storage root".to_string());
    }
    fs::remove_dir_all(canonical_target)
        .map_err(|_| "generated cleanup could not be completed".to_string())
}

fn protected_url(value: &str) -> String {
    let Ok(mut parsed) = url::Url::parse(value) else {
        return value.to_string();
    };
    let _ = parsed.set_username("");
    let _ = parsed.set_password(None);
    parsed.set_query(None);
    parsed.set_fragment(None);
    parsed.to_string()
}

fn sanitized(error: impl std::fmt::Display) -> String {
    let _ = error;
    "protected export operation failed".to_string()
}

#[cfg(test)]
mod tests {
    use std::{collections::BTreeMap, fs};

    use super::{ExportRecord, remove_generated_directory, render_export};

    #[test]
    fn csv_and_jsonl_render_without_raw_record_blobs() {
        let records = vec![ExportRecord {
            record_id: "record-synthetic".to_string(),
            dataset_id: "dataset-synthetic".to_string(),
            source_file: "invented.csv".to_string(),
            source_location: "line 2".to_string(),
            fields: BTreeMap::from([("email".to_string(), "person@example.com".to_string())]),
        }];
        for format in ["csv", "jsonl"] {
            let output = render_export(format, &records).expect("export");
            let text = String::from_utf8(output).expect("utf8");
            assert!(text.contains("person@example.com"));
            assert!(!text.contains("password"));
        }
    }

    #[test]
    fn cleanup_is_limited_to_named_generated_children() {
        let workspace = tempfile::tempdir().expect("synthetic workspace");
        let index = workspace.path().join("search-index");
        let source = workspace.path().join("authorized-source.txt");
        fs::create_dir(&index).expect("index directory");
        fs::write(index.join("segment"), b"generated").expect("generated segment");
        fs::write(&source, b"synthetic source").expect("synthetic source");

        remove_generated_directory(workspace.path(), "search-index").expect("cleanup index");

        assert!(!index.exists());
        assert!(source.exists());
        assert!(remove_generated_directory(workspace.path(), "authorized-source.txt").is_err());
    }
}
