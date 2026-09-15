import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import * as ajvFormats from 'ajv-formats';
import {
  CRITICAL_ERROR_CODES,
  FORMAL_EVALUATOR_VERSION,
  scoreFormalRecords,
  type FormalEvaluationRecord,
} from '../../tools/evaluation/formal-evaluator.js';

const root = resolve(import.meta.dirname, '../..');

function hash(char: string): string {
  return char.repeat(64);
}

function manifest() {
  return {
    manifest_version: 'campus-action-bench-manifest/v1',
    dataset_id: 'CampusActionBench-800',
    dataset_version: '1.0.0',
    status: 'candidate',
    total_samples: 800,
    splits: { train: 480, dev: 160, test: 160 },
    files: ['train', 'dev', 'test'].map((split) => ({
      split,
      path: `controlled/${split}.jsonl`,
      sha256: hash('a'),
      bytes: 100,
      record_count: split === 'train' ? 480 : 160,
      read_only: true,
    })),
    protocols: {
      dataset: 'campus-action-bench-protocol/v1.0.0',
      annotation: 'campus-action-bench-annotation/v1.0.0',
      evidence: 'campus-action-bench-evidence/v1.0.0',
      split: 'campus-action-bench-split/v1.0.0',
      evaluator: FORMAL_EVALUATOR_VERSION,
      critical_errors: 'campus-action-bench-critical-errors/v1.0.0',
    },
    leakage_audit: {
      tool: 'cab.py',
      tool_version: 'cab/2.0.0',
      passed: true,
      exact_duplicates: 0,
      near_duplicates: 0,
      cross_source_groups: 0,
      reviewer_ids: ['person-1', 'person-2'],
    },
    freeze: {
      code_commit: 'a'.repeat(40),
      config_sha256: hash('b'),
      frozen_at: '2026-09-15T00:00:00Z',
      manifest_sha256: hash('c'),
      reviewer_ids: ['person-1', 'person-2'],
      test_read_only: true,
    },
  };
}

function record(sampleId: string, status: FormalEvaluationRecord['status']): FormalEvaluationRecord {
  return {
    sample_id: sampleId,
    status,
    expected_action_count: 1,
    predicted_action_count: status === 'success' ? 1 : 0,
    expected_deadline: 'explicit',
    predicted_deadline: status === 'success' ? 'explicit' : 'failed',
    expected_relevance: 'relevant',
    predicted_relevance: status === 'success' ? 'relevant' : 'failed',
    evidence_coverage: status === 'success' ? 1 : 0,
    unsupported_critical_claims: 0,
    critical_claims: 1,
    parse_failed: status !== 'success',
    critical_error_codes: status === 'success' ? [] : ['FABRICATED_DEADLINE'],
    expected_materials: [],
    predicted_materials: [],
    expected_evidence_spans: [[0, 2]],
    predicted_evidence_spans: status === 'success' ? [[0, 2]] : [],
  };
}

test('Phase 3 manifest schema freezes the 480/160/160 contract', () => {
  const schema = JSON.parse(
    readFileSync(resolve(root, 'benchmark/schema/campus-action-bench-manifest-v1.schema.json'), 'utf8'),
  );
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const addFormats = ajvFormats.default as unknown as (instance: Ajv2020) => Ajv2020;
  addFormats(ajv);
  const validate = ajv.compile(schema);
  assert.equal(validate(manifest()), true);
  const invalid = manifest() as ReturnType<typeof manifest> & { total_samples: number };
  invalid.total_samples = 799;
  assert.equal(validate(invalid), false);
});

test('formal evaluator keeps all statuses in the denominator and exposes frozen semantics', () => {
  const report = scoreFormalRecords([record('CAB-FORMAL-001', 'success'), record('CAB-FORMAL-002', 'timeout')]);
  assert.equal(report.evaluator_version, FORMAL_EVALUATOR_VERSION);
  assert.deepEqual(report.status_counts, {
    success: 1,
    failed: 0,
    refused: 0,
    timeout: 1,
    parse_failed: 0,
  });
  assert.equal(report.metrics.sample_count, 2);
  assert.equal(report.metrics.critical_error_rate, 0.5);
  assert.equal(report.metric_semantics.failures_in_denominator, true);
});

test('formal evaluator rejects duplicate sample IDs and unknown Critical Error codes', () => {
  assert.throws(() => scoreFormalRecords([record('CAB-FORMAL-001', 'success'), record('CAB-FORMAL-001', 'success')]));
  const invalid = record('CAB-FORMAL-003', 'success');
  invalid.critical_error_codes = ['NOT_A_FROZEN_CODE' as never];
  assert.throws(() => scoreFormalRecords([invalid]));
  assert.equal(CRITICAL_ERROR_CODES.length, 11);
  const rules = JSON.parse(
    readFileSync(resolve(root, 'benchmark/protocol/critical-error-rules-v1.json'), 'utf8'),
  ) as { protocol_version: string; rules: Array<{ code: string }> };
  assert.equal(rules.protocol_version, 'campus-action-bench-critical-errors/v1.0.0');
  assert.deepEqual(
    rules.rules.map((rule) => rule.code),
    [...CRITICAL_ERROR_CODES],
  );
});
