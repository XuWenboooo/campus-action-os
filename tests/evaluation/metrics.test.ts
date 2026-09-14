import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreRecords } from '../../tools/evaluation/metrics.js';

test('evaluation metrics keep failures and refusals in the denominator', () => {
  const report = scoreRecords([
    {
      sample_id: 'synthetic-1',
      expected_action_count: 1,
      predicted_action_count: 1,
      expected_deadline: 'explicit',
      predicted_deadline: 'explicit',
      expected_relevance: 'relevant',
      predicted_relevance: 'relevant',
      evidence_coverage: 1,
      critical_error: false,
      unsupported_critical_claims: 0,
      critical_claims: 1,
      parse_failed: false,
    },
    {
      sample_id: 'synthetic-2',
      expected_action_count: 1,
      predicted_action_count: 0,
      expected_deadline: 'explicit',
      predicted_deadline: 'failed',
      expected_relevance: 'relevant',
      predicted_relevance: 'failed',
      evidence_coverage: 0,
      critical_error: true,
      unsupported_critical_claims: 0,
      critical_claims: 1,
      parse_failed: true,
    },
  ]);
  assert.equal(report.sample_count, 2);
  assert.equal(report.failed_count, 1);
  assert.equal(report.deadline_exact_match, 0.5);
  assert.equal(report.relevance_accuracy, 0.5);
  assert.equal(report.critical_error_rate, 0.5);
  assert.equal(report.material_f1, null);
  assert.equal(report.evidence_span_f1, null);
});

test('evaluation metrics score annotated materials and exact evidence spans', () => {
  const report = scoreRecords([
    {
      sample_id: 'synthetic-annotated',
      expected_action_count: 1,
      predicted_action_count: 1,
      expected_deadline: 'explicit',
      predicted_deadline: 'explicit',
      expected_relevance: 'relevant',
      predicted_relevance: 'relevant',
      evidence_coverage: 1,
      critical_error: false,
      unsupported_critical_claims: 0,
      critical_claims: 1,
      parse_failed: false,
      expected_materials: ['申请表', '学生证'],
      predicted_materials: ['申请表'],
      expected_evidence_spans: [
        [0, 3],
        [4, 6],
      ],
      predicted_evidence_spans: [
        [0, 3],
        [8, 10],
      ],
    },
  ]);
  assert.equal(report.material_precision, 1);
  assert.equal(report.material_recall, 0.5);
  assert.equal(report.material_f1, 2 / 3);
  assert.equal(report.evidence_span_precision, 0.5);
  assert.equal(report.evidence_span_recall, 0.5);
  assert.equal(report.evidence_span_f1, 0.5);
});
