CREATE TABLE IF NOT EXISTS record_domains (
  record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  hostname TEXT NOT NULL,
  registrable_domain TEXT NOT NULL,
  PRIMARY KEY(record_id, hostname)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS record_domains_parent_idx
  ON record_domains(registrable_domain, record_id);

CREATE INDEX IF NOT EXISTS record_domains_hostname_idx
  ON record_domains(hostname, record_id);

CREATE TABLE IF NOT EXISTS record_domain_parents (
  record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  registrable_domain TEXT NOT NULL,
  PRIMARY KEY(record_id, registrable_domain)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS record_domain_parents_parent_idx
  ON record_domain_parents(registrable_domain, record_id);

CREATE TABLE IF NOT EXISTS domain_dataset_counts (
  registrable_domain TEXT NOT NULL,
  dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  record_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(registrable_domain, dataset_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS hostname_dataset_counts (
  hostname TEXT NOT NULL,
  dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  record_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(hostname, dataset_id)
) WITHOUT ROWID;
