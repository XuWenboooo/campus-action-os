import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  loadSchema,
  validateDocument,
  validateError,
  validateNotificationRevision,
  validateParseJob,
  validateTask,
  validateUserProfile,
} from '@campus-action-os/protocol';

test('public domain schemas are loadable and reject unknown fields', () => {
  for (const name of [
    'user-profile',
    'document',
    'parse-job',
    'task',
    'notification-revision',
    'error',
  ] as const) {
    const schema = loadSchema(name) as { $schema?: string; unevaluatedProperties?: boolean };
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(schema.unevaluatedProperties, false);
  }
  const timestamp = '2099-01-01T00:00:00.000Z';
  const text = 'synthetic notice';
  const document = {
    schema_version: 'document/v1',
    document_id: 'doc-1',
    owner_user_id: 'user-1',
    title: '合成通知',
    content_type: 'text/plain',
    text,
    content_sha256: createHash('sha256').update(text).digest('hex'),
    data_origin: 'synthetic',
    created_at: timestamp,
  };
  assert.equal(validateDocument(document).ok, true);
  assert.equal(
    validateDocument({
      ...document,
      document_id: 'media-doc-1',
      content_type: 'image/png',
      text: '',
      content_sha256: createHash('sha256').update('', 'utf8').digest('hex'),
    }).ok,
    true,
  );
  assert.equal(
    validateDocument({
      ...document,
      document_id: 'empty-text-doc',
      text: '',
      content_sha256: createHash('sha256').update('', 'utf8').digest('hex'),
    }).ok,
    false,
  );
  assert.equal(
    validateUserProfile({
      schema_version: 'user-profile/v1',
      profile_id: 'user-1',
      grade: '大一',
      updated_at: timestamp,
    }).ok,
    true,
  );
  assert.equal(
    validateParseJob({
      schema_version: 'parse-job/v1',
      parse_job_id: 'job-1',
      document_id: 'doc-1',
      user_id: 'user-1',
      request_id: 'req-1',
      idempotency_key: 'key-1',
      status: 'queued',
      created_at: timestamp,
      updated_at: timestamp,
    }).ok,
    true,
  );
  assert.equal(
    validateTask({
      schema_version: 'task/v1',
      task_id: 'task-1',
      user_id: 'user-1',
      action_id: 'action-1',
      document_id: 'doc-1',
      title: '做事',
      status: 'pending',
      due_at: null,
      created_at: timestamp,
      updated_at: timestamp,
      completed_at: null,
    }).ok,
    true,
  );
  assert.equal(
    validateNotificationRevision({
      schema_version: 'notification-revision/v1',
      notice_id: 'notice-1',
      revision_id: 'revision-1',
      revision_number: 1,
      status: 'draft',
      title: '通知',
      body: '合成内容',
      created_at: timestamp,
      published_at: null,
    }).ok,
    true,
  );
  assert.equal(
    validateError({
      error: { code: 'INVALID_REQUEST', message: 'bad', requestId: 'req-1', retryable: false },
    }).ok,
    true,
  );
  assert.equal(
    validateError({
      error: { code: 'bad code', message: 'bad', requestId: 'req-1', retryable: false },
    }).ok,
    false,
  );
  assert.equal(
    validateUserProfile({
      schema_version: 'user-profile/v1',
      profile_id: 'user-1',
      updated_at: timestamp,
      student_id: 'never',
    }).ok,
    false,
  );
});
