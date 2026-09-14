CREATE TABLE IF NOT EXISTS action_change_history (
  change_id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL REFERENCES verified_actions(action_id),
  occurred_at TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (actor IN ('model', 'rule_engine', 'publisher', 'user', 'system')),
  change_type TEXT NOT NULL CHECK (change_type IN ('created', 'reviewed', 'confirmed', 'postponed', 'revoked', 'replaced', 'corrected')),
  reason TEXT NOT NULL,
  previous_action_id TEXT,
  UNIQUE (action_id, change_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_action_change_history_action
  ON action_change_history(action_id, occurred_at);

CREATE TRIGGER IF NOT EXISTS prevent_action_change_history_update
BEFORE UPDATE ON action_change_history
BEGIN
  SELECT RAISE(ABORT, 'action_change_history is append-only');
END;

CREATE TRIGGER IF NOT EXISTS prevent_action_change_history_delete
BEFORE DELETE ON action_change_history
BEGIN
  SELECT RAISE(ABORT, 'action_change_history is append-only');
END;
