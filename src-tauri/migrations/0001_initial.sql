PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS datasets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source_category TEXT NOT NULL DEFAULT 'authorized-local',
  authorization_note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  record_count INTEGER NOT NULL DEFAULT 0,
  file_count INTEGER NOT NULL DEFAULT 0,
  total_bytes INTEGER NOT NULL DEFAULT 0,
  parser_version TEXT NOT NULL,
  warning_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_indexed_at TEXT
);

CREATE TABLE IF NOT EXISTS source_files (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  absolute_path TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  file_hash TEXT,
  format TEXT NOT NULL,
  encoding TEXT,
  delimiter TEXT,
  modified_at TEXT,
  index_status TEXT NOT NULL DEFAULT 'pending',
  UNIQUE(dataset_id, absolute_path)
);

CREATE TABLE IF NOT EXISTS import_jobs (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  current_file_id TEXT REFERENCES source_files(id) ON DELETE SET NULL,
  bytes_read INTEGER NOT NULL DEFAULT 0,
  total_bytes INTEGER NOT NULL DEFAULT 0,
  records_processed INTEGER NOT NULL DEFAULT 0,
  records_indexed INTEGER NOT NULL DEFAULT 0,
  invalid_records INTEGER NOT NULL DEFAULT 0,
  duplicate_records INTEGER NOT NULL DEFAULT 0,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  checkpoint_json TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS field_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_file_id TEXT NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
  source_name TEXT NOT NULL,
  field_type TEXT NOT NULL,
  confidence REAL NOT NULL,
  is_sensitive INTEGER NOT NULL DEFAULT 0,
  UNIQUE(source_file_id, source_name)
);

CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  source_file_id TEXT NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
  source_location TEXT NOT NULL,
  byte_offset INTEGER,
  record_fingerprint TEXT NOT NULL,
  parser TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(dataset_id, record_fingerprint, source_location)
);

CREATE INDEX IF NOT EXISTS records_dataset_idx ON records(dataset_id);
CREATE INDEX IF NOT EXISTS records_file_idx ON records(source_file_id);

CREATE TABLE IF NOT EXISTS field_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  field_type TEXT NOT NULL,
  original_value TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  is_sensitive INTEGER NOT NULL DEFAULT 0,
  confidence REAL NOT NULL,
  UNIQUE(record_id, field_name)
);

CREATE INDEX IF NOT EXISTS field_values_record_idx ON field_values(record_id);

CREATE TABLE IF NOT EXISTS domains (
  id TEXT PRIMARY KEY,
  hostname TEXT NOT NULL UNIQUE,
  registrable_domain TEXT NOT NULL,
  public_suffix TEXT,
  is_subdomain INTEGER NOT NULL,
  record_count INTEGER NOT NULL DEFAULT 0,
  first_observed TEXT,
  last_observed TEXT
);

CREATE INDEX IF NOT EXISTS domains_parent_idx ON domains(registrable_domain);

CREATE TABLE IF NOT EXISTS urls (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  normalized_url TEXT NOT NULL,
  scheme TEXT,
  hostname TEXT NOT NULL,
  port INTEGER,
  path TEXT NOT NULL,
  query_keys_json TEXT NOT NULL DEFAULT '[]',
  has_fragment INTEGER NOT NULL DEFAULT 0,
  registrable_domain TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS urls_record_idx ON urls(record_id);
CREATE INDEX IF NOT EXISTS urls_domain_idx ON urls(registrable_domain);

CREATE TABLE IF NOT EXISTS identity_groups (
  id TEXT PRIMARY KEY,
  display_label TEXT NOT NULL,
  confidence_level TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS identity_memberships (
  identity_group_id TEXT NOT NULL REFERENCES identity_groups(id) ON DELETE CASCADE,
  record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL,
  confidence_score REAL NOT NULL,
  explanation_json TEXT NOT NULL,
  user_status TEXT NOT NULL DEFAULT 'automatic',
  PRIMARY KEY(identity_group_id, record_id)
);

CREATE TABLE IF NOT EXISTS saved_searches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  query TEXT NOT NULL,
  filters_json TEXT NOT NULL DEFAULT '{}',
  sort_json TEXT NOT NULL DEFAULT '{}',
  columns_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_opened_at TEXT
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS entity_tags (
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  PRIMARY KEY(tag_id, entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS export_history (
  id TEXT PRIMARY KEY,
  format TEXT NOT NULL,
  destination_path TEXT NOT NULL,
  record_count INTEGER NOT NULL,
  redactions_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details_json TEXT NOT NULL,
  undo_of TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS audit_entity_idx ON audit_events(entity_type, entity_id, created_at);
