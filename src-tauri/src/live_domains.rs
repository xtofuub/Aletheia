use std::sync::{Arc, Mutex};

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::{domain_analysis::normalize_domain, storage::AppState};

const MAX_EVIDENCE: usize = 5_000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveDomainEvidenceInput {
    pub source_path: String,
    pub source_file: String,
    pub archive_entry: Option<String>,
    pub source_location: String,
    pub excerpt: String,
    pub match_reason: String,
    pub matched_query: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveLiveDomainEvidenceInput {
    pub domain: String,
    pub source_id: String,
    pub source_name: String,
    pub evidence: Vec<LiveDomainEvidenceInput>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveDomainCollectionSummary {
    pub registrable_domain: String,
    pub source_count: u64,
    pub evidence_count: u64,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveDomainCollectionResponse {
    pub total: u64,
    pub offset: usize,
    pub collections: Vec<LiveDomainCollectionSummary>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredLiveDomainEvidence {
    pub id: String,
    pub source_id: String,
    pub source_name: String,
    pub source_path: String,
    pub source_file: String,
    pub archive_entry: Option<String>,
    pub source_location: String,
    pub excerpt: String,
    pub match_reason: String,
    pub matched_query: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveDomainEvidenceResponse {
    pub registrable_domain: String,
    pub total: u64,
    pub offset: usize,
    pub evidence: Vec<StoredLiveDomainEvidence>,
}

#[tauri::command]
pub async fn save_live_domain_evidence(
    input: SaveLiveDomainEvidenceInput,
    state: State<'_, AppState>,
) -> Result<LiveDomainCollectionSummary, String> {
    let database = state.database.clone();
    tauri::async_runtime::spawn_blocking(move || save_evidence(database, input))
        .await
        .map_err(|_| "live domain evidence task failed".to_string())?
}

#[tauri::command]
pub async fn list_live_domain_collections(
    query: String,
    offset: usize,
    limit: usize,
    state: State<'_, AppState>,
) -> Result<LiveDomainCollectionResponse, String> {
    if query.chars().count() > 253 {
        return Err("domain search exceeds 253 characters".to_string());
    }
    let database = state.database.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let connection = database
            .lock()
            .map_err(|_| "metadata database is unavailable".to_string())?;
        list_collections(&connection, &query, offset, limit)
    })
    .await
    .map_err(|_| "live domain collection task failed".to_string())?
}

#[tauri::command]
pub async fn list_live_domain_evidence(
    domain: String,
    offset: usize,
    limit: usize,
    state: State<'_, AppState>,
) -> Result<LiveDomainEvidenceResponse, String> {
    let parent = normalize_parent(&domain)?;
    let database = state.database.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let connection = database
            .lock()
            .map_err(|_| "metadata database is unavailable".to_string())?;
        list_evidence(&connection, &parent, offset, limit)
    })
    .await
    .map_err(|_| "live domain evidence task failed".to_string())?
}

#[tauri::command]
pub async fn clear_live_domain_evidence(
    domain: String,
    state: State<'_, AppState>,
) -> Result<u64, String> {
    let parent = normalize_parent(&domain)?;
    let database = state.database.clone();
    tauri::async_runtime::spawn_blocking(move || clear_evidence(database, &parent))
        .await
        .map_err(|_| "live domain cleanup task failed".to_string())?
}

pub(crate) fn save_evidence(
    database: Arc<Mutex<Connection>>,
    input: SaveLiveDomainEvidenceInput,
) -> Result<LiveDomainCollectionSummary, String> {
    let parent = normalize_parent(&input.domain)?;
    let source_id = input.source_id.trim();
    let source_name = input.source_name.trim();
    if source_id.is_empty() || source_id.chars().count() > 128 {
        return Err("live source identifier is invalid".to_string());
    }
    if source_name.is_empty() || source_name.chars().count() > 160 {
        return Err("live source name is invalid".to_string());
    }
    if input.evidence.len() > MAX_EVIDENCE {
        return Err("a live domain collection can store at most 5,000 rows".to_string());
    }

    let mut checked = input
        .evidence
        .iter()
        .map(|evidence| validate_evidence(evidence).map(|fingerprint| (fingerprint, evidence)))
        .collect::<Result<Vec<_>, _>>()?;
    checked.sort_unstable_by(|left, right| left.0.cmp(&right.0));
    checked.dedup_by(|left, right| left.0 == right.0);

    let mut connection = database
        .lock()
        .map_err(|_| "metadata database is unavailable".to_string())?;
    let transaction = connection.transaction().map_err(sanitized)?;
    let mut inserted = 0_u64;
    for (fingerprint, evidence) in checked {
        inserted += transaction
            .execute(
                "INSERT OR IGNORE INTO live_domain_evidence(
                   id, registrable_domain, source_id, source_name, source_path,
                   source_file, archive_entry, source_location, excerpt,
                   match_reason, matched_query, evidence_fingerprint
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                params![
                    Uuid::now_v7().to_string(),
                    parent,
                    source_id,
                    source_name,
                    evidence.source_path,
                    evidence.source_file,
                    evidence.archive_entry,
                    evidence.source_location,
                    evidence.excerpt,
                    evidence.match_reason,
                    evidence.matched_query,
                    fingerprint,
                ],
            )
            .map_err(sanitized)? as u64;
    }
    transaction
        .execute(
            "INSERT INTO audit_events(
               id, event_type, entity_type, entity_id, details_json
             ) VALUES (?1, 'live_domain_scan_stored', 'domain', ?2, ?3)",
            params![
                Uuid::new_v4().to_string(),
                parent,
                serde_json::json!({
                    "sourceId": source_id,
                    "inserted": inserted,
                    "storedLocally": true
                })
                .to_string()
            ],
        )
        .map_err(sanitized)?;
    transaction.commit().map_err(sanitized)?;

    collection_summary(&connection, &parent)
}

fn list_collections(
    connection: &Connection,
    query: &str,
    offset: usize,
    limit: usize,
) -> Result<LiveDomainCollectionResponse, String> {
    let query = query.trim().to_lowercase();
    validate_prefix_query(&query)?;
    let pattern = format!("{query}*");
    let filter = if query.is_empty() {
        ""
    } else {
        "WHERE registrable_domain GLOB ?1"
    };
    let count_sql =
        format!("SELECT COUNT(DISTINCT registrable_domain) FROM live_domain_evidence {filter}");
    let total = if query.is_empty() {
        connection
            .query_row(&count_sql, [], |row| row.get::<_, i64>(0))
            .map_err(sanitized)?
    } else {
        connection
            .query_row(&count_sql, [&pattern], |row| row.get::<_, i64>(0))
            .map_err(sanitized)?
    };
    let data_sql = format!(
        "SELECT registrable_domain, COUNT(DISTINCT source_id), COUNT(*), MAX(created_at)
         FROM live_domain_evidence {filter}
         GROUP BY registrable_domain
         ORDER BY MAX(created_at) DESC, registrable_domain
         LIMIT ?{} OFFSET ?{}",
        if query.is_empty() { 1 } else { 2 },
        if query.is_empty() { 2 } else { 3 }
    );
    let mut statement = connection.prepare(&data_sql).map_err(sanitized)?;
    let bounded_limit = limit.clamp(1, 100) as i64;
    let bounded_offset = offset.min(i64::MAX as usize) as i64;
    let map_row = |row: &rusqlite::Row<'_>| {
        Ok(LiveDomainCollectionSummary {
            registrable_domain: row.get(0)?,
            source_count: row.get::<_, i64>(1)? as u64,
            evidence_count: row.get::<_, i64>(2)? as u64,
            updated_at: row.get(3)?,
        })
    };
    let collections = if query.is_empty() {
        statement
            .query_map(params![bounded_limit, bounded_offset], map_row)
            .map_err(sanitized)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(sanitized)?
    } else {
        statement
            .query_map(params![pattern, bounded_limit, bounded_offset], map_row)
            .map_err(sanitized)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(sanitized)?
    };
    Ok(LiveDomainCollectionResponse {
        total: total as u64,
        offset,
        collections,
    })
}

fn list_evidence(
    connection: &Connection,
    parent: &str,
    offset: usize,
    limit: usize,
) -> Result<LiveDomainEvidenceResponse, String> {
    let total = connection
        .query_row(
            "SELECT COUNT(*) FROM live_domain_evidence WHERE registrable_domain = ?1",
            [parent],
            |row| row.get::<_, i64>(0),
        )
        .map_err(sanitized)?;
    let mut statement = connection
        .prepare(
            "SELECT id, source_id, source_name, source_path, source_file,
                    archive_entry, source_location, excerpt, match_reason,
                    matched_query, created_at
             FROM live_domain_evidence
             WHERE registrable_domain = ?1
             ORDER BY created_at DESC, id DESC
             LIMIT ?2 OFFSET ?3",
        )
        .map_err(sanitized)?;
    let bounded_limit = limit.clamp(1, 200) as i64;
    let bounded_offset = offset.min(i64::MAX as usize) as i64;
    let evidence = statement
        .query_map(params![parent, bounded_limit, bounded_offset], |row| {
            Ok(StoredLiveDomainEvidence {
                id: row.get(0)?,
                source_id: row.get(1)?,
                source_name: row.get(2)?,
                source_path: row.get(3)?,
                source_file: row.get(4)?,
                archive_entry: row.get(5)?,
                source_location: row.get(6)?,
                excerpt: row.get(7)?,
                match_reason: row.get(8)?,
                matched_query: row.get(9)?,
                created_at: row.get(10)?,
            })
        })
        .map_err(sanitized)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(sanitized)?;
    Ok(LiveDomainEvidenceResponse {
        registrable_domain: parent.to_string(),
        total: total as u64,
        offset,
        evidence,
    })
}

fn clear_evidence(database: Arc<Mutex<Connection>>, parent: &str) -> Result<u64, String> {
    let connection = database
        .lock()
        .map_err(|_| "metadata database is unavailable".to_string())?;
    let removed = connection
        .execute(
            "DELETE FROM live_domain_evidence WHERE registrable_domain = ?1",
            [parent],
        )
        .map_err(sanitized)? as u64;
    Ok(removed)
}

fn collection_summary(
    connection: &Connection,
    parent: &str,
) -> Result<LiveDomainCollectionSummary, String> {
    connection
        .query_row(
            "SELECT registrable_domain, COUNT(DISTINCT source_id), COUNT(*), MAX(created_at)
             FROM live_domain_evidence
             WHERE registrable_domain = ?1
             GROUP BY registrable_domain",
            [parent],
            |row| {
                Ok(LiveDomainCollectionSummary {
                    registrable_domain: row.get(0)?,
                    source_count: row.get::<_, i64>(1)? as u64,
                    evidence_count: row.get::<_, i64>(2)? as u64,
                    updated_at: row.get(3)?,
                })
            },
        )
        .map_err(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => {
                "the live scan did not return any rows to store".to_string()
            }
            _ => sanitized(error),
        })
}

fn normalize_parent(value: &str) -> Result<String, String> {
    normalize_domain(value.trim())
        .map(|domain| domain.registrable_domain)
        .ok_or_else(|| "enter a valid domain".to_string())
}

fn validate_prefix_query(value: &str) -> Result<(), String> {
    if value
        .chars()
        .any(|character| character.is_control() || matches!(character, '*' | '?' | '[' | ']'))
    {
        return Err("domain search contains unsupported characters".to_string());
    }
    Ok(())
}

fn validate_evidence(evidence: &LiveDomainEvidenceInput) -> Result<String, String> {
    let required = [
        ("source path", evidence.source_path.trim(), 4_096_usize),
        ("source file", evidence.source_file.trim(), 512_usize),
        (
            "source location",
            evidence.source_location.trim(),
            256_usize,
        ),
        ("source excerpt", evidence.excerpt.trim(), 2_048_usize),
        ("match reason", evidence.match_reason.trim(), 256_usize),
        ("matched query", evidence.matched_query.trim(), 512_usize),
    ];
    for (label, value, max) in required {
        if value.is_empty() || value.chars().count() > max {
            return Err(format!("live domain {label} is outside the allowed limit"));
        }
    }
    if evidence
        .archive_entry
        .as_deref()
        .is_some_and(|value| value.chars().count() > 1_024)
    {
        return Err("live domain archive entry is outside the allowed limit".to_string());
    }
    Ok(blake3::hash(
        format!(
            "{}\u{1f}{}\u{1f}{}\u{1f}{}",
            evidence.source_path,
            evidence.archive_entry.as_deref().unwrap_or_default(),
            evidence.source_location,
            evidence.excerpt
        )
        .as_bytes(),
    )
    .to_hex()
    .to_string())
}

fn sanitized(_: rusqlite::Error) -> String {
    "live domain metadata operation failed".to_string()
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use tempfile::tempdir;

    use super::{
        LiveDomainEvidenceInput, SaveLiveDomainEvidenceInput, clear_evidence, list_collections,
        list_evidence, save_evidence,
    };
    use crate::storage::open_database;

    fn input() -> SaveLiveDomainEvidenceInput {
        SaveLiveDomainEvidenceInput {
            domain: "portal.example.co.uk".to_string(),
            source_id: "synthetic-source".to_string(),
            source_name: "Synthetic source".to_string(),
            evidence: vec![LiveDomainEvidenceInput {
                source_path: r"C:\Synthetic\source.txt".to_string(),
                source_file: "source.txt".to_string(),
                archive_entry: None,
                source_location: "line 42".to_string(),
                excerpt: "synthetic@example.test portal.example.co.uk".to_string(),
                match_reason: "Line contains query".to_string(),
                matched_query: "example.co.uk".to_string(),
            }],
        }
    }

    #[test]
    fn live_domain_evidence_is_normalized_deduplicated_and_removable() {
        let workspace = tempdir().expect("workspace");
        let database = Arc::new(Mutex::new(
            open_database(workspace.path()).expect("database"),
        ));
        let first = save_evidence(Arc::clone(&database), input()).expect("first save");
        let second = save_evidence(Arc::clone(&database), input()).expect("second save");
        assert_eq!(first.registrable_domain, "example.co.uk");
        assert_eq!(first.evidence_count, 1);
        assert_eq!(second.evidence_count, 1);

        let connection = database.lock().expect("database lock");
        let collections = list_collections(&connection, "example", 0, 25).expect("collections");
        assert_eq!(collections.total, 1);
        let evidence = list_evidence(&connection, "example.co.uk", 0, 25).expect("evidence");
        assert_eq!(evidence.total, 1);
        drop(connection);

        assert_eq!(clear_evidence(database, "example.co.uk").expect("clear"), 1);
    }
}
