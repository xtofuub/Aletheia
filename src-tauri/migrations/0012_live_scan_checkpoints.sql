CREATE TABLE IF NOT EXISTS live_scan_sessions (
  id TEXT PRIMARY KEY,
  request_json TEXT NOT NULL,
  scope TEXT NOT NULL,
  source_id TEXT,
  source_name TEXT,
  status TEXT NOT NULL,
  current_source TEXT,
  source_count INTEGER NOT NULL DEFAULT 0,
  files_scanned INTEGER NOT NULL DEFAULT 0,
  total_bytes INTEGER NOT NULL DEFAULT 0,
  source_bytes_scanned INTEGER NOT NULL DEFAULT 0,
  content_bytes_scanned INTEGER NOT NULL DEFAULT 0,
  matches INTEGER NOT NULL DEFAULT 0,
  elapsed_ms INTEGER NOT NULL DEFAULT 0,
  query_count INTEGER NOT NULL DEFAULT 0,
  truncated INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS live_scan_sessions_status_idx
  ON live_scan_sessions(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS live_scan_completed_sources (
  session_id TEXT NOT NULL REFERENCES live_scan_sessions(id) ON DELETE CASCADE,
  source_path TEXT NOT NULL,
  source_size INTEGER NOT NULL,
  source_modified_ns INTEGER NOT NULL,
  PRIMARY KEY(session_id, source_path, source_size, source_modified_ns)
);

CREATE TABLE IF NOT EXISTS live_scan_source_progress (
  session_id TEXT NOT NULL REFERENCES live_scan_sessions(id) ON DELETE CASCADE,
  source_path TEXT NOT NULL,
  source_size INTEGER NOT NULL,
  source_modified_ns INTEGER NOT NULL,
  byte_offset INTEGER NOT NULL DEFAULT 0,
  next_line INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(session_id, source_path, source_size, source_modified_ns)
);

CREATE TABLE IF NOT EXISTS live_scan_hits (
  id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES live_scan_sessions(id) ON DELETE CASCADE,
  source_path TEXT NOT NULL,
  source_file TEXT NOT NULL,
  archive_entry TEXT,
  source_location TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  match_reason TEXT NOT NULL,
  matched_query TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(session_id, id)
);

CREATE INDEX IF NOT EXISTS live_scan_hits_session_idx
  ON live_scan_hits(session_id, created_at, id);
