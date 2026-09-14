import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createApiError,
  loadSchema,
  protocolVersion,
  validateActionGraph,
  validateTextParseResponseAgainstText,
  validateTextParseResponse,
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
  const unknownPrecisionWithValue = {
    ...validAction,
    deadline: { ...validAction.deadline, precision: 'unknown' as const },
  };
  assert.equal(validateVerifiedActionObject(unknownPrecisionWithValue).ok, false);
  const danglingDependency = {
    ...validAction,
    dependencies: [
      {
        dependency_id: 'd1',
        from_step_id: 'missing',
        to_step_id: 's1',
        type: 'blocks' as const,
      },
    ],
  };
  assert.equal(validateVerifiedActionObject(danglingDependency).ok, false);
  const conflictedActiveTask = {
    ...validAction,
    verification_status: 'conflict' as const,
    task_status: 'completed' as const,
  };
  assert.equal(validateVerifiedActionObject(conflictedActiveTask).ok, false);
  const explicitNullLocation = {
    ...validAction,
    evidence: [
      ...validAction.evidence,
      {
        evidence_id: 'e4',
        source_text: '地点待定',
        page_or_image: 'p1',
        field_name: 'location' as const,
        epistemic_status: 'explicit' as const,
      },
    ],
    field_status: { ...validAction.field_status, location: 'explicit' as const },
  };
  assert.equal(validateVerifiedActionObject(explicitNullLocation).ok, false);
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

test('runtime response validator keeps verified actions and graph actions consistent', () => {
  const response = {
    schema_version: 'text-parse-response/v1',
    request_id: 'req-graph-consistency',
    document_id: 'doc-test',
    status: 'succeeded',
    document_assessment: {
      schema_version: 'document-assessment/v1',
      document_id: 'doc-test',
      user_relevance: 'relevant',
      relevance_reason: '画像匹配',
      evidence: [{ evidence_id: 'e3', source_text: '学生', field_name: 'user_relevance' }],
      verification_status: 'passed',
    },
    verified_actions: [validAction],
    action_graph: {
      schema_version: 'action-graph/v1',
      graph_id: 'g-test',
      nodes: [{ node_id: 'node-1', node_type: 'action', action_id: 'other-action' }],
      edges: [],
    },
    warnings: [],
    parser_metadata: {
      parser_version: 'test/1.0.0',
      model_provider: 'test',
      model_version: 'test',
      prompt_version: 'test',
      rule_version: 'test',
      ocr_version: 'not_applicable',
      started_at: '2099-01-01T00:00:00.000Z',
      completed_at: '2099-01-01T00:00:00.000Z',
      latency_ms: 0,
    },
  };
  const validation = validateTextParseResponse(response);
  assert.equal(validation.ok, false);
  if (!validation.ok) assert.ok(validation.errors.some((error) => error.keyword === 'consistency'));
  const alignedResponse = {
    ...response,
    action_graph: {
      ...response.action_graph,
      nodes: [{ node_id: 'node-1', node_type: 'action' as const, action_id: 'a-test' }],
    },
  };
  assert.equal(
    validateTextParseResponseAgainstText(alignedResponse, '学生提交材料，截止 10月1日前').ok,
    true,
  );
  const misalignedResponse = {
    ...alignedResponse,
    verified_actions: [
      {
        ...validAction,
        evidence: validAction.evidence.map((item, index) =>
          index === 0 ? { ...item, source_text: '原文不存在的证据' } : item,
        ),
      },
    ],
  };
  const alignment = validateTextParseResponseAgainstText(
    misalignedResponse,
    '学生提交材料，截止 10月1日前',
  );
  assert.equal(alignment.ok, false);
  if (!alignment.ok)
    assert.ok(alignment.errors.some((error) => error.keyword === 'evidence_alignment'));
});

test('runtime response validator rejects cross-document and duplicate action identities', () => {
  const crossDocument = {
    ...validAction,
    document_id: 'another-document',
  };
  const response = {
    schema_version: 'text-parse-response/v1',
    request_id: 'req-action-identity',
    document_id: 'doc-test',
    status: 'succeeded',
    document_assessment: {
      schema_version: 'document-assessment/v1',
      document_id: 'doc-test',
      user_relevance: 'relevant',
      relevance_reason: '画像匹配',
      evidence: [{ evidence_id: 'e3', source_text: '学生', field_name: 'user_relevance' }],
      verification_status: 'passed',
    },
    verified_actions: [crossDocument, { ...validAction }],
    action_graph: {
      schema_version: 'action-graph/v1',
      graph_id: 'g-action-identity',
      nodes: [{ node_id: 'node-1', node_type: 'action', action_id: 'a-test' }],
      edges: [],
    },
    warnings: [],
    parser_metadata: {
      parser_version: 'test/1.0.0',
      model_provider: 'test',
      model_version: 'test',
      prompt_version: 'test',
      rule_version: 'test',
      ocr_version: 'not_applicable',
      started_at: '2099-01-01T00:00:00.000Z',
      completed_at: '2099-01-01T00:00:00.000Z',
      latency_ms: 0,
    },
  };
  const validation = validateTextParseResponse(response);
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.ok(validation.errors.some((error) => error.keyword === 'consistency'));
    assert.ok(validation.errors.some((error) => error.keyword === 'unique'));
  }
});
