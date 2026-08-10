CREATE TABLE IF NOT EXISTS live_domain_evidence (
  id TEXT PRIMARY KEY,
  registrable_domain TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_path TEXT NOT NULL,
  source_file TEXT NOT NULL,
  archive_entry TEXT,
  source_location TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  match_reason TEXT NOT NULL,
  matched_query TEXT NOT NULL,
  evidence_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(registrable_domain, evidence_fingerprint)
);

CREATE INDEX IF NOT EXISTS live_domain_evidence_domain_idx
  ON live_domain_evidence(registrable_domain, created_at, id);

CREATE INDEX IF NOT EXISTS live_domain_evidence_source_idx
  ON live_domain_evidence(source_id, registrable_domain);
