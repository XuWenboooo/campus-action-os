import test from 'node:test';
import assert from 'node:assert/strict';
import { M2ReferenceFlow } from './m2-reference-flow.js';
import {
  requestForRuleParserBridge,
  RuleParserM2Adapter,
} from '../../tools/integration/m2-reference-flow/rule-parser-adapter.js';

test('M2 reference review flow can consume the current spoken rule parser', () => {
  const text =
    '实验报告要在周三晚上交到学习通。第三组的同学除了实验报告，还要交原始数据。哦刚刚说错了，嗯，大家统一在周五晚上8点之前进行提交。';
  const flow = new M2ReferenceFlow(new RuleParserM2Adapter());
  const request = requestForRuleParserBridge(text);
  const submitted = flow.submit(request);
  assert.equal(submitted.status, 200);
  const review = flow.review(request.request_id);
  assert.deepEqual(
    review.actions.map((action) => action.title),
    ['提交实验报告', '提交原始数据'],
  );
  assert.equal(flow.listTasks().length, 0);
  const tasks = flow.confirm(request.request_id, review.actions.map((action) => action.action_id));
  assert.equal(tasks.length, 2);
});
