ALTER TABLE import_jobs ADD COLUMN plan_json TEXT;

CREATE INDEX IF NOT EXISTS import_jobs_dataset_status_idx
  ON import_jobs(dataset_id, status, created_at);
