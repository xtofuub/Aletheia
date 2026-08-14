use std::{fs, path::PathBuf};

use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use tauri::State;

use crate::storage::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub authorization_confirmed: bool,
    pub theme: String,
    pub storage_root: String,
    pub network_disabled: bool,
    pub clipboard_clear_seconds: u32,
    pub inactivity_lock_minutes: u32,
    pub worker_limit: u32,
    pub memory_limit_mb: u32,
    pub automatic_update_checks: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingInput {
    pub authorization_confirmed: bool,
    pub storage_root: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecuritySettingsInput {
    pub clipboard_clear_seconds: u32,
    pub inactivity_lock_minutes: u32,
    pub worker_limit: u32,
    pub memory_limit_mb: u32,
    pub automatic_update_checks: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStatus {
    pub database_ready: bool,
    pub offline: bool,
    pub metadata_bytes: u64,
    pub index_bytes: u64,
    pub dataset_count: u64,
    pub indexed_documents: u64,
    pub orphaned_index: bool,
    pub storage_root: String,
    pub app_version: String,
}

fn read_json<T: DeserializeOwned>(
    connection: &rusqlite::Connection,
    key: &str,
) -> Result<Option<T>, String> {
    let value: Option<String> = connection
        .query_row(
            "SELECT value_json FROM settings WHERE key = ?1",
            [key],
            |row| row.get(0),
        )
        .optional()
        .map_err(sanitize)?;
    value
        .map(|json| serde_json::from_str(&json).map_err(sanitize))
        .transpose()
}

fn write_json<T: Serialize>(
    connection: &rusqlite::Connection,
    key: &str,
    value: &T,
) -> Result<(), String> {
    let json = serde_json::to_string(value).map_err(sanitize)?;
    connection
        .execute(
            "INSERT INTO settings(key, value_json, updated_at)
             VALUES (?1, ?2, CURRENT_TIMESTAMP)
             ON CONFLICT(key) DO UPDATE SET
               value_json = excluded.value_json,
               updated_at = CURRENT_TIMESTAMP",
            params![key, json],
        )
        .map_err(sanitize)?;
    Ok(())
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<Settings, String> {
    let storage_root = state.current_storage_root().map_err(sanitize)?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "metadata database is unavailable".to_string())?;

    let clipboard_clear_seconds: u32 =
        read_json(&connection, "clipboard_clear_seconds")?.unwrap_or(60);
    let inactivity_lock_minutes: u32 =
        read_json(&connection, "inactivity_lock_minutes")?.unwrap_or(15);
    Ok(Settings {
        authorization_confirmed: read_json(&connection, "authorization_confirmed")?
            .unwrap_or(false),
        theme: read_json(&connection, "theme")?.unwrap_or_else(|| "dark".to_string()),
        storage_root: storage_root.to_string_lossy().into_owned(),
        network_disabled: read_json(&connection, "network_disabled")?.unwrap_or(true),
        clipboard_clear_seconds: clipboard_clear_seconds.clamp(15, 600),
        inactivity_lock_minutes: if inactivity_lock_minutes <= 240 {
            inactivity_lock_minutes
        } else {
            15
        },
        worker_limit: read_json(&connection, "worker_limit")?
            .unwrap_or(2)
            .clamp(1, 8),
        memory_limit_mb: read_json(&connection, "memory_limit_mb")?
            .unwrap_or(512)
            .clamp(256, 4096),
        automatic_update_checks: read_json(&connection, "automatic_update_checks")?.unwrap_or(true),
    })
}

#[tauri::command]
pub fn save_onboarding(
    input: OnboardingInput,
    state: State<'_, AppState>,
) -> Result<Settings, String> {
    if !input.authorization_confirmed {
        return Err("authorization confirmation is required".to_string());
    }
    let storage_root = PathBuf::from(input.storage_root.trim());
    state.switch_storage_root(&storage_root).map_err(sanitize)?;

    {
        let connection = state
            .database
            .lock()
            .map_err(|_| "metadata database is unavailable".to_string())?;
        write_json(&connection, "authorization_confirmed", &true)?;
        write_json(&connection, "network_disabled", &true)?;
    }
    get_settings(state)
}

#[tauri::command]
pub fn update_theme(theme: String, state: State<'_, AppState>) -> Result<(), String> {
    if !matches!(theme.as_str(), "dark" | "light" | "system") {
        return Err("theme must be dark, light, or system".to_string());
    }
    let connection = state
        .database
        .lock()
        .map_err(|_| "metadata database is unavailable".to_string())?;
    write_json(&connection, "theme", &theme)
}

#[tauri::command]
pub fn update_security_settings(
    input: SecuritySettingsInput,
    state: State<'_, AppState>,
) -> Result<Settings, String> {
    if !(15..=600).contains(&input.clipboard_clear_seconds) {
        return Err("clipboard clearing must be between 15 and 600 seconds".to_string());
    }
    if input.inactivity_lock_minutes != 0 && !(1..=240).contains(&input.inactivity_lock_minutes) {
        return Err("inactivity lock must be disabled or between 1 and 240 minutes".to_string());
    }
    if !(1..=8).contains(&input.worker_limit) {
        return Err("index workers must be between 1 and 8".to_string());
    }
    if !(256..=4096).contains(&input.memory_limit_mb) {
        return Err("index memory must be between 256 and 4096 MiB".to_string());
    }
    {
        let mut connection = state
            .database
            .lock()
            .map_err(|_| "metadata database is unavailable".to_string())?;
        let transaction = connection.transaction().map_err(sanitize)?;
        write_json(
            &transaction,
            "clipboard_clear_seconds",
            &input.clipboard_clear_seconds,
        )?;
        write_json(
            &transaction,
            "inactivity_lock_minutes",
            &input.inactivity_lock_minutes,
        )?;
        write_json(&transaction, "worker_limit", &input.worker_limit)?;
        write_json(&transaction, "memory_limit_mb", &input.memory_limit_mb)?;
        write_json(
            &transaction,
            "automatic_update_checks",
            &input.automatic_update_checks,
        )?;
        write_json(&transaction, "network_disabled", &true)?;
        transaction.commit().map_err(sanitize)?;
    }
    get_settings(state)
}

#[tauri::command]
pub async fn get_system_status(state: State<'_, AppState>) -> Result<SystemStatus, String> {
    let app_state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let storage_root = app_state.current_storage_root().map_err(sanitize)?;
        let metadata_bytes = fs::metadata(storage_root.join("metadata.sqlite3"))
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        let index_bytes = directory_size(&storage_root.join("search-index")).unwrap_or(0);
        let dataset_count = app_state
            .database
            .lock()
            .map_err(|_| "metadata database is unavailable".to_string())?
            .query_row("SELECT COUNT(*) FROM datasets", [], |row| {
                row.get::<_, i64>(0)
            })
            .map_err(sanitize)? as u64;
        let indexed_documents = if storage_root.join("search-index").join("meta.json").exists() {
            app_state
                .current_search_index()
                .and_then(|index| index.document_count())
                .unwrap_or(0)
        } else {
            0
        };

        Ok(SystemStatus {
            database_ready: true,
            offline: true,
            metadata_bytes,
            index_bytes,
            dataset_count,
            indexed_documents,
            orphaned_index: is_orphaned_index(dataset_count, indexed_documents),
            storage_root: storage_root.to_string_lossy().into_owned(),
            app_version: env!("CARGO_PKG_VERSION").to_string(),
        })
    })
    .await
    .map_err(|_| "system status task failed".to_string())?
}

fn is_orphaned_index(dataset_count: u64, indexed_documents: u64) -> bool {
    dataset_count == 0 && indexed_documents > 0
}

fn directory_size(root: &std::path::Path) -> Result<u64, std::io::Error> {
    if !root.exists() {
        return Ok(0);
    }
    let mut bytes = 0;
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let metadata = fs::symlink_metadata(entry.path())?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_dir() {
            bytes += directory_size(&entry.path())?;
        } else {
            bytes += metadata.len();
        }
    }
    Ok(bytes)
}

fn sanitize(error: impl std::fmt::Display) -> String {
    let _ = error;
    "local settings operation failed".to_string()
}

#[cfg(test)]
mod tests {
    use super::is_orphaned_index;

    #[test]
    fn orphan_detection_requires_documents_without_a_dataset_catalog() {
        assert!(is_orphaned_index(0, 42));
        assert!(!is_orphaned_index(1, 42));
        assert!(!is_orphaned_index(0, 0));
    }
}
