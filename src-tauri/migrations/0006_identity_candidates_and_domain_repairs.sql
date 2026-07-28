CREATE TABLE IF NOT EXISTS identity_candidates (
  candidate_key TEXT PRIMARY KEY,
  link_type TEXT NOT NULL,
  display_label TEXT NOT NULL,
  first_record_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  member_count INTEGER NOT NULL DEFAULT 1
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS domain_link_repairs (
  registrable_domain TEXT PRIMARY KEY,
  repaired_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS domains_parent_hostname_idx
  ON domains(registrable_domain, hostname);
