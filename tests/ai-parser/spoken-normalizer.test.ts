import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  validateTextParseResponseAgainstText,
  type TextParseRequest,
} from '@campus-action-os/protocol';
import { parseText } from '../../services/ai-parser/src/rule-parser.js';
import { normalizeSpokenText } from '../../services/ai-parser/src/spoken-normalizer.js';

function request(text: string): TextParseRequest {
  return {
    schema_version: 'text-parse-request/v1',
    request_id: `spoken-${Math.random().toString(16).slice(2)}`,
    idempotency_key: 'spoken-normalizer-test',
    protocol_version: '1.0.0',
    document: {
      document_id: 'spoken-normalizer-doc',
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
      requested_at: '2026-09-16T10:00:00+08:00',
    },
  };
}

const paraphrases: Array<[string, string, string | null]> = [
  ['实验报告周三之前交学习通。', '提交实验报告', '学习通'],
  ['周三前把实验报告交到学习通。', '提交实验报告', '学习通'],
  ['大家记得周三前把报告传到学习通。', '上传报告', '学习通'],
  ['实验报告得在周三晚上之前上传。', '上传实验报告', null],
  ['请于周三前提交实验报告至学习通。', '提交实验报告', '学习通'],
  ['明天下午之前把报名表发到班级群。', '发送报名表', '班级群'],
  ['大家这周五前在教务系统把学籍信息确认一下。', '确认学籍信息', '教务系统'],
  ['参加比赛的同学记得今晚把身份证复印件交给班长。', '提交身份证复印件', '班长'],
];

test('spoken action paraphrases become equivalent action candidates', () => {
  for (const [text, expectedAction, expectedPlatform] of paraphrases) {
    const normalized = normalizeSpokenText(text);
    assert.equal(normalized.candidates.length, 1, text);
    assert.match(normalized.normalized_text, new RegExp(expectedAction));
    const result = parseText(request(text));
    assert.equal('code' in result, false, text);
    if ('code' in result) continue;
    assert.equal(result.verified_actions[0]?.title, expectedAction, text);
    assert.equal(result.verified_actions[0]?.platform?.value ?? null, expectedPlatform, text);
    assert.ok(result.verified_actions[0]?.deadline.value, text);
    assert.equal(validateTextParseResponseAgainstText(result, text).ok, true, text);
    assert.ok(!result.warnings.some((warning) => warning.code === 'ACTION_MISSING'), text);
  }
});

test('spoken conditions stay scoped to the extra requirement', () => {
  const text =
    '实验报告要在周三晚上交到学习通。第三组的同学除了实验报告，还要交原始数据。哦刚刚说错了，嗯，大家统一在周五晚上8点之前进行提交。';
  const normalized = normalizeSpokenText(text);
  assert.deepEqual(
    normalized.candidates.map((candidate) => candidate.action_text),
    ['提交实验报告', '提交原始数据'],
  );
  const result = parseText(request(text));
  assert.equal('code' in result, false);
  if ('code' in result) return;
  assert.equal(result.verified_actions.length, 2);
  assert.equal(result.verified_actions[0].title, '提交实验报告');
  assert.deepEqual(result.verified_actions[0].target_population, ['未明确适用对象']);
  assert.equal(result.verified_actions[1].title, '提交原始数据');
  assert.deepEqual(result.verified_actions[1].target_population, ['第三组的同学']);
  assert.match(result.verified_actions[1].conditions[0]?.statement ?? '', /第三组/);
  assert.equal(result.verified_actions[1].deadline.value, result.verified_actions[0].deadline.value);
  assert.equal(validateTextParseResponseAgainstText(result, text).ok, true);
});
