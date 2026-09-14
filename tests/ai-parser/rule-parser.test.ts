import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateTextParseResponse, type TextParseRequest } from '@campus-action-os/protocol';
import { inspectCriticalErrors } from '../../services/ai-parser/src/error-shield.js';
import { parseText } from '../../services/ai-parser/src/rule-parser.js';

function request(
  text: string,
  profile: TextParseRequest['user_profile'] = { education_level: '本科生' },
): TextParseRequest {
  return {
    schema_version: 'text-parse-request/v1',
    request_id: `req-${Math.random().toString(16).slice(2)}`,
    idempotency_key: 'parser-test',
    protocol_version: '1.0.0',
    document: {
      document_id: 'synthetic-doc',
      content_type: 'text/plain',
      text,
      content_sha256: createHash('sha256').update(text).digest('hex'),
      language: 'zh-CN',
      timezone: 'Asia/Shanghai',
    },
    user_profile: profile,
    execution_context: {
      environment: 'test',
      deadline_ms: 5000,
      requested_at: '2099-01-01T00:00:00.000Z',
    },
  };
}

test('rule parser emits evidence-backed actions and an executable dependency graph', () => {
  const result = parseText(
    request(
      '【合成教务通知】\n适用对象：本科生\n1. 在线系统提交申请\n2. 到现场核验材料\n截止：2099-10-03 17:00 前\n材料：学生证、成绩单\n地点：A楼101\n平台：https://example.invalid/apply',
    ),
  );
  assert.equal('code' in result, false);
  if ('code' in result) return;
  assert.equal(result.status, 'succeeded');
  assert.equal(result.verified_actions.length, 2);
  assert.equal(result.action_graph?.edges.length, 1);
  assert.ok(result.verified_actions[0].evidence.some((item) => item.field_name === 'deadline'));
  assert.equal(validateTextParseResponse(result).ok, true);
  assert.equal(inspectCriticalErrors(result.verified_actions[0]).length, 0);
});

test('rule parser refuses unsafe deadline assumptions and keeps failure visible', () => {
  const result = parseText(
    request('【合成通知】\n适用对象：本科生\n1. 报名参加活动\n截止时间待确认；请尽快提交'),
  );
  assert.equal('code' in result, false);
  if ('code' in result) return;
  assert.equal(result.status, 'needs_confirmation');
  assert.ok(result.warnings.some((warning) => warning.code === 'DEADLINE_UNKNOWN'));
  assert.equal(result.verified_actions[0].deadline.value, null);
  assert.equal(result.verified_actions[0].deadline.precision, 'unknown');
  assert.ok(
    inspectCriticalErrors(result.verified_actions[0]).some(
      (error) => error.code === 'DEADLINE_UNSAFE',
    ),
  );
});

test('Error Shield catches unsupported explicit claims and side-effect states', () => {
  const result = parseText(
    request('【合成通知】\n适用对象：本科生\n1. 提交材料\n截止：2099-10-03 17:00 前'),
  );
  assert.equal('code' in result, false);
  if ('code' in result) return;
  const unsafe = {
    ...result.verified_actions[0],
    field_status: { ...result.verified_actions[0].field_status, deadline: 'explicit' as const },
    evidence: result.verified_actions[0].evidence.filter((item) => item.field_name !== 'deadline'),
    task_status: 'completed' as const,
  };
  const errors = inspectCriticalErrors(unsafe);
  assert.ok(errors.some((error) => error.code === 'MISSING_EVIDENCE'));
  assert.ok(errors.some((error) => error.code === 'TASK_SIDE_EFFECT_BLOCKED'));
});
