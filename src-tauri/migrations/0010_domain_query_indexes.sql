CREATE INDEX IF NOT EXISTS domain_dataset_counts_dataset_records_idx
  ON domain_dataset_counts(dataset_id, record_count DESC, registrable_domain);

CREATE INDEX IF NOT EXISTS hostname_dataset_counts_dataset_hostname_idx
  ON hostname_dataset_counts(dataset_id, hostname);
