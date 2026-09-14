import test from 'node:test';
import assert from 'node:assert/strict';
import { runM2IndependentAcceptance } from './m2-independent-acceptance.js';

test('M2 independent integration acceptance gate passes every reference-flow scenario', () => {
  const report = runM2IndependentAcceptance();
  assert.equal(report.status, 'PASS', JSON.stringify(report, null, 2));
  assert.equal(report.failed, 0);
  assert.equal(report.passed, 9);
  assert.ok(report.scenarios.every((scenario) => scenario.status === 'PASS'));
});
