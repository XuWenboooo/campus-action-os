import { createHash } from 'node:crypto';
import type {
  ActionGraph,
  ApiError,
  DocumentAssessment,
  TextParseRequest,
  TextParseResponse,
  VerifiedActionObject,
  ParseErrorCode,
} from '@campus-action-os/protocol';

export const developmentProvenance = {
  development_only: true as const,
  synthetic: true as const,
  not_model_output: true as const,
};

export type MockExpected =
  | { kind: 'response'; response: TextParseResponse }
  | { kind: 'error'; error: ApiError; unsafe_response?: unknown };

export type MockFixture = {
  id: string;
  metadata: {
    development_only: true;
    synthetic: true;
    not_model_output: true;
    scenario: string;
    expected_validation: 'pass' | 'fail' | 'error';
  };
  request: TextParseRequest;
  expected: MockExpected;
};

const timestamp = '2026-01-01T00:00:00.000Z';

function request(
  id: string,
  text: string,
  idempotencyKey = `idem-${id}`,
  profile = {},
): TextParseRequest {
  return {
    schema_version: 'text-parse-request/v1',
    request_id: `req-${id}`,
    idempotency_key: idempotencyKey,
    protocol_version: '1.0.0',
    document: {
      document_id: `doc-${id}`,
      content_type: 'text/plain',
      text,
      content_sha256: createHash('sha256').update(text, 'utf8').digest('hex'),
      language: 'zh-CN',
      timezone: 'Asia/Shanghai',
    },
    user_profile: profile,
    execution_context: { environment: 'test', deadline_ms: 5000, requested_at: timestamp },
  };
}

function evidence(
  evidenceId: string,
  sourceText: string,
  fieldName: 'steps' | 'deadline' | 'target_population' | 'required_materials',
) {
  return {
    evidence_id: evidenceId,
    source_text: sourceText,
    page_or_image: 'synthetic-text-1',
    field_name: fieldName,
    epistemic_status: 'explicit' as const,
  };
}

function action(
  documentId: string,
  actionId: string,
  options: {
    deadline?: string | null;
    audience?: 'relevant' | 'uncertain';
    materials?: boolean;
  } = {},
): VerifiedActionObject {
  const audience = options.audience ?? 'relevant';
  const hasDeadline = options.deadline != null;
  const actionEvidence = [
    evidence(`${actionId}-steps`, '完成线上登记', 'steps'),
    evidence(`${actionId}-audience`, '全体在校学生', 'target_population'),
  ];
  if (hasDeadline)
    actionEvidence.push(evidence(`${actionId}-deadline`, '2026年10月1日前', 'deadline'));
  if (options.materials)
    actionEvidence.push(evidence(`${actionId}-materials`, '学生证扫描件', 'required_materials'));
  return {
    schema_version: 'verified-action-object/v1',
    action_id: actionId,
    document_id: documentId,
    title: '合成线上登记行动',
    summary: '仅用于接口开发测试',
    target_population: ['全体在校学生'],
    user_relevance: audience,
    relevance_reason: audience === 'relevant' ? '合成画像命中' : '适用对象未能确定',
    action_type: 'submit',
    steps: [
      {
        step_id: `${actionId}-step-1`,
        instruction: '完成线上登记',
        epistemic_status: 'explicit',
        evidence_ids: [`${actionId}-steps`],
      },
    ],
    dependencies: [],
    conditions: [],
    exceptions: [],
    deadline: {
      value: options.deadline ?? null,
      precision: hasDeadline ? 'day' : 'unknown',
      boundary_semantics: hasDeadline ? 'no_later_than' : 'unknown',
      epistemic_status: hasDeadline ? 'explicit' : 'unknown',
      evidence_ids: hasDeadline ? [`${actionId}-deadline`] : [],
    },
    location: null,
    platform: null,
    entry_link: null,
    required_materials: options.materials
      ? [
          {
            material_id: `${actionId}-material-1`,
            description: '学生证扫描件',
            epistemic_status: 'explicit',
            evidence_ids: [`${actionId}-materials`],
          },
        ]
      : [],
    consequence: null,
    obligation: 'mandatory',
    evidence: actionEvidence,
    confidence: { score: hasDeadline ? 0.88 : 0.35, basis: 'model' },
    epistemic_status: hasDeadline ? 'explicit' : 'unknown',
    field_status: {
      user_relevance: audience === 'relevant' ? 'explicit' : 'unknown',
      target_population: 'explicit',
      steps: 'explicit',
      deadline: hasDeadline ? 'explicit' : 'unknown',
      required_materials: options.materials ? 'explicit' : 'unknown',
      location: 'unknown',
      platform: 'unknown',
      conditions: 'unknown',
      exceptions: 'unknown',
    },
    result_stage: 'model_output',
    verification_status:
      audience === 'relevant' ? 'user_confirmation_required' : 'user_confirmation_required',
    task_status: 'pending',
    change_history: [],
  };
}

function assessment(
  documentId: string,
  relevance: DocumentAssessment['user_relevance'],
  reason: string,
  verificationStatus: DocumentAssessment['verification_status'] = 'passed',
): DocumentAssessment {
  return {
    schema_version: 'document-assessment/v1',
    document_id: documentId,
    user_relevance: relevance,
    relevance_reason: reason,
    evidence: [
      {
        evidence_id: `${documentId}-assessment`,
        source_text: reason,
        field_name: relevance === 'uncertain' ? 'conflict' : 'user_relevance',
      },
    ],
    verification_status: verificationStatus,
  };
}

function metadata(): TextParseResponse['parser_metadata'] {
  return {
    parser_version: 'development-mock-v1',
    model_provider: 'development-mock',
    model_version: 'synthetic-v1',
    prompt_version: 'not_applicable',
    rule_version: 'mock-rules-v1',
    ocr_version: 'not_applicable',
    started_at: timestamp,
    completed_at: timestamp,
    latency_ms: 1,
  };
}

function graph(actions: VerifiedActionObject[]): ActionGraph {
  return {
    schema_version: 'action-graph/v1',
    graph_id: `graph-${actions[0]?.document_id ?? 'empty'}`,
    nodes: actions.map((item) => ({
      node_id: `node-${item.action_id}`,
      node_type: 'action' as const,
      action_id: item.action_id,
    })),
    edges: actions.slice(1).map((item, index) => ({
      edge_id: `edge-${index + 1}`,
      from_node_id: `node-${actions[index]?.action_id}`,
      to_node_id: `node-${item.action_id}`,
      edge_type: 'blocks' as const,
    })),
  };
}

function response(
  req: TextParseRequest,
  status: TextParseResponse['status'],
  assessmentValue: DocumentAssessment,
  actions: VerifiedActionObject[],
  warnings: TextParseResponse['warnings'] = [],
): TextParseResponse {
  return {
    schema_version: 'text-parse-response/v1',
    request_id: req.request_id,
    document_id: req.document.document_id,
    status,
    document_assessment: assessmentValue,
    verified_actions: actions,
    action_graph: actions.length ? graph(actions) : null,
    warnings,
    parser_metadata: metadata(),
    provenance: developmentProvenance,
  };
}

function error(req: TextParseRequest, code: ParseErrorCode, message: string): ApiError {
  return {
    error: {
      code,
      message,
      requestId: req.request_id,
      retryable: code === 'PARSER_TIMEOUT' || code === 'INTERNAL_ERROR',
    },
  };
}

const singleRequest = request('single-action', '合成通知：请在2026年10月1日前完成线上登记。');
const multiRequest = request(
  'multi-action-materials',
  '合成通知：先提交学生证扫描件，再完成线上登记。',
);
const irrelevantRequest = request(
  'irrelevant-profile',
  '合成通知：仅面向校外访客的活动报名。',
  'idem-irrelevant',
  { campus: '东校区' },
);
const uncertainRequest = request('uncertain-audience', '合成通知：符合若干条件的学生请完成登记。');
const ambiguousRequest = request('ambiguous-date', '合成通知：请尽快完成登记，具体日期另行通知。');
const conflictRequest = request(
  'conflicting-dates',
  '合成通知：正文写10月1日截止，附件写10月8日截止。',
);
const invalidRequest = request('invalid-response', '合成通知：这条映射故意产生缺少证据的响应。');
const timeoutRequest = request('timeout', '合成通知：模拟超时。');
const notConfiguredRequest = request('not-configured', '合成通知：模拟未配置。');
const partialRequest = request('partial-success', '合成通知：请完成登记，但没有可靠截止日期。');
const replayRequest = request(
  'idempotent-replay',
  '合成通知：相同请求重复提交应返回同一结果。',
  'idem-replay',
);
const reuseRequest = request(
  'idempotency-key-reuse',
  '合成通知：不同文本不得复用相同幂等键。',
  'idem-replay',
);

const invalidAction = action(invalidRequest.document.document_id, 'a-invalid');
invalidAction.field_status.steps = 'explicit';
invalidAction.evidence = invalidAction.evidence.filter((item) => item.field_name !== 'steps');

export const fixtures: MockFixture[] = [
  {
    id: 'single-action',
    metadata: {
      ...developmentProvenance,
      scenario: 'single action with explicit deadline',
      expected_validation: 'pass',
    },
    request: singleRequest,
    expected: {
      kind: 'response',
      response: response(
        singleRequest,
        'succeeded',
        assessment(singleRequest.document.document_id, 'relevant', '合成画像与通知对象匹配'),
        [action(singleRequest.document.document_id, 'a-single', { deadline: '2026-10-01' })],
      ),
    },
  },
  {
    id: 'multi-action-materials',
    metadata: {
      ...developmentProvenance,
      scenario: 'multiple actions and required materials',
      expected_validation: 'pass',
    },
    request: multiRequest,
    expected: {
      kind: 'response',
      response: response(
        multiRequest,
        'succeeded',
        assessment(multiRequest.document.document_id, 'relevant', '合成通知明确面向学生'),
        [
          action(multiRequest.document.document_id, 'a-multi-1', {
            deadline: '2026-10-01',
            materials: true,
          }),
          action(multiRequest.document.document_id, 'a-multi-2', { deadline: '2026-10-02' }),
        ],
      ),
    },
  },
  {
    id: 'irrelevant-profile',
    metadata: {
      ...developmentProvenance,
      scenario: 'irrelevant document',
      expected_validation: 'pass',
    },
    request: irrelevantRequest,
    expected: {
      kind: 'response',
      response: response(
        irrelevantRequest,
        'succeeded',
        assessment(
          irrelevantRequest.document.document_id,
          'irrelevant',
          '合成通知明确仅面向校外访客',
        ),
        [],
      ),
    },
  },
  {
    id: 'uncertain-audience',
    metadata: {
      ...developmentProvenance,
      scenario: 'uncertain audience',
      expected_validation: 'pass',
    },
    request: uncertainRequest,
    expected: {
      kind: 'response',
      response: response(
        uncertainRequest,
        'needs_confirmation',
        assessment(
          uncertainRequest.document.document_id,
          'uncertain',
          '适用对象条件缺少关键证据',
          'user_confirmation_required',
        ),
        [action(uncertainRequest.document.document_id, 'a-uncertain', { audience: 'uncertain' })],
        [
          {
            code: 'AUDIENCE_UNCERTAIN',
            message: '适用对象需要用户确认',
            paths: ['/document_assessment/user_relevance'],
          },
        ],
      ),
    },
  },
  {
    id: 'ambiguous-date',
    metadata: {
      ...developmentProvenance,
      scenario: 'ambiguous date requiring confirmation',
      expected_validation: 'pass',
    },
    request: ambiguousRequest,
    expected: {
      kind: 'response',
      response: response(
        ambiguousRequest,
        'needs_confirmation',
        assessment(
          ambiguousRequest.document.document_id,
          'relevant',
          '通知要求尽快完成但没有明确日期',
          'user_confirmation_required',
        ),
        [action(ambiguousRequest.document.document_id, 'a-ambiguous', { deadline: null })],
        [
          {
            code: 'DATE_AMBIGUOUS',
            message: '截止时间需要用户确认',
            paths: ['/verified_actions/0/deadline'],
          },
        ],
      ),
    },
  },
  {
    id: 'conflicting-dates',
    metadata: {
      ...developmentProvenance,
      scenario: 'conflicting dates',
      expected_validation: 'pass',
    },
    request: conflictRequest,
    expected: {
      kind: 'response',
      response: response(
        conflictRequest,
        'needs_confirmation',
        assessment(
          conflictRequest.document.document_id,
          'relevant',
          '正文和附件的截止日期冲突',
          'conflict',
        ),
        [action(conflictRequest.document.document_id, 'a-conflict', { deadline: null })],
        [
          {
            code: 'DATE_CONFLICT',
            message: '检测到两个互相冲突的截止日期',
            paths: ['/document_assessment/evidence'],
          },
        ],
      ),
    },
  },
  {
    id: 'invalid-response',
    metadata: {
      ...developmentProvenance,
      scenario: 'invalid response missing evidence',
      expected_validation: 'error',
    },
    request: invalidRequest,
    expected: {
      kind: 'error',
      error: error(
        invalidRequest,
        'PARSER_RESPONSE_INVALID',
        '开发 mock 的响应缺少行动证据，已被协议验证拒绝',
      ),
      unsafe_response: response(
        invalidRequest,
        'succeeded',
        assessment(invalidRequest.document.document_id, 'relevant', '合成通知'),
        [invalidAction],
      ),
    },
  },
  {
    id: 'timeout',
    metadata: {
      ...developmentProvenance,
      scenario: 'parser timeout',
      expected_validation: 'error',
    },
    request: timeoutRequest,
    expected: {
      kind: 'error',
      error: error(timeoutRequest, 'PARSER_TIMEOUT', '开发 mock 模拟解析超时'),
    },
  },
  {
    id: 'not-configured',
    metadata: {
      ...developmentProvenance,
      scenario: 'parser not configured',
      expected_validation: 'error',
    },
    request: notConfiguredRequest,
    expected: {
      kind: 'error',
      error: error(notConfiguredRequest, 'PARSER_NOT_CONFIGURED', '开发 mock 模拟解析器未配置'),
    },
  },
  {
    id: 'partial-success',
    metadata: { ...developmentProvenance, scenario: 'partial result', expected_validation: 'pass' },
    request: partialRequest,
    expected: {
      kind: 'response',
      response: response(
        partialRequest,
        'partial',
        assessment(partialRequest.document.document_id, 'relevant', '通知相关但关键日期缺失'),
        [action(partialRequest.document.document_id, 'a-partial', { deadline: null })],
        [
          {
            code: 'MISSING_DEADLINE',
            message: '未找到可靠截止时间',
            paths: ['/verified_actions/0/deadline'],
          },
        ],
      ),
    },
  },
  {
    id: 'idempotent-replay',
    metadata: {
      ...developmentProvenance,
      scenario: 'same idempotency key replay',
      expected_validation: 'pass',
    },
    request: replayRequest,
    expected: {
      kind: 'response',
      response: response(
        replayRequest,
        'succeeded',
        assessment(replayRequest.document.document_id, 'relevant', '合成通知相关'),
        [action(replayRequest.document.document_id, 'a-replay', { deadline: '2026-10-01' })],
      ),
    },
  },
  {
    id: 'idempotency-key-reuse',
    metadata: {
      ...developmentProvenance,
      scenario: 'same key with different content',
      expected_validation: 'error',
    },
    request: reuseRequest,
    expected: {
      kind: 'error',
      error: error(reuseRequest, 'INVALID_REQUEST', 'idempotency_key 已绑定其他 document 内容'),
    },
  },
];

export const fixtureById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));

export function fixtureForRequest(value: TextParseRequest): MockFixture | undefined {
  return fixtures.find(
    (fixture) => fixture.request.document.content_sha256 === value.document.content_sha256,
  );
}
