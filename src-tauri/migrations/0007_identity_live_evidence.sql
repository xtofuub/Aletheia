CREATE TABLE IF NOT EXISTS identity_live_evidence (
  id TEXT PRIMARY KEY,
  identity_group_id TEXT NOT NULL REFERENCES identity_groups(id) ON DELETE CASCADE,
  source_path TEXT NOT NULL,
  source_file TEXT NOT NULL,
  archive_entry TEXT,
  source_location TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  match_reason TEXT NOT NULL,
  evidence_fingerprint TEXT NOT NULL,
  user_status TEXT NOT NULL DEFAULT 'confirmed',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(identity_group_id, evidence_fingerprint)
);

CREATE INDEX IF NOT EXISTS identity_live_evidence_group_idx
  ON identity_live_evidence(identity_group_id, created_at, id);
