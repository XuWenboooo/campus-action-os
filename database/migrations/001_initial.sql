CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  open_id TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'publisher', 'admin')),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  profile_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS documents (
  document_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(user_id),
  title TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('text/plain', 'image/png', 'image/jpeg', 'application/pdf', 'text/html')),
  text TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  data_origin TEXT NOT NULL CHECK (data_origin IN ('synthetic', 'user_provided')),
  created_at TEXT NOT NULL,
  deleted_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS parse_jobs (
  parse_job_id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(document_id),
  user_id TEXT NOT NULL REFERENCES users(user_id),
  request_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'partial', 'needs_confirmation', 'failed')),
  result_json TEXT,
  error_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, idempotency_key)
) STRICT;

CREATE TABLE IF NOT EXISTS verified_actions (
  action_id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(document_id),
  user_id TEXT NOT NULL REFERENCES users(user_id),
  payload_json TEXT NOT NULL,
  result_stage TEXT NOT NULL CHECK (result_stage IN ('model_output', 'rule_reviewed', 'user_confirmed')),
  verification_status TEXT NOT NULL CHECK (verification_status IN ('passed', 'conflict', 'user_confirmation_required')),
  task_status TEXT NOT NULL CHECK (task_status IN ('pending', 'in_progress', 'completed', 'expired', 'cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS evidence (
  evidence_id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL REFERENCES verified_actions(action_id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  source_text TEXT NOT NULL,
  page_or_image TEXT NOT NULL,
  bounding_box_json TEXT,
  epistemic_status TEXT NOT NULL,
  UNIQUE (action_id, evidence_id)
) STRICT;

CREATE TABLE IF NOT EXISTS action_graphs (
  graph_id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(document_id),
  user_id TEXT NOT NULL REFERENCES users(user_id),
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS tasks (
  task_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  action_id TEXT NOT NULL REFERENCES verified_actions(action_id),
  document_id TEXT NOT NULL REFERENCES documents(document_id),
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed', 'expired', 'cancelled')),
  due_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS task_events (
  event_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  reason TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS notices (
  notice_id TEXT PRIMARY KEY,
  publisher_user_id TEXT NOT NULL REFERENCES users(user_id),
  title TEXT NOT NULL,
  current_revision_id TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS notification_revisions (
  revision_id TEXT PRIMARY KEY,
  notice_id TEXT NOT NULL REFERENCES notices(notice_id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'postponed', 'revoked')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  published_at TEXT,
  UNIQUE (notice_id, revision_number)
) STRICT;

CREATE TABLE IF NOT EXISTS feedback (
  feedback_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  action_id TEXT REFERENCES verified_actions(action_id),
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS audit_events (
  audit_event_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  actor_user_id TEXT REFERENCES users(user_id),
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id TEXT NOT NULL REFERENCES users(user_id),
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, scope, idempotency_key)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_documents_owner_created ON documents(owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_parse_jobs_user_updated ON parse_jobs(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_actions_user_updated ON verified_actions(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_user_status_due ON tasks(user_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_revisions_notice_number ON notification_revisions(notice_id, revision_number DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_events(entity_type, entity_id, created_at DESC);
