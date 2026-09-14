CREATE TABLE IF NOT EXISTS notice_task_links (
  link_id TEXT PRIMARY KEY,
  notice_id TEXT NOT NULL REFERENCES notices(notice_id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
  revision_id TEXT NOT NULL REFERENCES notification_revisions(revision_id),
  status TEXT NOT NULL CHECK (status IN ('active', 'unlinked')),
  linked_at TEXT NOT NULL,
  UNIQUE (notice_id, task_id)
) STRICT;

CREATE TABLE IF NOT EXISTS notice_task_sync_events (
  sync_event_id TEXT PRIMARY KEY,
  link_id TEXT NOT NULL REFERENCES notice_task_links(link_id) ON DELETE CASCADE,
  from_revision_id TEXT NOT NULL REFERENCES notification_revisions(revision_id),
  to_revision_id TEXT NOT NULL REFERENCES notification_revisions(revision_id),
  change_type TEXT NOT NULL CHECK (change_type IN ('replaced', 'postponed', 'revoked')),
  status TEXT NOT NULL CHECK (status IN ('pending_review', 'accepted', 'rejected')),
  reason TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS idx_notice_task_links_task
  ON notice_task_links(task_id, status);

CREATE INDEX IF NOT EXISTS idx_notice_task_sync_events_link
  ON notice_task_sync_events(link_id, created_at DESC);
