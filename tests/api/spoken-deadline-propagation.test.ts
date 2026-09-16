import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  protocolVersion,
  type TextParseRequest,
} from '@campus-action-os/protocol';
import type { SpokenRevisionEvent } from '../../services/audio-intelligence/src/types.js';
import { parseText } from '../../services/ai-parser/src/rule-parser.js';
import { Repository } from '../../services/api/src/repository.js';
import { propagateSpokenRevisionDeadlines } from '../../services/api/src/spoken-deadline-propagation.js';

const require = createRequire(import.meta.url);
const { formatDeadline, homeBucket } = require('../../apps/student-miniapp/utils/deadline.js') as {
  formatDeadline: (value: string | null, precision?: string) => string;
  homeBucket: (value: string | null, precision?: string, now?: Date) => string;
};

const sourceText =
  '实验报告要在周三晚上交到学习通。第三组的同学除了实验报告，还要交原始数据。哦刚刚说错了，嗯，大家统一在周五晚上8点。';

function request(documentId = 'audio-document'): TextParseRequest {
  return {
    schema_version: 'text-parse-request/v1',
    request_id: 'audio-request-1',
    idempotency_key: 'audio-parse-1',
    protocol_version: protocolVersion,
    document: {
      document_id: documentId,
      content_type: 'text/plain',
      text: sourceText,
      content_sha256: createHash('sha256').update(sourceText, 'utf8').digest('hex'),
      language: 'zh-CN',
      timezone: 'Asia/Shanghai',
    },
    user_profile: {},
    execution_context: {
      environment: 'production',
      deadline_ms: 5000,
      requested_at: '2026-09-16T10:00:00+08:00',
    },
  };
}

function revision(): SpokenRevisionEvent {
  return {
    revision_id: 'audio-1:revision:0001',
    change_type: 'corrected',
    source_audio_id: 'audio-1',
    trigger_segment_id: 'segment-1',
    evidence_ids: ['audio-1:evidence:segment-1'],
    trigger_text: sourceText,
    old_fact: '周三晚上',
    new_fact: '周五晚上8点',
    requires_user_confirmation: true,
  };
}

test('spoken correction propagates the final deadline to every related action', () => {
  const parsed = parseText(request());
  assert.equal('code' in parsed, false);
  if ('code' in parsed) return;
  const propagated = propagateSpokenRevisionDeadlines(
    parsed,
    sourceText,
    request(),
    [revision()],
  );
  assert.equal(propagated.verified_actions.length, 2);
  for (const action of propagated.verified_actions) {
    assert.equal(action.deadline.value, '2026-09-18T20:00:00+08:00');
    assert.equal(action.deadline.precision, 'hour');
    assert.equal(action.deadline.evidence_ids.length, 1);
    assert.ok(action.evidence.some((item) => item.source_text === sourceText && item.field_name === 'deadline'));
  }
  assert.ok(propagated.warnings.every((warning) => warning.code !== 'DEADLINE_AMBIGUOUS'));
});

test('propagated deadlines persist on actions and become Task.due_at', () => {
  const parsed = parseText(request());
  assert.equal('code' in parsed, false);
  if ('code' in parsed) return;
  const propagated = propagateSpokenRevisionDeadlines(parsed, sourceText, request(), [revision()]);
  const repository = new Repository(':memory:');
  const userId = 'deadline-test-user';
  repository.ensureUser(userId);
  const document = repository.createDocument({
    documentId: 'audio-document',
    ownerUserId: userId,
    title: '真实语音通知',
    contentType: 'text/plain',
    text: sourceText,
    dataOrigin: 'user_provided',
  });
  const job = repository.createParseJob(userId, document.document_id, 'audio-request-1', 'audio-parse-1', 'hash');
  repository.startParseJob(userId, job.parseJobId, 'audio-request-1');
  repository.completeParseJob(userId, job.parseJobId, propagated, 'audio-request-1');
  for (const action of propagated.verified_actions) {
    const stored = repository.getAction(userId, action.action_id);
    assert.equal(stored?.deadline.value, '2026-09-18T20:00:00+08:00');
    repository.confirmAction(userId, action.action_id, 'confirm-request', true);
    const task = repository.createTask(userId, action.action_id, undefined, 'task-request');
    assert.equal(task.due_at, '2026-09-18T20:00:00+08:00');
  }
  repository.close();
});

test('deadline display respects day precision and explicit time', () => {
  assert.equal(formatDeadline('2026-09-23', 'day'), '9月23日');
  assert.equal(formatDeadline('2026-09-18T20:00:00+08:00', 'hour'), '9月18日 20:00');
});

test('final timed deadline naturally enters the three-day upcoming bucket', () => {
  const now = new Date('2026-09-16T10:00:00+08:00');
  assert.equal(homeBucket('2026-09-18T20:00:00+08:00', 'hour', now), 'upcoming');
  assert.equal(homeBucket('2026-09-23', 'day', now), 'later');
});

