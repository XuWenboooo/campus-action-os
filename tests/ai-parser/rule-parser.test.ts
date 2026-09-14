import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateTextParseResponse, type TextParseRequest } from '@campus-action-os/protocol';
import { inspectCriticalErrors } from '../../services/ai-parser/src/error-shield.js';
import { normalizeDocument } from '../../services/ai-parser/src/document-normalizer.js';
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

test('document normalizer converts HTML and refuses media without configured OCR', async () => {
  const html = await normalizeDocument({
    schema_version: 'document/v1',
    document_id: 'synthetic-html',
    owner_user_id: 'synthetic-user',
    title: 'HTML notice',
    content_type: 'text/html',
    text: '<h1>合成通知</h1><p>1. 提交材料<br>截止：2099-10-03 前</p>',
    content_sha256: '0'.repeat(64),
    data_origin: 'synthetic',
    created_at: '2099-01-01T00:00:00.000Z',
  });
  assert.equal(html.ok, true);
  if (html.ok) {
    assert.match(html.text, /合成通知/);
    assert.match(html.text, /提交材料/);
    assert.equal(html.source, 'html_text');
  }
  const image = await normalizeDocument({
    schema_version: 'document/v1',
    document_id: 'synthetic-image',
    owner_user_id: 'synthetic-user',
    title: 'Image notice',
    content_type: 'image/png',
    text: '不可未经 OCR 直接使用',
    content_sha256: '0'.repeat(64),
    data_origin: 'synthetic',
    created_at: '2099-01-01T00:00:00.000Z',
  });
  assert.deepEqual(image, {
    ok: false,
    code: 'OCR_NOT_CONFIGURED',
    message: '没有配置可审计的 OCR provider；图片/PDF 解析未运行',
  });
});

test('document normalizer accepts only an injected OCR result for media', async () => {
  const result = await normalizeDocument(
    {
      schema_version: 'document/v1',
      document_id: 'synthetic-pdf',
      owner_user_id: 'synthetic-user',
      title: 'PDF notice',
      content_type: 'application/pdf',
      text: 'binary-placeholder-not-used-as-ocr',
      content_sha256: '0'.repeat(64),
      data_origin: 'synthetic',
      created_at: '2099-01-01T00:00:00.000Z',
    },
    {
      name: 'synthetic-ocr-test-only',
      async extract() {
        return {
          status: 'succeeded' as const,
          text: '适用对象：本科生\n1. 提交 PDF 中的申请\n截止：2099-10-03 17:00 前',
          provider: 'synthetic-ocr-test-only',
          version: 'test/1.0.0',
        };
      },
    },
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.source, 'ocr');
    assert.match(result.text, /提交 PDF/);
  }
});

test('rule parser represents conditional actions with decision and branch graph nodes', () => {
  const result = parseText(
    request(
      '【合成条件通知】\n适用对象：本科生\n条件：若未完成认证，先完成认证\n1. 完成认证\n2. 提交申请\n截止：2099-10-03 17:00 前',
    ),
  );
  assert.equal('code' in result, false);
  if ('code' in result) return;
  const graph = result.action_graph;
  assert.ok(graph);
  assert.ok(graph.nodes.some((node) => node.node_type === 'decision'));
  assert.ok(
    graph.edges.some(
      (edge) => edge.edge_type === 'branches_to' && typeof edge.condition_id === 'string',
    ),
  );
  assert.equal(validateTextParseResponse(result).ok, true);
});

test('rule parser preserves distinct deadlines for multi-stage actions', () => {
  const result = parseText(
    request(
      '【合成多阶段通知】\n适用对象：本科生\n1. 在线提交申请\n第一阶段截止：2099-10-01 17:00 前\n2. 到现场核验材料\n第二阶段截止：2099-10-05 09:00 前',
    ),
  );
  assert.equal('code' in result, false);
  if ('code' in result) return;
  assert.equal(result.verified_actions.length, 2);
  assert.equal(result.verified_actions[0].deadline.value, '2099-10-01T17:00:00+08:00');
  assert.equal(result.verified_actions[1].deadline.value, '2099-10-05T09:00:00+08:00');
  assert.equal(result.verified_actions[0].deadline.evidence_ids.length, 1);
  assert.equal(result.verified_actions[1].deadline.evidence_ids.length, 1);
  assert.equal(validateTextParseResponse(result).ok, true);
});
