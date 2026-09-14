CREATE TABLE IF NOT EXISTS action_steps (
  action_id TEXT NOT NULL REFERENCES verified_actions(action_id) ON DELETE CASCADE,
  step_id TEXT NOT NULL,
  instruction TEXT NOT NULL,
  location_json TEXT,
  platform_json TEXT,
  epistemic_status TEXT NOT NULL CHECK (epistemic_status IN ('explicit', 'rule_inferred', 'ai_estimated', 'unknown')),
  position INTEGER NOT NULL CHECK (position >= 0),
  PRIMARY KEY (action_id, step_id),
  UNIQUE (action_id, position)
) STRICT;

CREATE TABLE IF NOT EXISTS action_dependencies (
  action_id TEXT NOT NULL REFERENCES verified_actions(action_id) ON DELETE CASCADE,
  dependency_id TEXT NOT NULL,
  from_step_id TEXT NOT NULL,
  to_step_id TEXT NOT NULL,
  dependency_type TEXT NOT NULL CHECK (dependency_type IN ('blocks', 'requires', 'informs', 'alternative_to', 'postpones', 'revokes', 'replaces')),
  condition_id TEXT,
  PRIMARY KEY (action_id, dependency_id),
  FOREIGN KEY (action_id, from_step_id) REFERENCES action_steps(action_id, step_id),
  FOREIGN KEY (action_id, to_step_id) REFERENCES action_steps(action_id, step_id)
) STRICT;

CREATE TABLE IF NOT EXISTS deadlines (
  action_id TEXT PRIMARY KEY REFERENCES verified_actions(action_id) ON DELETE CASCADE,
  value TEXT,
  precision TEXT NOT NULL CHECK (precision IN ('minute', 'hour', 'day', 'range', 'unknown')),
  boundary_semantics TEXT NOT NULL CHECK (boundary_semantics IN ('before', 'no_later_than', 'on', 'after', 'unknown')),
  timezone TEXT,
  epistemic_status TEXT NOT NULL CHECK (epistemic_status IN ('explicit', 'rule_inferred', 'ai_estimated', 'unknown')),
  evidence_ids_json TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS materials (
  material_record_id TEXT PRIMARY KEY,
  material_id TEXT NOT NULL,
  action_id TEXT NOT NULL REFERENCES verified_actions(action_id) ON DELETE CASCADE,
  step_id TEXT,
  description TEXT NOT NULL,
  epistemic_status TEXT NOT NULL CHECK (epistemic_status IN ('explicit', 'rule_inferred', 'ai_estimated', 'unknown')),
  position INTEGER NOT NULL CHECK (position >= 0),
  FOREIGN KEY (action_id, step_id) REFERENCES action_steps(action_id, step_id),
  UNIQUE (action_id, material_record_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_action_steps_action_position
  ON action_steps(action_id, position);

CREATE INDEX IF NOT EXISTS idx_action_dependencies_action
  ON action_dependencies(action_id);

CREATE INDEX IF NOT EXISTS idx_materials_action_position
  ON materials(action_id, position);
