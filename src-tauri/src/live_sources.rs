use std::{collections::HashSet, fs, path::PathBuf};

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::storage::AppState;

const MAX_LIVE_SOURCE_PATHS: usize = 64;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLiveSourceInput {
    pub name: String,
    pub paths: Vec<String>,
    pub include_archives: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveSourceSummary {
    pub id: String,
    pub name: String,
    pub paths: Vec<String>,
    pub include_archives: bool,
    pub created_at: String,
}

#[tauri::command]
pub fn create_live_source(
    input: CreateLiveSourceInput,
    state: State<'_, AppState>,
) -> Result<LiveSourceSummary, String> {
    let normalized = validate_and_normalize(input)?;
    let mut connection = state
        .database
        .lock()
        .map_err(|_| "metadata database is unavailable".to_string())?;
    insert_live_source(&mut connection, normalized)
}

#[tauri::command]
pub fn list_live_sources(state: State<'_, AppState>) -> Result<Vec<LiveSourceSummary>, String> {
    let connection = state
        .database
        .lock()
        .map_err(|_| "metadata database is unavailable".to_string())?;
    list_live_sources_from_database(&connection)
}

#[tauri::command]
pub fn delete_live_source(id: String, state: State<'_, AppState>) -> Result<(), String> {
    if id.is_empty() || id.len() > 128 {
        return Err("live source identifier is invalid".to_string());
    }
    let mut connection = state
        .database
        .lock()
        .map_err(|_| "metadata database is unavailable".to_string())?;
    delete_live_source_from_database(&mut connection, &id)
}

fn validate_and_normalize(input: CreateLiveSourceInput) -> Result<CreateLiveSourceInput, String> {
    let name = input.name.trim();
    if name.is_empty() || name.chars().count() > 160 {
        return Err("live source name must contain 1 to 160 characters".to_string());
    }
    if input.paths.is_empty() || input.paths.len() > MAX_LIVE_SOURCE_PATHS {
        return Err("choose between 1 and 64 local sources".to_string());
    }

    let mut seen = HashSet::new();
    let mut paths = Vec::with_capacity(input.paths.len());
    for raw in input.paths {
        let path = PathBuf::from(raw);
        if !path.is_absolute() {
            return Err("live source paths must be absolute".to_string());
        }
        if !path.exists() {
            return Err("a selected live source is no longer available".to_string());
        }
        let canonical = fs::canonicalize(&path)
            .map_err(|_| "a selected live source could not be opened".to_string())?;
        let value = canonical.to_string_lossy().into_owned();
        if seen.insert(value.clone()) {
            paths.push(value);
        }
    }

    Ok(CreateLiveSourceInput {
        name: name.to_string(),
        paths,
        include_archives: input.include_archives,
    })
}

fn insert_live_source(
    connection: &mut Connection,
    input: CreateLiveSourceInput,
) -> Result<LiveSourceSummary, String> {
    let id = Uuid::now_v7().to_string();
    let transaction = connection.transaction().map_err(sanitized)?;
    transaction
        .execute(
            "INSERT INTO live_sources(id, name, include_archives)
             VALUES (?1, ?2, ?3)",
            params![id, input.name, input.include_archives],
        )
        .map_err(sanitized)?;
    for (position, path) in input.paths.iter().enumerate() {
        transaction
            .execute(
                "INSERT INTO live_source_paths(
                   id, live_source_id, absolute_path, position
                 ) VALUES (?1, ?2, ?3, ?4)",
                params![Uuid::now_v7().to_string(), id, path, position as i64],
            )
            .map_err(sanitized)?;
    }
    transaction
        .execute(
            "INSERT INTO audit_events(
               id, event_type, entity_type, entity_id, details_json
             ) VALUES (?1, 'live_source_added', 'live_source', ?2, ?3)",
            params![
                Uuid::new_v4().to_string(),
                id,
                format!(
                    r#"{{"pathCount":{},"includeArchives":{}}}"#,
                    input.paths.len(),
                    input.include_archives
                )
            ],
        )
        .map_err(sanitized)?;
    transaction.commit().map_err(sanitized)?;

    list_live_source(connection, &id)?.ok_or_else(|| "live source was not saved".to_string())
}

fn list_live_sources_from_database(
    connection: &Connection,
) -> Result<Vec<LiveSourceSummary>, String> {
    let mut statement = connection
        .prepare("SELECT id FROM live_sources ORDER BY created_at DESC, id DESC")
        .map_err(sanitized)?;
    let ids = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(sanitized)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(sanitized)?;
    ids.into_iter()
        .filter_map(|id| match list_live_source(connection, &id) {
            Ok(Some(source)) => Some(Ok(source)),
            Ok(None) => None,
            Err(error) => Some(Err(error)),
        })
        .collect()
}

fn list_live_source(
    connection: &Connection,
    id: &str,
) -> Result<Option<LiveSourceSummary>, String> {
    let source = connection.query_row(
        "SELECT id, name, include_archives, created_at
         FROM live_sources WHERE id = ?1",
        [id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, bool>(2)?,
                row.get::<_, String>(3)?,
            ))
        },
    );
    let (id, name, include_archives, created_at) = match source {
        Ok(source) => source,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
        Err(error) => return Err(sanitized(error)),
    };
    let mut statement = connection
        .prepare(
            "SELECT absolute_path FROM live_source_paths
             WHERE live_source_id = ?1 ORDER BY position, id",
        )
        .map_err(sanitized)?;
    let paths = statement
        .query_map([&id], |row| row.get::<_, String>(0))
        .map_err(sanitized)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(sanitized)?;
    Ok(Some(LiveSourceSummary {
        id,
        name,
        paths,
        include_archives,
        created_at,
    }))
}

fn delete_live_source_from_database(connection: &mut Connection, id: &str) -> Result<(), String> {
    let transaction = connection.transaction().map_err(sanitized)?;
    let removed = transaction
        .execute("DELETE FROM live_sources WHERE id = ?1", [id])
        .map_err(sanitized)?;
    if removed == 0 {
        return Err("live source was not found".to_string());
    }
    transaction
        .execute(
            "INSERT INTO audit_events(
               id, event_type, entity_type, entity_id, details_json
             ) VALUES (?1, 'live_source_removed', 'live_source', ?2, ?3)",
            params![
                Uuid::new_v4().to_string(),
                id,
                r#"{"sourceFilesDeleted":false,"catalogOnly":true}"#
            ],
        )
        .map_err(sanitized)?;
    transaction.commit().map_err(sanitized)
}

fn sanitized(_: rusqlite::Error) -> String {
    "live source metadata operation failed".to_string()
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::{
        CreateLiveSourceInput, delete_live_source_from_database, insert_live_source,
        list_live_sources_from_database, validate_and_normalize,
    };
    use crate::storage::open_database;

    #[test]
    fn live_sources_persist_and_removal_keeps_original_files() {
        let workspace = tempdir().expect("workspace");
        let sources = tempdir().expect("sources");
        let source_path = sources.path().join("synthetic.txt");
        fs::write(&source_path, "synthetic@example.test\n").expect("synthetic source");
        let mut connection = open_database(workspace.path()).expect("database");

        let input = validate_and_normalize(CreateLiveSourceInput {
            name: "Huge archive".to_string(),
            paths: vec![source_path.to_string_lossy().into_owned()],
            include_archives: true,
        })
        .expect("valid source");
        let created = insert_live_source(&mut connection, input).expect("created");
        let listed = list_live_sources_from_database(&connection).expect("listed");

        assert_eq!(listed, vec![created.clone()]);
        delete_live_source_from_database(&mut connection, &created.id).expect("deleted");
        assert!(
            list_live_sources_from_database(&connection)
                .expect("listed after delete")
                .is_empty()
        );
        assert!(source_path.exists());
    }
}
