CREATE TABLE IF NOT EXISTS overview_metrics (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) WITHOUT ROWID;

INSERT OR IGNORE INTO overview_metrics(key, value)
VALUES ('parent_domain_count', -1), ('identity_group_count', -1);

CREATE TRIGGER IF NOT EXISTS overview_domain_count_insert
AFTER INSERT ON domain_dataset_counts
WHEN (
  SELECT COUNT(*) FROM domain_dataset_counts
  WHERE registrable_domain = NEW.registrable_domain
) = 1
BEGIN
  UPDATE overview_metrics
  SET value = CASE WHEN value >= 0 THEN value + 1 ELSE value END,
      updated_at = CURRENT_TIMESTAMP
  WHERE key = 'parent_domain_count';
END;

CREATE TRIGGER IF NOT EXISTS overview_domain_count_delete
AFTER DELETE ON domain_dataset_counts
WHEN NOT EXISTS (
  SELECT 1 FROM domain_dataset_counts
  WHERE registrable_domain = OLD.registrable_domain
)
BEGIN
  UPDATE overview_metrics
  SET value = CASE WHEN value > 0 THEN value - 1 ELSE value END,
      updated_at = CURRENT_TIMESTAMP
  WHERE key = 'parent_domain_count';
END;

CREATE TRIGGER IF NOT EXISTS overview_identity_membership_insert
AFTER INSERT ON identity_memberships
WHEN (
  (SELECT COUNT(*) FROM identity_memberships
   WHERE identity_group_id = NEW.identity_group_id) +
  (SELECT COUNT(*) FROM identity_live_evidence
   WHERE identity_group_id = NEW.identity_group_id)
) = 2
BEGIN
  UPDATE overview_metrics
  SET value = CASE WHEN value >= 0 THEN value + 1 ELSE value END,
      updated_at = CURRENT_TIMESTAMP
  WHERE key = 'identity_group_count';
END;

CREATE TRIGGER IF NOT EXISTS overview_identity_membership_delete
AFTER DELETE ON identity_memberships
WHEN (
  (SELECT COUNT(*) FROM identity_memberships
   WHERE identity_group_id = OLD.identity_group_id) +
  (SELECT COUNT(*) FROM identity_live_evidence
   WHERE identity_group_id = OLD.identity_group_id)
) = 1
BEGIN
  UPDATE overview_metrics
  SET value = CASE WHEN value > 0 THEN value - 1 ELSE value END,
      updated_at = CURRENT_TIMESTAMP
  WHERE key = 'identity_group_count';
END;

CREATE TRIGGER IF NOT EXISTS overview_identity_live_insert
AFTER INSERT ON identity_live_evidence
WHEN (
  (SELECT COUNT(*) FROM identity_memberships
   WHERE identity_group_id = NEW.identity_group_id) +
  (SELECT COUNT(*) FROM identity_live_evidence
   WHERE identity_group_id = NEW.identity_group_id)
) = 2
BEGIN
  UPDATE overview_metrics
  SET value = CASE WHEN value >= 0 THEN value + 1 ELSE value END,
      updated_at = CURRENT_TIMESTAMP
  WHERE key = 'identity_group_count';
END;

CREATE TRIGGER IF NOT EXISTS overview_identity_live_delete
AFTER DELETE ON identity_live_evidence
WHEN (
  (SELECT COUNT(*) FROM identity_memberships
   WHERE identity_group_id = OLD.identity_group_id) +
  (SELECT COUNT(*) FROM identity_live_evidence
   WHERE identity_group_id = OLD.identity_group_id)
) = 1
BEGIN
  UPDATE overview_metrics
  SET value = CASE WHEN value > 0 THEN value - 1 ELSE value END,
      updated_at = CURRENT_TIMESTAMP
  WHERE key = 'identity_group_count';
END;
