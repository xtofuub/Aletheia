CREATE TABLE IF NOT EXISTS search_history (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  mode TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS search_history_created_idx
ON search_history(created_at DESC);
