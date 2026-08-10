CREATE TABLE IF NOT EXISTS live_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  include_archives INTEGER NOT NULL DEFAULT 1 CHECK (include_archives IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS live_source_paths (
  id TEXT PRIMARY KEY,
  live_source_id TEXT NOT NULL REFERENCES live_sources(id) ON DELETE CASCADE,
  absolute_path TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(live_source_id, absolute_path)
);

CREATE INDEX IF NOT EXISTS live_source_paths_source_idx
  ON live_source_paths(live_source_id, position);
