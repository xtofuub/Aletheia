CREATE INDEX IF NOT EXISTS identity_groups_updated_idx
  ON identity_groups(updated_at DESC, id);

CREATE INDEX IF NOT EXISTS identity_groups_confidence_updated_idx
  ON identity_groups(confidence_level, updated_at DESC, id);
