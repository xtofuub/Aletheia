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

use crate::search_index::SearchIndex;

type SearchIndexCache = Arc<RwLock<Option<(PathBuf, Arc<SearchIndex>)>>>;

const MIGRATION_V1: &str = include_str!("../migrations/0001_initial.sql");
const MIGRATION_V2: &str = include_str!("../migrations/0002_search_history.sql");
const MIGRATION_V3: &str = include_str!("../migrations/0003_import_performance.sql");
const MIGRATION_V4: &str = include_str!("../migrations/0004_record_domains.sql");
const MIGRATION_V5: &str = include_str!("../migrations/0005_resumable_imports.sql");
const MIGRATION_V6: &str =
    include_str!("../migrations/0006_identity_candidates_and_domain_repairs.sql");
const MIGRATION_V7: &str = include_str!("../migrations/0007_identity_live_evidence.sql");
const MIGRATION_V8: &str = include_str!("../migrations/0008_live_sources.sql");
const MIGRATION_V9: &str = include_str!("../migrations/0009_live_domain_evidence.sql");
const MIGRATION_V10: &str = include_str!("../migrations/0010_domain_query_indexes.sql");
const MIGRATION_V11: &str = include_str!("../migrations/0011_overview_metrics.sql");
const MIGRATION_V12: &str = include_str!("../migrations/0012_live_scan_checkpoints.sql");
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

#[derive(Clone)]
pub struct AppState {
    pub database: Arc<Mutex<Connection>>,
    pub storage_root: Arc<RwLock<PathBuf>>,
    pub import_jobs: Arc<Mutex<HashMap<String, Arc<JobControl>>>>,
    pub scan_jobs: Arc<Mutex<HashMap<String, Arc<JobControl>>>>,
    pub overview_refreshing: Arc<AtomicBool>,
    search_index: SearchIndexCache,
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
        recover_interrupted_live_scans(&database)?;

        Ok(Self {
            database: Arc::new(Mutex::new(database)),
            storage_root: Arc::new(RwLock::new(storage_root)),
            import_jobs: Arc::new(Mutex::new(HashMap::new())),
            scan_jobs: Arc::new(Mutex::new(HashMap::new())),
            overview_refreshing: Arc::new(AtomicBool::new(false)),
            search_index: Arc::new(RwLock::new(None)),
            app_data_dir,
        })
    }

    pub fn current_storage_root(&self) -> Result<PathBuf, StorageError> {
        self.storage_root
            .read()
            .map(|path| path.clone())
            .map_err(|_| StorageError::LockUnavailable)
    }

    pub fn current_search_index(&self) -> Result<Arc<SearchIndex>, String> {
        let root = self
            .current_storage_root()
            .map_err(|_| "storage location is unavailable".to_string())?;
        if let Ok(cache) = self.search_index.read()
            && let Some((cached_root, index)) = cache.as_ref()
            && cached_root == &root
        {
            return Ok(Arc::clone(index));
        }
        let index = Arc::new(SearchIndex::open_or_create(&root)?);
        let mut cache = self
            .search_index
            .write()
            .map_err(|_| "search index cache is unavailable".to_string())?;
        *cache = Some((root, Arc::clone(&index)));
        Ok(index)
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
        recover_interrupted_live_scans(&next_database)?;

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
        if let Ok(mut search_index) = self.search_index.write() {
            *search_index = None;
        }
        self.overview_refreshing.store(false, Ordering::Release);
        Ok(())
    }
}

pub fn open_database(storage_root: &Path) -> Result<Connection, StorageError> {
    fs::create_dir_all(storage_root)?;
    let database_path = storage_root.join(DATABASE_FILE);
    let mut connection = Connection::open(database_path)?;
    configure_connection(&connection)?;
    apply_migrations(&mut connection)?;
    seed_defaults(&connection)?;
    Ok(connection)
}

pub fn open_worker_database(storage_root: &Path) -> Result<Connection, StorageError> {
    let database_path = storage_root.join(DATABASE_FILE);
    let connection = Connection::open(database_path)?;
    configure_worker_connection(&connection)?;
    Ok(connection)
}

fn configure_connection(connection: &Connection) -> Result<(), StorageError> {
    connection.pragma_update(None, "journal_mode", "WAL")?;
    configure_worker_connection(connection)
}

fn configure_worker_connection(connection: &Connection) -> Result<(), StorageError> {
    // The primary connection establishes WAL mode once. Repeating the journal-mode
    // transition on every dashboard/search worker can require an exclusive SQLite
    // lock and makes concurrent cold-start reads serialize on slow disks.
    connection.pragma_update(None, "foreign_keys", "ON")?;
    connection.pragma_update(None, "synchronous", "NORMAL")?;
    connection.pragma_update(None, "temp_store", "MEMORY")?;
    // Keep bulk imports from checkpointing a tiny WAL every few thousand rows.
    // These are bounded connection-local caches, not source-sized allocations.
    connection.pragma_update(None, "cache_size", -32_768_i64)?;
    connection.pragma_update(None, "mmap_size", 128_i64 * 1024 * 1024)?;
    connection.pragma_update(None, "wal_autocheckpoint", 32_768_i64)?;
    connection.pragma_update(None, "journal_size_limit", 128_i64 * 1024 * 1024)?;
    connection.busy_timeout(Duration::from_secs(10))?;
    Ok(())
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
    if current.unwrap_or(0) < 7 {
        let transaction = connection.transaction()?;
        transaction.execute_batch(MIGRATION_V7)?;
        transaction.execute(
            "INSERT OR IGNORE INTO schema_migrations(version) VALUES (7)",
            [],
        )?;
        transaction.commit()?;
    }
    if current.unwrap_or(0) < 8 {
        let transaction = connection.transaction()?;
        transaction.execute_batch(MIGRATION_V8)?;
        transaction.execute(
            "INSERT OR IGNORE INTO schema_migrations(version) VALUES (8)",
            [],
        )?;
        transaction.commit()?;
    }
    if current.unwrap_or(0) < 9 {
        let transaction = connection.transaction()?;
        transaction.execute_batch(MIGRATION_V9)?;
        transaction.execute(
            "INSERT OR IGNORE INTO schema_migrations(version) VALUES (9)",
            [],
        )?;
        transaction.commit()?;
    }
    if current.unwrap_or(0) < 10 {
        let transaction = connection.transaction()?;
        transaction.execute_batch(MIGRATION_V10)?;
        transaction.execute(
            "INSERT OR IGNORE INTO schema_migrations(version) VALUES (10)",
            [],
        )?;
        transaction.commit()?;
    }
    if current.unwrap_or(0) < 11 {
        let transaction = connection.transaction()?;
        transaction.execute_batch(MIGRATION_V11)?;
        transaction.execute(
            "INSERT OR IGNORE INTO schema_migrations(version) VALUES (11)",
            [],
        )?;
        transaction.commit()?;
    }
    if current.unwrap_or(0) < 12 {
        let transaction = connection.transaction()?;
        transaction.execute_batch(MIGRATION_V12)?;
        transaction.execute(
            "INSERT OR IGNORE INTO schema_migrations(version) VALUES (12)",
            [],
        )?;
        transaction.commit()?;
    }

    Ok(())
}

fn recover_interrupted_live_scans(connection: &Connection) -> Result<(), StorageError> {
    connection.execute(
        "UPDATE live_scan_sessions
         SET status = 'interrupted',
             message = 'Scan interrupted; continue from the latest safe checkpoint',
             updated_at = CURRENT_TIMESTAMP
         WHERE status IN ('running', 'paused', 'cancelling')",
        [],
    )?;
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
         record_count = MAX(record_count, COALESCE((
           SELECT MAX(records_indexed) FROM import_jobs j
           WHERE j.dataset_id = datasets.id
         ), record_count)),
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
    use rusqlite::Connection;
    use tempfile::tempdir;

    use super::{
        MIGRATION_V1, MIGRATION_V2, MIGRATION_V3, MIGRATION_V4, MIGRATION_V5, MIGRATION_V6,
        MIGRATION_V7, MIGRATION_V8, MIGRATION_V9, MIGRATION_V12, open_database,
        recover_interrupted_imports, recover_interrupted_live_scans,
    };

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
                     'domain_link_repairs',
                     'identity_live_evidence',
                     'live_sources',
                     'live_source_paths',
                     'live_domain_evidence',
                     'overview_metrics',
                     'live_scan_sessions',
                     'live_scan_completed_sources',
                     'live_scan_source_progress',
                     'live_scan_hits'
                   )",
                [],
                |row| row.get(0),
            )
            .expect("table count");
        assert_eq!(table_count, 18);

        assert!(!MIGRATION_V8.is_empty());
        assert!(!MIGRATION_V9.is_empty());
        assert!(!MIGRATION_V12.is_empty());

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
    fn startup_recovery_preserves_live_scan_checkpoint() {
        let directory = tempdir().expect("temporary directory");
        let connection = open_database(directory.path()).expect("database opens");
        connection
            .execute(
                "INSERT INTO live_scan_sessions(
                   id, request_json, scope, status, source_count, files_scanned,
                   total_bytes, source_bytes_scanned, matches, query_count, message
                 ) VALUES (
                   'scan-recovery', '{}', 'search', 'running', 2, 1,
                   200, 100, 4, 1, 'Scanning local sources'
                 )",
                [],
            )
            .expect("orphaned live scan");

        recover_interrupted_live_scans(&connection).expect("recovery");
        let recovered: (String, i64, i64) = connection
            .query_row(
                "SELECT status, files_scanned, matches
                 FROM live_scan_sessions WHERE id = 'scan-recovery'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("live scan");
        assert_eq!(recovered, ("interrupted".to_string(), 1, 4));
    }

    #[test]
    fn startup_recovery_marks_orphaned_imports_from_saved_checkpoints() {
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

    #[test]
    fn migration_upgrades_an_existing_v7_workspace_with_live_sources_and_domains() {
        let directory = tempdir().expect("temporary directory");
        let database_path = directory.path().join("metadata.sqlite3");
        let connection = Connection::open(&database_path).expect("legacy database");
        connection
            .execute_batch(
                "CREATE TABLE schema_migrations (
                   version INTEGER PRIMARY KEY,
                   applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                 );",
            )
            .expect("migration catalog");
        for (index, migration) in [
            MIGRATION_V1,
            MIGRATION_V2,
            MIGRATION_V3,
            MIGRATION_V4,
            MIGRATION_V5,
            MIGRATION_V6,
            MIGRATION_V7,
        ]
        .into_iter()
        .enumerate()
        {
            connection
                .execute_batch(migration)
                .expect("legacy migration");
            connection
                .execute(
                    "INSERT INTO schema_migrations(version) VALUES (?1)",
                    [(index + 1) as i64],
                )
                .expect("legacy migration version");
        }
        drop(connection);

        let upgraded = open_database(directory.path()).expect("upgraded database");
        let version: i64 = upgraded
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .expect("version");
        let live_table_count: i64 = upgraded
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'table'
                   AND name IN (
                     'live_sources',
                     'live_source_paths',
                     'live_domain_evidence'
                   )",
                [],
                |row| row.get(0),
            )
            .expect("live source tables");
        let domain_query_index_count: i64 = upgraded
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'index'
                   AND name IN (
                     'domain_dataset_counts_dataset_records_idx',
                     'hostname_dataset_counts_dataset_hostname_idx'
                   )",
                [],
                |row| row.get(0),
            )
            .expect("domain query indexes");
        assert_eq!(version, 12);
        assert_eq!(live_table_count, 3);
        assert_eq!(domain_query_index_count, 2);
    }
}
