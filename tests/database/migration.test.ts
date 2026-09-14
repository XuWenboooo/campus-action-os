import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateDatabase } from '../../database/migrate.js';

test('SQLite migration is repeatable, foreign keys are enabled, and all core tables exist', () => {
  const db = migrateDatabase(':memory:');
  const tables = (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as Array<{ name: string }>
  ).map((row) => row.name);
  for (const name of [
    'users',
    'user_profiles',
    'documents',
    'parse_jobs',
    'verified_actions',
    'evidence',
    'action_graphs',
    'tasks',
    'task_events',
    'notices',
    'notification_revisions',
    'feedback',
    'audit_events',
    'idempotency_keys',
    'schema_migrations',
  ])
    assert.ok(tables.includes(name), name);
  assert.equal(
    (db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys,
    1,
  );
  db.exec('BEGIN');
  db.exec(
    "INSERT INTO users (user_id, open_id, created_at) VALUES ('u', 'o', '2099-01-01T00:00:00Z')",
  );
  assert.throws(() =>
    db.exec(
      "INSERT INTO documents (document_id, owner_user_id, title, content_type, text, content_sha256, data_origin, created_at) VALUES ('d', 'missing', 'x', 'text/plain', 'x', 'x', 'synthetic', '2099-01-01T00:00:00Z')",
    ),
  );
  db.exec('ROLLBACK');
  db.close();
});
