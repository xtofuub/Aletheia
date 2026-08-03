use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex, RwLock,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const MIGRATION_V1: &str = include_str!("../migrations/0001_initial.sql");
const MIGRATION_V2: &str = include_str!("../migrations/0002_search_history.sql");
const MIGRATION_V3: &str = include_str!("../migrations/0003_import_performance.sql");
const MIGRATION_V4: &str = include_str!("../migrations/0004_record_domains.sql");
const MIGRATION_V5: &str = include_str!("../migrations/0005_resumable_imports.sql");
const MIGRATION_V6: &str =
    include_str!("../migrations/0006_identity_candidates_and_domain_repairs.sql");
const LOCATION_FILE: &str = "storage-location.json";
const DATABASE_FILE: &str = "metadata.sqlite3";

#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("application data directory is unavailable")]
    AppDataUnavailable,
    #[error("storage path must be absolute")]
    RelativeStoragePath,
    #[error("storage path is not a directory")]
    StoragePathNotDirectory,
    #[error("storage lock is unavailable")]
    LockUnavailable,
    #[error("file operation failed")]
    Io(#[from] std::io::Error),
    #[error("metadata database operation failed")]
    Sqlite(#[from] rusqlite::Error),
    #[error("storage locator is invalid")]
    Locator(#[from] serde_json::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StorageLocator {
    root: PathBuf,
}

#[derive(Default)]
pub struct JobControl {
    cancelled: AtomicBool,
    paused: AtomicBool,
}

impl JobControl {
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Relaxed);
    }

    pub fn set_paused(&self, paused: bool) {
        self.paused.store(paused, Ordering::Relaxed);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Relaxed)
    }

    pub fn is_paused(&self) -> bool {
        self.paused.load(Ordering::Relaxed)
    }
}

pub struct AppState {
    pub database: Arc<Mutex<Connection>>,
    pub storage_root: Arc<RwLock<PathBuf>>,
    pub jobs: Arc<Mutex<HashMap<String, Arc<JobControl>>>>,
    app_data_dir: PathBuf,
}

impl AppState {
    pub fn initialize(app: &AppHandle) -> Result<Self, StorageError> {
        let app_data_dir = app
            .path()
            .app_local_data_dir()
            .map_err(|_| StorageError::AppDataUnavailable)?;
        fs::create_dir_all(&app_data_dir)?;

        let storage_root =
            read_locator(&app_data_dir)?.unwrap_or_else(|| app_data_dir.join("workspace"));
        let database = open_database(&storage_root)?;
        recover_interrupted_imports(&database)?;

        Ok(Self {
            database: Arc::new(Mutex::new(database)),
            storage_root: Arc::new(RwLock::new(storage_root)),
            jobs: Arc::new(Mutex::new(HashMap::new())),
            app_data_dir,
        })
    }

    pub fn current_storage_root(&self) -> Result<PathBuf, StorageError> {
        self.storage_root
            .read()
            .map(|path| path.clone())
            .map_err(|_| StorageError::LockUnavailable)
    }

    pub fn switch_storage_root(&self, root: &Path) -> Result<(), StorageError> {
        if !root.is_absolute() {
            return Err(StorageError::RelativeStoragePath);
        }
        if root.exists() && !root.is_dir() {
            return Err(StorageError::StoragePathNotDirectory);
        }

        let normalized = normalize_path(root)?;
        let next_database = open_database(&normalized)?;
        recover_interrupted_imports(&next_database)?;

        write_locator(&self.app_data_dir, &normalized)?;

        let mut database = self
            .database
            .lock()
            .map_err(|_| StorageError::LockUnavailable)?;
        let mut storage_root = self
            .storage_root
            .write()
            .map_err(|_| StorageError::LockUnavailable)?;

        *database = next_database;
        *storage_root = normalized;
        Ok(())
    }
}

pub fn open_database(storage_root: &Path) -> Result<Connection, StorageError> {
    fs::create_dir_all(storage_root)?;
    let database_path = storage_root.join(DATABASE_FILE);
    let mut connection = Connection::open(database_path)?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    connection.pragma_update(None, "synchronous", "NORMAL")?;
    connection.pragma_update(None, "temp_store", "MEMORY")?;
    connection.busy_timeout(Duration::from_secs(10))?;
    apply_migrations(&mut connection)?;
    seed_defaults(&connection)?;
    Ok(connection)
}

fn apply_migrations(connection: &mut Connection) -> Result<(), StorageError> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );",
    )?;

    let current: Option<i64> = connection
        .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
            row.get(0)
        })
        .optional()?
        .flatten();

    if current.unwrap_or(0) < 1 {
        let transaction = connection.transaction()?;
        transaction.execute_batch(MIGRATION_V1)?;
        transaction.execute(
            "INSERT OR IGNORE INTO schema_migrations(version) VALUES (1)",
            [],
        )?;
        transaction.commit()?;
    }
    if current.unwrap_or(0) < 2 {
        let transaction = connection.transaction()?;
        transaction.execute_batch(MIGRATION_V2)?;
        transaction.execute(
            "INSERT OR IGNORE INTO schema_migrations(version) VALUES (2)",
            [],
        )?;
        transaction.commit()?;
    }
    if current.unwrap_or(0) < 3 {
        let transaction = connection.transaction()?;
        transaction.execute_batch(MIGRATION_V3)?;
        transaction.execute(
            "INSERT OR IGNORE INTO schema_migrations(version) VALUES (3)",
            [],
        )?;
        transaction.commit()?;
    }
    if current.unwrap_or(0) < 4 {
        let transaction = connection.transaction()?;
        transaction.execute_batch(MIGRATION_V4)?;
        transaction.execute(
            "INSERT OR IGNORE INTO schema_migrations(version) VALUES (4)",
            [],
        )?;
        transaction.commit()?;
    }
    if current.unwrap_or(0) < 5 {
        let transaction = connection.transaction()?;
        transaction.execute_batch(MIGRATION_V5)?;
        transaction.execute(
            "INSERT OR IGNORE INTO schema_migrations(version) VALUES (5)",
            [],
        )?;
        transaction.commit()?;
    }
    if current.unwrap_or(0) < 6 {
        let transaction = connection.transaction()?;
        transaction.execute_batch(MIGRATION_V6)?;
        transaction.execute(
            "INSERT OR IGNORE INTO schema_migrations(version) VALUES (6)",
            [],
        )?;
        transaction.commit()?;
    }

    Ok(())
}

fn recover_interrupted_imports(connection: &Connection) -> Result<(), StorageError> {
    connection.execute_batch(
        "UPDATE datasets
         SET status = CASE
           WHEN id IN (
             SELECT dataset_id FROM import_jobs WHERE status = 'cancelling'
           ) THEN 'cancelled'
           ELSE 'interrupted'
         END,
         record_count = (
           SELECT COUNT(*) FROM records r WHERE r.dataset_id = datasets.id
         ),
         warning_count = COALESCE((
           SELECT MAX(invalid_records) FROM import_jobs j
           WHERE j.dataset_id = datasets.id
         ), warning_count),
         last_indexed_at = COALESCE(last_indexed_at, CURRENT_TIMESTAMP)
         WHERE id IN (
           SELECT dataset_id FROM import_jobs
           WHERE status IN ('queued', 'running', 'paused', 'cancelling')
         );

         UPDATE source_files
         SET index_status = 'pending'
         WHERE index_status = 'indexing'
           AND dataset_id IN (
             SELECT dataset_id FROM import_jobs
             WHERE status IN ('queued', 'running', 'paused', 'cancelling')
           );

         UPDATE import_jobs
         SET status = CASE
           WHEN status = 'cancelling' THEN 'cancelled'
           ELSE 'interrupted'
         END,
         finished_at = COALESCE(finished_at, CURRENT_TIMESTAMP)
         WHERE status IN ('queued', 'running', 'paused', 'cancelling');",
    )?;
    Ok(())
}

fn seed_defaults(connection: &Connection) -> Result<(), StorageError> {
    let defaults = [
        ("authorization_confirmed", "false"),
        ("theme", "\"dark\""),
        ("network_disabled", "true"),
        ("clipboard_clear_seconds", "60"),
        ("inactivity_lock_minutes", "15"),
        ("worker_limit", "2"),
        ("memory_limit_mb", "512"),
        ("automatic_update_checks", "true"),
    ];
    for (key, value_json) in defaults {
        connection.execute(
            "INSERT OR IGNORE INTO settings(key, value_json) VALUES (?1, ?2)",
            params![key, value_json],
        )?;
    }
    Ok(())
}

fn read_locator(app_data_dir: &Path) -> Result<Option<PathBuf>, StorageError> {
    let path = app_data_dir.join(LOCATION_FILE);
    if !path.exists() {
        return Ok(None);
    }
    let locator: StorageLocator = serde_json::from_slice(&fs::read(path)?)?;
    Ok(Some(locator.root))
}

fn write_locator(app_data_dir: &Path, root: &Path) -> Result<(), StorageError> {
    let destination = app_data_dir.join(LOCATION_FILE);
    let temporary = app_data_dir.join(format!("{LOCATION_FILE}.tmp"));
    let payload = serde_json::to_vec_pretty(&StorageLocator {
        root: root.to_path_buf(),
    })?;
    fs::write(&temporary, payload)?;
    fs::rename(&temporary, &destination)?;
    Ok(())
}

fn normalize_path(path: &Path) -> Result<PathBuf, StorageError> {
    fs::create_dir_all(path)?;
    Ok(fs::canonicalize(path)?)
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::{open_database, recover_interrupted_imports};

    #[test]
    fn migration_creates_foundation_tables_and_defaults() {
        let directory = tempdir().expect("temporary directory");
        let connection = open_database(directory.path()).expect("database opens");

        let table_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'table'
                   AND name IN (
                     'datasets',
                     'source_files',
                     'settings',
                     'record_domains',
                     'record_domain_parents',
                     'domain_dataset_counts',
                     'hostname_dataset_counts',
                     'identity_candidates',
                     'domain_link_repairs'
                   )",
                [],
                |row| row.get(0),
            )
            .expect("table count");
        assert_eq!(table_count, 9);

        let theme: String = connection
            .query_row(
                "SELECT value_json FROM settings WHERE key = 'theme'",
                [],
                |row| row.get(0),
            )
            .expect("theme setting");
        assert_eq!(theme, "\"dark\"");
    }

    #[test]
    fn startup_recovery_marks_orphaned_imports_and_restores_record_totals() {
        let directory = tempdir().expect("temporary directory");
        let connection = open_database(directory.path()).expect("database opens");
        connection
            .execute_batch(
                "INSERT INTO datasets(
                   id, name, status, parser_version, record_count, file_count
                 ) VALUES ('dataset-recovery', 'Synthetic', 'indexing', 'test', 0, 1);
                 INSERT INTO source_files(
                   id, dataset_id, absolute_path, relative_path, file_size,
                   format, index_status
                 ) VALUES (
                   'file-recovery', 'dataset-recovery',
                   'C:\\Synthetic\\records.csv', 'records.csv', 128,
                   'csv', 'indexing'
                 );
                 INSERT INTO import_jobs(
                   id, dataset_id, status, records_indexed
                 ) VALUES (
                   'job-recovery', 'dataset-recovery', 'running', 1
                 );
                 INSERT INTO records(
                   id, dataset_id, source_file_id, source_location,
                   record_fingerprint, parser
                 ) VALUES (
                   'record-recovery', 'dataset-recovery', 'file-recovery',
                   'line 2', 'synthetic', 'test'
                 );",
            )
            .expect("orphaned import state");

        recover_interrupted_imports(&connection).expect("recovery");
        let dataset: (String, i64) = connection
            .query_row(
                "SELECT status, record_count FROM datasets
                 WHERE id = 'dataset-recovery'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("dataset");
        let job: String = connection
            .query_row(
                "SELECT status FROM import_jobs WHERE id = 'job-recovery'",
                [],
                |row| row.get(0),
            )
            .expect("job");
        let file: String = connection
            .query_row(
                "SELECT index_status FROM source_files WHERE id = 'file-recovery'",
                [],
                |row| row.get(0),
            )
            .expect("source");
        assert_eq!(dataset, ("interrupted".to_string(), 1));
        assert_eq!(job, "interrupted");
        assert_eq!(file, "pending");
    }
}
