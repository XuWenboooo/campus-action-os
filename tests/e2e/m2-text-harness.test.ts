import test from 'node:test';
import assert from 'node:assert/strict';
import { assertUserConfirmationBeforeTask, createPendingM2TextE2ERun } from './harness.js';

test('M2 E2E harness exposes the full text-to-task sequence as pending adapters', () => {
  const run = createPendingM2TextE2ERun('normal-related-notice');
  assert.equal(run.development_only, true);
  assert.deepEqual(
    run.steps.map((step) => step.name),
    [
      'submit text',
      'call AI text parser',
      'return protocol object',
      'validate parser response',
      'show result to user',
      'confirm action',
      'save task',
    ],
  );
  assert.ok(run.steps.every((step) => step.status === 'pending_adapter'));
  assert.equal(run.task_created, false);
  assertUserConfirmationBeforeTask(run);
});

test('E2E pending harness never pretends that product persistence is implemented', () => {
  const run = createPendingM2TextE2ERun('unconfirmed-notice');
  const save = run.steps.find((step) => step.name === 'save task');
  assert.equal(save?.status, 'pending_adapter');
  assert.match(save?.note ?? '', /forbidden before confirmation/);
});
