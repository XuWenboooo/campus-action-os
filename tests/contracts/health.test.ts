import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createApiError,
  loadSchema,
  protocolVersion,
  validateActionGraph,
  validateVerifiedActionObject,
} from '@campus-action-os/protocol';

test('protocol exposes a version without defining the final action schema', () => {
  assert.match(protocolVersion, /^\d+\.\d+\.\d+$/);
});

test('protocol loads local schemas offline and creates standard errors', () => {
  const vao = loadSchema('verified-action-object') as { $id?: string };
  const error = createApiError('EXAMPLE', 'Example error', 'request-123');
  assert.match(vao.$id ?? '', /verified-action-object/);
  assert.deepEqual(error, {
    error: {
      code: 'EXAMPLE',
      message: 'Example error',
      requestId: 'request-123',
      retryable: false,
    },
  });
});

const validAction = {
  schema_version: 'verified-action-object/v1',
  action_id: 'a-test',
  document_id: 'doc-test',
  title: '测试行动',
  target_population: ['学生'],
  user_relevance: 'relevant',
  relevance_reason: '画像匹配',
  action_type: 'submit',
  steps: [
    { step_id: 's1', instruction: '提交材料', epistemic_status: 'explicit', evidence_ids: ['e1'] },
  ],
  dependencies: [],
  conditions: [],
  exceptions: [],
  deadline: {
    value: '2026-10-01',
    precision: 'day',
    boundary_semantics: 'no_later_than',
    epistemic_status: 'explicit',
    evidence_ids: ['e2'],
  },
  location: null,
  platform: null,
  entry_link: null,
  required_materials: [],
  consequence: null,
  obligation: 'unknown',
  evidence: [
    {
      evidence_id: 'e1',
      source_text: '提交材料',
      page_or_image: 'p1',
      field_name: 'steps',
      epistemic_status: 'explicit',
    },
    {
      evidence_id: 'e2',
      source_text: '10月1日前',
      page_or_image: 'p1',
      field_name: 'deadline',
      epistemic_status: 'explicit',
    },
    {
      evidence_id: 'e3',
      source_text: '学生',
      page_or_image: 'p1',
      field_name: 'target_population',
      epistemic_status: 'explicit',
    },
  ],
  confidence: { score: 0, basis: 'rule_review' },
  epistemic_status: 'explicit',
  field_status: {
    user_relevance: 'explicit',
    target_population: 'explicit',
    steps: 'explicit',
    deadline: 'explicit',
    required_materials: 'unknown',
    location: 'unknown',
    platform: 'unknown',
    conditions: 'unknown',
    exceptions: 'unknown',
  },
  result_stage: 'rule_reviewed',
  verification_status: 'passed',
  task_status: 'pending',
  change_history: [],
};

test('runtime validator accepts a typed action and rejects unsafe variants', () => {
  assert.equal(validateVerifiedActionObject(validAction).ok, true);
  const stringNull = { ...validAction, deadline: { ...validAction.deadline, value: 'null' } };
  assert.equal(validateVerifiedActionObject(stringNull).ok, false);
  const missingEvidence = { ...validAction, evidence: [] };
  assert.equal(validateVerifiedActionObject(missingEvidence).ok, false);
});

test('runtime graph validator rejects dangling and execution-cycle graphs', () => {
  const base = {
    schema_version: 'action-graph/v1',
    graph_id: 'g-test',
    nodes: [
      { node_id: 'n1', node_type: 'action', action_id: 'a-test' },
      { node_id: 'n2', node_type: 'action', action_id: 'a-test-2' },
    ],
    edges: [],
  } as const;
  assert.equal(validateActionGraph(base).ok, true);
  const dangling = {
    ...base,
    edges: [{ edge_id: 'e1', from_node_id: 'n1', to_node_id: 'missing', edge_type: 'blocks' }],
  };
  assert.equal(validateActionGraph(dangling).ok, false);
  const cycle = {
    ...base,
    edges: [
      { edge_id: 'e1', from_node_id: 'n1', to_node_id: 'n2', edge_type: 'blocks' },
      { edge_id: 'e2', from_node_id: 'n2', to_node_id: 'n1', edge_type: 'requires' },
    ],
  };
  assert.equal(validateActionGraph(cycle).ok, false);
});
