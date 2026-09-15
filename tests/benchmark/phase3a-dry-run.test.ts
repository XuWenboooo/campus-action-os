import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { scoreFormalRecords, type FormalEvaluationRecord } from '../../tools/evaluation/formal-evaluator.js';

const root = resolve(import.meta.dirname, '../..');

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('Phase 3A executes five synthetic annotations through lock, adjudication, manifest, evaluator, and delivery', () => {
  const output = mkdtempSync(join(tmpdir(), 'campus-action-os-phase3a-'));
  try {
    const result = spawnSync('python', [join(root, 'tools/benchmark/phase3a_dry_run.py'), 'run', '--out-dir', output], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readJson(join(output, 'workflow-summary.json')).status, 'COMPLETE');
    assert.equal(readJson(join(output, 'workflow-summary.json')).case_count, 5);
    const lockedA = readFileSync(join(output, 'annotation_A.locked.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    const lockedB = readFileSync(join(output, 'annotation_B.locked.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(lockedA.length, 5);
    assert.equal(lockedB.length, 5);
    assert.ok(lockedA.every((row) => row.locked && row.status === 'submitted_locked'));
    assert.ok(lockedB.every((row) => row.locked && row.status === 'submitted_locked'));
    assert.equal(readFileSync(join(output, 'disagreements.jsonl'), 'utf8').trim().split('\n').filter((line) => JSON.parse(line).status === 'detected').length, 3);
    assert.ok(readFileSync(join(output, 'adjudications.jsonl'), 'utf8').trim().split('\n').every((line) => JSON.parse(line).status === 'adjudicated'));
    assert.equal(readJson(join(output, 'final-gold-validation.json')).ok, true);
    const manifest = readJson(join(output, 'manifest.json'));
    assert.deepEqual(manifest.counts, { train: 3, dev: 2, test: 0, total: 5 });
    const delivery = readJson(join(output, 'model-lead-delivery/package-manifest.json'));
    assert.equal(delivery.test_included, false);
    assert.equal(delivery.test_access, 'denied');
    const evaluationRows = readFileSync(join(output, 'evaluator-input.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line)) as FormalEvaluationRecord[];
    const evaluation = scoreFormalRecords(evaluationRows);
    assert.equal(evaluation.evaluator_version, 'campus-action-bench-evaluator/v1.0.0');
    assert.equal(evaluation.metrics.sample_count, 5);
    assert.equal(evaluation.metrics.critical_error_rate, 0);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
