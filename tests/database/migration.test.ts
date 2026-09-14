import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { migrateDatabase } from '../../database/migrate.js';
import { Repository } from '../../services/api/src/repository.js';

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
    'document_files',
    'parse_jobs',
    'verified_actions',
    'action_change_history',
    'evidence',
    'action_graphs',
    'tasks',
    'task_events',
    'notices',
    'notification_revisions',
    'notice_task_links',
    'notice_task_sync_events',
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
  assert.deepEqual(
    (
      db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{
        version: number;
      }>
    ).map((row) => row.version),
    [1, 2, 3, 4],
  );
  db.exec(
    "INSERT INTO users (user_id, open_id, created_at) VALUES ('history-user', 'history-open', '2099-01-01T00:00:00Z')",
  );
  db.exec(
    "INSERT INTO documents (document_id, owner_user_id, title, content_type, text, content_sha256, data_origin, created_at) VALUES ('history-document', 'history-user', 'history', 'text/plain', 'text', 'hash', 'synthetic', '2099-01-01T00:00:00Z')",
  );
  db.exec(
    "INSERT INTO verified_actions (action_id, document_id, user_id, payload_json, result_stage, verification_status, task_status, created_at, updated_at) VALUES ('history-action', 'history-document', 'history-user', '{}', 'rule_reviewed', 'user_confirmation_required', 'pending', '2099-01-01T00:00:00Z', '2099-01-01T00:00:00Z')",
  );
  db.exec(
    "INSERT INTO action_change_history (change_id, action_id, occurred_at, actor, change_type, reason) VALUES ('history-change', 'history-action', '2099-01-01T00:00:00Z', 'system', 'created', 'test')",
  );
  assert.throws(() =>
    db.exec(
      "UPDATE action_change_history SET reason = 'mutated' WHERE change_id = 'history-change'",
    ),
  );
  assert.throws(() =>
    db.exec("DELETE FROM action_change_history WHERE change_id = 'history-change'"),
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

test('file-backed Repository survives close and reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'campus-action-os-'));
  const databasePath = join(directory, 'persisted.sqlite');
  try {
    const first = new Repository(databasePath);
    first.updateProfile('persistent-user', { education_level: '本科生', campus: '东校区' });
    const document = first.createDocument({
      ownerUserId: 'persistent-user',
      title: '持久化通知',
      contentType: 'text/plain',
      text: '适用对象：本科生\n1. 完成登记\n截止：2099-09-30 前',
      dataOrigin: 'synthetic',
    });
    const raw = new Uint8Array([0, 1, 2, 3, 4]);
    const mediaDocument = first.createDocument({
      ownerUserId: 'persistent-user',
      title: '持久化截图',
      contentType: 'image/png',
      text: '',
      dataOrigin: 'synthetic',
      sourceContent: raw,
    });
    const mediaFile = first.getDocumentFile('persistent-user', mediaDocument.document_id);
    assert.ok(mediaFile);
    assert.equal(mediaFile?.byte_length, 5);
    assert.deepEqual(first.getDocumentContent('persistent-user', mediaDocument.document_id), raw);
    first.db
      .prepare('UPDATE document_files SET content_sha256 = ? WHERE document_id = ?')
      .run('0'.repeat(64), mediaDocument.document_id);
    assert.throws(
      () => first.getDocumentContent('persistent-user', mediaDocument.document_id),
      /integrity check failed/,
    );
    first.db
      .prepare('UPDATE document_files SET content_sha256 = ? WHERE document_id = ?')
      .run(mediaFile.content_sha256, mediaDocument.document_id);
    first.close();

    const second = new Repository(databasePath);
    assert.equal(second.getProfile('persistent-user').campus, '东校区');
    assert.deepEqual(second.getDocument('persistent-user', document.document_id), document);
    assert.deepEqual(second.getDocumentContent('persistent-user', mediaDocument.document_id), raw);
    second.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
