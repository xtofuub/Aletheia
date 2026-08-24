CREATE TABLE IF NOT EXISTS domain_totals (
  registrable_domain TEXT PRIMARY KEY,
  record_count INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;

INSERT INTO domain_totals(registrable_domain, record_count)
SELECT registrable_domain, SUM(record_count)
FROM domain_dataset_counts
GROUP BY registrable_domain
ON CONFLICT(registrable_domain) DO UPDATE SET
  record_count = excluded.record_count;

DELETE FROM domain_totals
WHERE registrable_domain NOT IN (
  SELECT registrable_domain FROM domain_dataset_counts
);

CREATE INDEX IF NOT EXISTS domain_totals_rank_idx
  ON domain_totals(record_count DESC, registrable_domain);

CREATE INDEX IF NOT EXISTS domains_parent_rank_idx
  ON domains(registrable_domain, record_count DESC, hostname);

CREATE TRIGGER IF NOT EXISTS domain_totals_after_insert
AFTER INSERT ON domain_dataset_counts
BEGIN
  INSERT INTO domain_totals(registrable_domain, record_count)
  VALUES (NEW.registrable_domain, NEW.record_count)
  ON CONFLICT(registrable_domain) DO UPDATE SET
    record_count = domain_totals.record_count + excluded.record_count;
END;

CREATE TRIGGER IF NOT EXISTS domain_totals_after_update
AFTER UPDATE OF registrable_domain, record_count ON domain_dataset_counts
BEGIN
  UPDATE domain_totals
  SET record_count = MAX(0, record_count - OLD.record_count)
  WHERE registrable_domain = OLD.registrable_domain;

  DELETE FROM domain_totals
  WHERE registrable_domain = OLD.registrable_domain
    AND record_count = 0;

  INSERT INTO domain_totals(registrable_domain, record_count)
  VALUES (NEW.registrable_domain, NEW.record_count)
  ON CONFLICT(registrable_domain) DO UPDATE SET
    record_count = domain_totals.record_count + excluded.record_count;
END;

CREATE TRIGGER IF NOT EXISTS domain_totals_after_delete
AFTER DELETE ON domain_dataset_counts
BEGIN
  UPDATE domain_totals
  SET record_count = MAX(0, record_count - OLD.record_count)
  WHERE registrable_domain = OLD.registrable_domain;

  DELETE FROM domain_totals
  WHERE registrable_domain = OLD.registrable_domain
    AND record_count = 0;
END;
