import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { type TextParseRequest, type TextParseResponse } from '@campus-action-os/protocol';
import { parseText } from '../../services/ai-parser/src/rule-parser.js';
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
    'action_steps',
    'action_dependencies',
    'deadlines',
    'materials',
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
    [1, 2, 3, 4, 5, 6, 7],
  );
  assert.deepEqual(
    (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_tasks_one_active_per_action'",
        )
        .all() as Array<{ name: string }>
    ).map((row) => row.name),
    ['idx_tasks_one_active_per_action'],
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
    "INSERT INTO tasks (task_id, user_id, action_id, document_id, title, status, due_at, completed_at, created_at, updated_at) VALUES ('history-task-1', 'history-user', 'history-action', 'history-document', 'task', 'pending', NULL, NULL, '2099-01-01T00:00:00Z', '2099-01-01T00:00:00Z')",
  );
  assert.throws(() =>
    db.exec(
      "INSERT INTO tasks (task_id, user_id, action_id, document_id, title, status, due_at, completed_at, created_at, updated_at) VALUES ('history-task-2', 'history-user', 'history-action', 'history-document', 'duplicate', 'in_progress', NULL, NULL, '2099-01-01T00:00:00Z', '2099-01-01T00:00:00Z')",
    ),
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

test('Repository materializes action steps, dependencies, deadlines, and materials', () => {
  const repository = new Repository(':memory:');
  const text =
    '适用对象：本科生\n1. 在线提交申请\n2. 到现场核验材料\n截止：2099-10-03 17:00 前\n材料：学生证';
  try {
    const document = repository.createDocument({
      ownerUserId: 'projection-user',
      title: '归一化投影通知',
      contentType: 'text/plain',
      text,
      dataOrigin: 'synthetic',
    });
    const parseJob = repository.createParseJob(
      'projection-user',
      document.document_id,
      'projection-request',
      'projection-parse-1',
      'a'.repeat(64),
    );
    repository.startParseJob('projection-user', parseJob.parseJobId, 'projection-start-1');
    const request: TextParseRequest = {
      schema_version: 'text-parse-request/v1',
      request_id: 'projection-request',
      idempotency_key: 'projection-parse-1',
      protocol_version: '1.0.0',
      document: {
        document_id: document.document_id,
        content_type: 'text/plain',
        text,
        content_sha256: createHash('sha256').update(text).digest('hex'),
        language: 'zh-CN',
        timezone: 'Asia/Shanghai',
      },
      user_profile: { education_level: '本科生' },
      execution_context: {
        environment: 'test',
        deadline_ms: 5000,
        requested_at: '2099-01-01T00:00:00.000Z',
      },
    };
    const parsed = parseText(request);
    assert.equal('code' in parsed, false);
    if ('code' in parsed) return;
    const base = parsed.verified_actions[0];
    const secondStepId = `${base.action_id}:step:2`;
    const secondStepEvidenceId = `${base.action_id}:evidence:step-2`;
    const materialEvidenceId = `${base.action_id}:evidence:material-extra`;
    const projectedAction = {
      ...base,
      steps: [
        ...base.steps,
        {
          step_id: secondStepId,
          instruction: '现场核验材料',
          epistemic_status: 'explicit' as const,
          evidence_ids: [secondStepEvidenceId],
        },
      ],
      dependencies: [
        {
          dependency_id: `${base.action_id}:dependency:1`,
          from_step_id: base.steps[0].step_id,
          to_step_id: secondStepId,
          type: 'blocks' as const,
        },
      ],
      required_materials: [
        {
          material_id: `${base.action_id}:material:extra`,
          description: '校园卡',
          epistemic_status: 'explicit' as const,
          evidence_ids: [materialEvidenceId],
        },
      ],
      evidence: [
        ...base.evidence,
        {
          evidence_id: secondStepEvidenceId,
          source_text: '现场核验材料',
          page_or_image: 'text:1',
          field_name: 'steps' as const,
          epistemic_status: 'explicit' as const,
        },
        {
          evidence_id: materialEvidenceId,
          source_text: '材料：学生证、校园卡',
          page_or_image: 'text:1',
          field_name: 'required_materials' as const,
          epistemic_status: 'explicit' as const,
        },
      ],
    };
    const response: TextParseResponse = {
      ...parsed,
      verified_actions: [projectedAction, ...parsed.verified_actions.slice(1)],
    };
    repository.completeParseJob(
      'projection-user',
      parseJob.parseJobId,
      response,
      'projection-complete-1',
    );
    assert.equal(
      (
        repository.db.prepare('SELECT count(*) AS count FROM action_steps').get() as {
          count: number;
        }
      ).count,
      3,
    );
    assert.equal(
      (
        repository.db.prepare('SELECT count(*) AS count FROM action_dependencies').get() as {
          count: number;
        }
      ).count,
      1,
    );
    assert.equal(
      (repository.db.prepare('SELECT count(*) AS count FROM deadlines').get() as { count: number })
        .count,
      2,
    );
    assert.equal(
      (repository.db.prepare('SELECT count(*) AS count FROM materials').get() as { count: number })
        .count,
      2,
    );
  } finally {
    repository.close();
  }
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
