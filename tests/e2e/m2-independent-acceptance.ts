import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fixtures } from '../fixtures/m2-text/catalog.js';
import {
  M2ReferenceFlow,
  referenceFlowProvenance,
  type ReferenceParseResult,
} from './m2-reference-flow.js';

export const acceptanceRunbook = 'CAOS-M2-INDEPENDENT-INTEGRATION-FLOW-v1.0';
export const acceptanceBaseline =
  'm2-text-contract-v0.1.0@d89afe123ba38368b9ee2fdeb4049243107fde84';

export type AcceptanceScenario = {
  id: string;
  description: string;
  status: 'PASS' | 'FAIL';
  assertions: number;
  tasks_before_confirmation: number;
  tasks_after_confirmation: number;
  detail: string;
};

export type AcceptanceReport = typeof referenceFlowProvenance & {
  runbook: typeof acceptanceRunbook;
  baseline: typeof acceptanceBaseline;
  status: 'PASS' | 'FAIL';
  passed: number;
  failed: number;
  scenarios: AcceptanceScenario[];
};

const fixture = (id: string) => {
  const found = fixtures.find((item) => item.id === id);
  if (!found) throw new Error(`missing fixture: ${id}`);
  return found.request;
};

function unmatchedRequest() {
  const base = fixture('single-action');
  const text = '合成通知：该文本不在固定 fixture 目录中。';
  return {
    ...base,
    request_id: 'req-unmatched-reference-flow',
    idempotency_key: 'idem-unmatched-reference-flow',
    document: {
      ...base.document,
      document_id: 'doc-unmatched-reference-flow',
      text,
      content_sha256: createHash('sha256').update(text, 'utf8').digest('hex'),
    },
  };
}

function assertionsFor(result: ReferenceParseResult): number {
  return result.response ? 2 : 1;
}

function scenario(
  id: string,
  description: string,
  run: () => { assertions: number; before: number; after: number; detail: string },
): AcceptanceScenario {
  try {
    const value = run();
    return {
      id,
      description,
      status: 'PASS',
      assertions: value.assertions,
      tasks_before_confirmation: value.before,
      tasks_after_confirmation: value.after,
      detail: value.detail,
    };
  } catch (error) {
    return {
      id,
      description,
      status: 'FAIL',
      assertions: 0,
      tasks_before_confirmation: 0,
      tasks_after_confirmation: 0,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export function runM2IndependentAcceptance(): AcceptanceReport {
  const scenarios = [
    scenario(
      'normal-review-confirmation',
      'relevant result requires confirmation before one task',
      () => {
        const flow = new M2ReferenceFlow();
        const request = fixture('single-action');
        const result = flow.submit(request);
        assert.equal(result.status, 200);
        assert.ok(result.response);
        const review = flow.review(request.request_id);
        assert.equal(review.explicit_confirmation_required, true);
        assert.equal(flow.listTasks().length, 0);
        const before = flow.listTasks().length;
        const after = flow.confirm(request.request_id, [review.actions[0]?.action_id ?? '']);
        assert.equal(after.length, 1);
        assert.deepEqual(
          flow.confirm(request.request_id, [review.actions[0]?.action_id ?? '']),
          after,
        );
        return {
          assertions: assertionsFor(result) + 4,
          before,
          after: after.length,
          detail: 'no task before confirmation; repeated confirmation is idempotent',
        };
      },
    ),
    scenario('irrelevant-no-task', 'irrelevant assessment cannot create a task', () => {
      const flow = new M2ReferenceFlow();
      const request = fixture('irrelevant-profile');
      const result = flow.submit(request);
      assert.equal(result.status, 200);
      const review = flow.review(request.request_id);
      assert.equal(review.user_relevance, 'irrelevant');
      assert.equal(review.actions.length, 0);
      assert.equal(review.task_creation_allowed, false);
      assert.throws(() => flow.confirm(request.request_id, []), /不允许创建任务/);
      return {
        assertions: 5,
        before: 0,
        after: 0,
        detail: 'irrelevant result has no actions and no task path',
      };
    }),
    scenario(
      'partial-warning-confirmation',
      'partial result preserves warning and requires confirmation',
      () => {
        const flow = new M2ReferenceFlow();
        const request = fixture('partial-success');
        const result = flow.submit(request);
        assert.equal(result.status, 200);
        const review = flow.review(request.request_id);
        assert.equal(review.status, 'partial');
        assert.equal(review.warnings[0]?.code, 'MISSING_DEADLINE');
        const before = flow.listTasks().length;
        const after = flow.confirm(request.request_id, [review.actions[0]?.action_id ?? '']);
        assert.equal(before, 0);
        assert.equal(after.length, 1);
        return {
          assertions: 6,
          before,
          after: after.length,
          detail: 'missing deadline warning survives review and confirmation',
        };
      },
    ),
    scenario(
      'needs-confirmation-explicit-choice',
      'uncertain result is blocked until explicit choice',
      () => {
        const flow = new M2ReferenceFlow();
        const request = fixture('ambiguous-date');
        const result = flow.submit(request);
        assert.equal(result.status, 200);
        const review = flow.review(request.request_id);
        assert.equal(review.status, 'needs_confirmation');
        assert.equal(review.explicit_confirmation_required, true);
        assert.equal(flow.listTasks().length, 0);
        const after = flow.confirm(request.request_id, [review.actions[0]?.action_id ?? '']);
        assert.equal(after.length, 1);
        return {
          assertions: 5,
          before: 0,
          after: after.length,
          detail: 'ambiguous deadline is visible before user confirmation',
        };
      },
    ),
    scenario('invalid-response-quarantine', 'invalid parser response is quarantined', () => {
      const flow = new M2ReferenceFlow();
      const request = fixture('invalid-response');
      const result = flow.submit(request);
      assert.equal(result.status, 500);
      assert.equal(result.error?.error.code, 'PARSER_RESPONSE_INVALID');
      assert.equal(flow.listTasks().length, 0);
      assert.throws(() => flow.review(request.request_id), /协议验证/);
      return {
        assertions: 4,
        before: 0,
        after: 0,
        detail: 'invalid response never enters review or task creation',
      };
    }),
    scenario('timeout-retryable', 'timeout remains retryable and cannot create a task', () => {
      const flow = new M2ReferenceFlow();
      const request = fixture('timeout');
      const first = flow.submit(request);
      const second = flow.submit(request);
      assert.equal(first.status, 504);
      assert.equal(first.error?.error.code, 'PARSER_TIMEOUT');
      assert.equal(first.error?.error.retryable, true);
      assert.deepEqual(second, first);
      assert.equal(flow.listTasks().length, 0);
      return {
        assertions: 5,
        before: 0,
        after: 0,
        detail: 'same timeout replay is stable and task-free',
      };
    }),
    scenario('idempotent-replay', 'same request replay creates at most one task', () => {
      const flow = new M2ReferenceFlow();
      const request = fixture('idempotent-replay');
      const first = flow.submit(request);
      const second = flow.submit(request);
      assert.deepEqual(second, first);
      const review = flow.review(request.request_id);
      const before = flow.listTasks().length;
      const firstTasks = flow.confirm(request.request_id, [review.actions[0]?.action_id ?? '']);
      const secondTasks = flow.confirm(request.request_id, [review.actions[0]?.action_id ?? '']);
      assert.equal(firstTasks.length, 1);
      assert.deepEqual(secondTasks, firstTasks);
      return {
        assertions: 4,
        before,
        after: secondTasks.length,
        detail: 'parser and task creation are both idempotent',
      };
    }),
    scenario(
      'idempotency-key-reuse-rejected',
      'same key with different content is rejected',
      () => {
        const flow = new M2ReferenceFlow();
        const first = fixture('idempotent-replay');
        const reuse = fixture('idempotency-key-reuse');
        flow.submit(first);
        const result = flow.submit(reuse);
        assert.equal(result.status, 409);
        assert.equal(result.error?.error.code, 'INVALID_REQUEST');
        assert.equal(flow.listTasks().length, 0);
        return {
          assertions: 3,
          before: 0,
          after: 0,
          detail: 'content mismatch on reused key has no executable path',
        };
      },
    ),
    scenario('unmatched-rejected', 'unknown input is rejected without fabrication', () => {
      const flow = new M2ReferenceFlow();
      const request = unmatchedRequest();
      const result = flow.submit(request);
      assert.equal(result.status, 422);
      assert.equal(result.error?.error.code, 'PARSER_REJECTED');
      assert.equal(flow.listTasks().length, 0);
      return {
        assertions: 3,
        before: 0,
        after: 0,
        detail: 'unknown synthetic text is rejected rather than fabricated into an action',
      };
    }),
  ];
  const passed = scenarios.filter((item) => item.status === 'PASS').length;
  return {
    ...referenceFlowProvenance,
    runbook: acceptanceRunbook,
    baseline: acceptanceBaseline,
    status: passed === scenarios.length ? 'PASS' : 'FAIL',
    passed,
    failed: scenarios.length - passed,
    scenarios,
  };
}
