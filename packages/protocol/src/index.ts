import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import * as ajvFormats from 'ajv-formats';

const addFormats = ajvFormats.default as unknown as (ajv: Ajv2020) => Ajv2020;

export const protocolVersion = '1.0.0';
export type ProtocolVersion = typeof protocolVersion;

export type Relevance = 'relevant' | 'irrelevant' | 'uncertain';
export type DeadlinePrecision = 'minute' | 'hour' | 'day' | 'range' | 'unknown';
export type BoundarySemantics = 'before' | 'no_later_than' | 'on' | 'after' | 'unknown';
export type Obligation = 'mandatory' | 'recommended' | 'informational' | 'unknown';
export type EpistemicStatus = 'explicit' | 'rule_inferred' | 'ai_estimated' | 'unknown';
export type ResultStage = 'model_output' | 'rule_reviewed' | 'user_confirmed';
export type VerificationStatus = 'passed' | 'conflict' | 'user_confirmation_required';
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'expired' | 'cancelled';

export type Claim = {
  value: string | null;
  epistemic_status: EpistemicStatus;
  evidence_ids: string[];
};

export type ActionStep = {
  step_id: string;
  instruction: string;
  location?: Claim | null;
  platform?: Claim | null;
  required_materials?: Material[];
  epistemic_status: EpistemicStatus;
  evidence_ids: string[];
};

export type ActionDependency = {
  dependency_id: string;
  from_step_id: string;
  to_step_id: string;
  type: 'blocks' | 'requires' | 'informs' | 'alternative_to' | 'postpones' | 'revokes' | 'replaces';
  condition_id?: string;
};

export type ActionCondition = {
  condition_id: string;
  statement: string;
  outcomes: Array<{ label: string; step_ids: string[] }>;
  epistemic_status: EpistemicStatus;
  evidence_ids: string[];
};

export type ActionException = {
  exception_id: string;
  statement: string;
  epistemic_status: EpistemicStatus;
  evidence_ids: string[];
};

export type Deadline = {
  value: string | null;
  precision: DeadlinePrecision;
  boundary_semantics: BoundarySemantics;
  timezone?: string;
  epistemic_status: EpistemicStatus;
  evidence_ids: string[];
};

export type Material = {
  material_id: string;
  description: string;
  epistemic_status: EpistemicStatus;
  evidence_ids: string[];
};

export type Evidence = {
  evidence_id: string;
  source_text: string;
  page_or_image: string;
  bounding_box?: [number, number, number, number];
  field_name:
    | 'user_relevance'
    | 'target_population'
    | 'steps'
    | 'dependencies'
    | 'conditions'
    | 'exceptions'
    | 'deadline'
    | 'location'
    | 'platform'
    | 'entry_link'
    | 'required_materials'
    | 'consequence';
  epistemic_status: EpistemicStatus;
};

export type FieldStatus = {
  user_relevance: EpistemicStatus;
  target_population: EpistemicStatus;
  steps: EpistemicStatus;
  deadline: EpistemicStatus;
  required_materials: EpistemicStatus;
  location: EpistemicStatus;
  platform: EpistemicStatus;
  conditions: EpistemicStatus;
  exceptions: EpistemicStatus;
};

export type Change = {
  change_id: string;
  occurred_at: string;
  actor: 'model' | 'rule_engine' | 'publisher' | 'user' | 'system';
  change_type:
    'created' | 'reviewed' | 'confirmed' | 'postponed' | 'revoked' | 'replaced' | 'corrected';
  reason: string;
  previous_action_id?: string;
};

export type VerifiedActionObject = {
  schema_version: 'verified-action-object/v1';
  action_id: string;
  document_id: string;
  title: string;
  summary?: string;
  target_population: string[];
  user_relevance: Relevance;
  relevance_reason: string;
  action_type: string;
  steps: ActionStep[];
  dependencies: ActionDependency[];
  conditions: ActionCondition[];
  exceptions: ActionException[];
  deadline: Deadline;
  location: Claim | null;
  platform: Claim | null;
  entry_link: Claim | null;
  required_materials: Material[];
  consequence: Claim | null;
  obligation: Obligation;
  evidence: Evidence[];
  confidence: { score: number; basis: 'model' | 'rule_review' | 'user_confirmed' };
  epistemic_status: EpistemicStatus;
  field_status: FieldStatus;
  result_stage: ResultStage;
  verification_status: VerificationStatus;
  task_status: TaskStatus;
  change_history: Change[];
};

export type ActionGraphNode = {
  node_id: string;
  node_type: 'action' | 'precondition' | 'decision' | 'milestone' | 'notice_revision';
  action_id?: string;
  population_groups?: string[];
  condition_ids?: string[];
  milestone_id?: string;
  notice_revision_id?: string;
};

export type ActionGraphEdge = {
  edge_id: string;
  from_node_id: string;
  to_node_id: string;
  edge_type:
    | 'blocks'
    | 'requires'
    | 'informs'
    | 'branches_to'
    | 'alternative_to'
    | 'postpones'
    | 'revokes'
    | 'replaces';
  condition_id?: string;
};

export type ActionGraph = {
  schema_version: 'action-graph/v1';
  graph_id: string;
  nodes: ActionGraphNode[];
  edges: ActionGraphEdge[];
};

export type RequestContext = {
  requestId: string;
  environment: 'local' | 'test' | 'demo' | 'production';
};

export type TextParseStatus = 'succeeded' | 'partial' | 'needs_confirmation' | 'rejected';
export type ParseErrorCode =
  | 'INVALID_REQUEST'
  | 'TEXT_TOO_LARGE'
  | 'UNSUPPORTED_CONTENT_TYPE'
  | 'PROTOCOL_VERSION_UNSUPPORTED'
  | 'PARSER_NOT_CONFIGURED'
  | 'PARSER_TIMEOUT'
  | 'PARSER_REJECTED'
  | 'PARSER_RESPONSE_INVALID'
  | 'INTERNAL_ERROR';

export type TextParseDocument = {
  document_id: string;
  content_type: 'text/plain';
  text: string;
  content_sha256: string;
  language: string;
  timezone: string;
};

export type UserProfile = {
  education_level?: string;
  grade?: string;
  college?: string;
  major?: string;
  campus?: string;
  student_categories?: string[];
  organization_memberships?: string[];
};

export type TextParseExecutionContext = {
  environment: 'local' | 'test' | 'demo' | 'production';
  deadline_ms: number;
  requested_at: string;
};

export type TextParseRequest = {
  schema_version: 'text-parse-request/v1';
  request_id: string;
  idempotency_key: string;
  protocol_version: ProtocolVersion;
  document: TextParseDocument;
  user_profile: UserProfile;
  execution_context: TextParseExecutionContext;
};

export type AssessmentEvidence = {
  evidence_id: string;
  source_text: string;
  field_name: 'user_relevance' | 'target_population' | 'deadline' | 'conflict' | 'other';
  span?: [number, number];
};

export type DocumentAssessment = {
  schema_version: 'document-assessment/v1';
  document_id: string;
  user_relevance: Relevance;
  relevance_reason: string;
  evidence: AssessmentEvidence[];
  verification_status: VerificationStatus;
};

export type ParseWarning = {
  code: string;
  message: string;
  paths?: string[];
};

export type ParserMetadata = {
  parser_version: string;
  model_provider: string;
  model_version: string;
  prompt_version: string;
  rule_version: string;
  ocr_version: 'not_applicable';
  started_at: string;
  completed_at: string;
  latency_ms: number;
};

export type DevelopmentProvenance = {
  development_only: true;
  synthetic: true;
  not_model_output: true;
};

export type TextParseResponse = {
  schema_version: 'text-parse-response/v1';
  request_id: string;
  document_id: string;
  status: TextParseStatus;
  document_assessment: DocumentAssessment;
  verified_actions: VerifiedActionObject[];
  action_graph: ActionGraph | null;
  warnings: ParseWarning[];
  parser_metadata: ParserMetadata;
  provenance?: DevelopmentProvenance;
};

export type ApiError = {
  error: { code: string; message: string; requestId: string; retryable: boolean };
};

export type ProtocolSchemaName =
  | 'verified-action-object'
  | 'action-graph'
  | 'campus-action-bench'
  | 'text-parse-request'
  | 'document-assessment'
  | 'text-parse-response';
export type ValidationError = {
  path: string;
  keyword: string;
  message: string;
};
export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: ValidationError[] };

const schemaFiles: Record<ProtocolSchemaName, string> = {
  'verified-action-object': 'schemas/v1/verified-action-object.schema.json',
  'action-graph': 'schemas/v1/action-graph.schema.json',
  'campus-action-bench': 'benchmark/schema/campus-action-bench-v1.schema.json',
  'text-parse-request': 'schemas/interfaces/v1/text-parse-request.schema.json',
  'document-assessment': 'schemas/interfaces/v1/document-assessment.schema.json',
  'text-parse-response': 'schemas/interfaces/v1/text-parse-response.schema.json',
};
const sourceRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');

export function getSchemaPath(name: ProtocolSchemaName, rootDir = sourceRoot): string {
  return resolve(rootDir, schemaFiles[name]);
}

export function loadSchema(
  name: ProtocolSchemaName,
  rootDir = sourceRoot,
): Record<string, unknown> {
  return JSON.parse(readFileSync(getSchemaPath(name, rootDir), 'utf8')) as Record<string, unknown>;
}

function toValidationErrors(errors: ErrorObject[] | null | undefined): ValidationError[] {
  return (errors ?? []).map((error) => ({
    path: error.instancePath || '/',
    keyword: error.keyword,
    message: error.message ?? 'validation failed',
  }));
}

function makeValidator(name: ProtocolSchemaName, rootDir: string): ValidateFunction {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  if (name === 'text-parse-response') {
    ajv.addSchema(loadSchema('verified-action-object', rootDir));
    ajv.addSchema(loadSchema('action-graph', rootDir));
    ajv.addSchema(loadSchema('document-assessment', rootDir));
  }
  return ajv.compile(loadSchema(name, rootDir));
}

function semanticErrors(action: VerifiedActionObject): ValidationError[] {
  const errors: ValidationError[] = [];
  if (action.deadline.value === null && action.deadline.precision !== 'unknown') {
    errors.push({
      path: '/deadline/precision',
      keyword: 'semantic',
      message: 'null deadline requires unknown precision',
    });
  }
  const evidence = new Set(action.evidence.map((item) => item.field_name));
  const evidenceField: Record<
    keyof FieldStatus,
    Evidence['field_name'] | Evidence['field_name'][]
  > = {
    user_relevance: ['user_relevance', 'target_population'],
    target_population: 'target_population',
    steps: 'steps',
    deadline: 'deadline',
    required_materials: 'required_materials',
    location: 'location',
    platform: 'platform',
    conditions: 'conditions',
    exceptions: 'exceptions',
  };
  for (const [field, status] of Object.entries(action.field_status) as Array<
    [keyof FieldStatus, EpistemicStatus]
  >) {
    const fields = Array.isArray(evidenceField[field])
      ? evidenceField[field]
      : [evidenceField[field]];
    if (
      status === 'explicit' &&
      !fields.some((evidenceFieldName) => evidence.has(evidenceFieldName))
    ) {
      errors.push({
        path: `/field_status/${field}`,
        keyword: 'evidence',
        message: 'explicit field requires matching evidence',
      });
    }
  }
  if (action.result_stage === 'model_output' && action.verification_status === 'passed') {
    errors.push({
      path: '/verification_status',
      keyword: 'semantic',
      message: 'model output cannot claim passed verification',
    });
  }
  return errors;
}

function validate<T>(
  name: ProtocolSchemaName,
  value: unknown,
  rootDir: string,
): ValidationResult<T> {
  const validator = makeValidator(name, rootDir);
  if (!validator(value)) return { ok: false, errors: toValidationErrors(validator.errors) };
  return { ok: true, value: value as T };
}

export function validateVerifiedActionObject(
  value: unknown,
  rootDir = sourceRoot,
): ValidationResult<VerifiedActionObject> {
  const result = validate<VerifiedActionObject>('verified-action-object', value, rootDir);
  if (!result.ok) return result;
  const errors = semanticErrors(result.value);
  return errors.length ? { ok: false, errors } : result;
}

export function validateActionGraph(
  value: unknown,
  rootDir = sourceRoot,
): ValidationResult<ActionGraph> {
  const result = validate<ActionGraph>('action-graph', value, rootDir);
  if (!result.ok) return result;
  const errors: ValidationError[] = [];
  const nodeIds = new Set<string>();
  const actionIds = new Set<string>();
  const decisionConditions = new Set<string>();
  for (const [index, node] of result.value.nodes.entries()) {
    if (nodeIds.has(node.node_id))
      errors.push({
        path: `/nodes/${index}/node_id`,
        keyword: 'unique',
        message: 'node_id must be unique',
      });
    nodeIds.add(node.node_id);
    if (node.node_type === 'action' && node.action_id) {
      if (actionIds.has(node.action_id))
        errors.push({
          path: `/nodes/${index}/action_id`,
          keyword: 'unique',
          message: 'action_id must be unique within a graph',
        });
      actionIds.add(node.action_id);
    }
    for (const condition of node.condition_ids ?? []) decisionConditions.add(condition);
  }
  const edgeIds = new Set<string>();
  const adjacency = new Map<string, string[]>();
  for (const [index, edge] of result.value.edges.entries()) {
    if (edgeIds.has(edge.edge_id))
      errors.push({
        path: `/edges/${index}/edge_id`,
        keyword: 'unique',
        message: 'edge_id must be unique',
      });
    edgeIds.add(edge.edge_id);
    if (!nodeIds.has(edge.from_node_id) || !nodeIds.has(edge.to_node_id)) {
      errors.push({
        path: `/edges/${index}`,
        keyword: 'reference',
        message: 'edge endpoint must reference an existing node',
      });
    }
    if (edge.edge_type === 'branches_to' && !decisionConditions.has(edge.condition_id ?? '')) {
      errors.push({
        path: `/edges/${index}/condition_id`,
        keyword: 'reference',
        message: 'branch condition must reference a decision condition',
      });
    }
    if (['blocks', 'requires', 'branches_to', 'postpones', 'replaces'].includes(edge.edge_type)) {
      const children = adjacency.get(edge.from_node_id) ?? [];
      children.push(edge.to_node_id);
      adjacency.set(edge.from_node_id, children);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (node: string): boolean => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    if ((adjacency.get(node) ?? []).some(visit)) return true;
    visiting.delete(node);
    visited.add(node);
    return false;
  };
  if ([...nodeIds].some(visit))
    errors.push({ path: '/edges', keyword: 'cycle', message: 'execution dependency cycle' });
  return errors.length ? { ok: false, errors } : result;
}

function prefixedErrors(prefix: string, errors: ValidationError[]): ValidationError[] {
  return errors.map((error) => ({
    ...error,
    path: `${prefix}${error.path === '/' ? '' : error.path}`,
  }));
}

export function validateTextParseRequest(
  value: unknown,
  rootDir = sourceRoot,
): ValidationResult<TextParseRequest> {
  const result = validate<TextParseRequest>('text-parse-request', value, rootDir);
  if (!result.ok) return result;
  const actualHash = createHash('sha256').update(result.value.document.text, 'utf8').digest('hex');
  if (actualHash !== result.value.document.content_sha256) {
    return {
      ok: false,
      errors: [
        {
          path: '/document/content_sha256',
          keyword: 'content_sha256',
          message: 'content_sha256 does not match document.text',
        },
      ],
    };
  }
  return result;
}

export function validateDocumentAssessment(
  value: unknown,
  rootDir = sourceRoot,
): ValidationResult<DocumentAssessment> {
  const result = validate<DocumentAssessment>('document-assessment', value, rootDir);
  if (!result.ok) return result;
  const errors: ValidationError[] = [];
  if (
    result.value.user_relevance === 'irrelevant' &&
    result.value.verification_status !== 'passed'
  ) {
    errors.push({
      path: '/verification_status',
      keyword: 'semantic',
      message: 'irrelevant assessment must have passed verification status',
    });
  }
  if (
    result.value.user_relevance === 'uncertain' &&
    result.value.verification_status === 'passed'
  ) {
    errors.push({
      path: '/verification_status',
      keyword: 'semantic',
      message: 'uncertain assessment requires explicit confirmation or conflict status',
    });
  }
  return errors.length ? { ok: false, errors } : result;
}

export function validateTextParseResponse(
  value: unknown,
  rootDir = sourceRoot,
): ValidationResult<TextParseResponse> {
  const result = validate<TextParseResponse>('text-parse-response', value, rootDir);
  if (!result.ok) return result;
  const response = result.value;
  const errors: ValidationError[] = [];
  const assessment = validateDocumentAssessment(response.document_assessment, rootDir);
  if (!assessment.ok) errors.push(...prefixedErrors('/document_assessment', assessment.errors));

  for (const [index, action] of response.verified_actions.entries()) {
    const actionResult = validateVerifiedActionObject(action, rootDir);
    if (!actionResult.ok)
      errors.push(...prefixedErrors(`/verified_actions/${index}`, actionResult.errors));
    if (action.user_relevance === 'irrelevant') {
      errors.push({
        path: `/verified_actions/${index}/user_relevance`,
        keyword: 'semantic',
        message: 'irrelevant documents cannot contain an action object',
      });
    }
  }

  if (response.action_graph !== null) {
    const graph = validateActionGraph(response.action_graph, rootDir);
    if (!graph.ok) errors.push(...prefixedErrors('/action_graph', graph.errors));
  }
  if (response.document_assessment.document_id !== response.document_id) {
    errors.push({
      path: '/document_assessment/document_id',
      keyword: 'consistency',
      message: 'document_assessment.document_id must equal document_id',
    });
  }
  if (
    response.status === 'succeeded' &&
    !['relevant', 'irrelevant'].includes(response.document_assessment.user_relevance)
  ) {
    errors.push({
      path: '/status',
      keyword: 'semantic',
      message: 'succeeded response requires a relevant or irrelevant document assessment',
    });
  }
  if (response.status === 'partial' && response.warnings.length === 0) {
    errors.push({
      path: '/warnings',
      keyword: 'semantic',
      message: 'partial response requires warnings',
    });
  }
  if (response.status === 'needs_confirmation') {
    const hasBasis =
      response.document_assessment.user_relevance === 'uncertain' ||
      response.document_assessment.verification_status !== 'passed' ||
      response.warnings.some((warning) =>
        /conflict|confirm|uncertain/i.test(warning.code + warning.message),
      );
    if (!hasBasis) {
      errors.push({
        path: '/status',
        keyword: 'semantic',
        message: 'needs_confirmation requires an uncertainty or conflict basis',
      });
    }
  }
  if (
    response.status === 'rejected' &&
    (response.verified_actions.length > 0 || response.action_graph !== null)
  ) {
    errors.push({
      path: '/verified_actions',
      keyword: 'semantic',
      message: 'rejected response must not contain executable results',
    });
  }
  const started = Date.parse(response.parser_metadata.started_at);
  const completed = Date.parse(response.parser_metadata.completed_at);
  if (Number.isFinite(started) && Number.isFinite(completed) && completed < started) {
    errors.push({
      path: '/parser_metadata/completed_at',
      keyword: 'semantic',
      message: 'completed_at must not precede started_at',
    });
  }
  return errors.length ? { ok: false, errors } : result;
}

export function validateTextParseExchange(
  request: unknown,
  response: unknown,
  rootDir = sourceRoot,
): ValidationResult<{ request: TextParseRequest; response: TextParseResponse }> {
  const requestResult = validateTextParseRequest(request, rootDir);
  const responseResult = validateTextParseResponse(response, rootDir);
  const errors: ValidationError[] = [];
  if (!requestResult.ok) errors.push(...prefixedErrors('/request', requestResult.errors));
  if (!responseResult.ok) errors.push(...prefixedErrors('/response', responseResult.errors));
  if (errors.length > 0 || !requestResult.ok || !responseResult.ok) {
    return { ok: false, errors };
  }
  if (requestResult.value.request_id !== responseResult.value.request_id) {
    errors.push({
      path: '/response/request_id',
      keyword: 'consistency',
      message: 'request_id must round-trip unchanged',
    });
  }
  if (requestResult.value.document.document_id !== responseResult.value.document_id) {
    errors.push({
      path: '/response/document_id',
      keyword: 'consistency',
      message: 'document_id must round-trip unchanged',
    });
  }
  if (requestResult.value.protocol_version !== protocolVersion) {
    errors.push({
      path: '/request/protocol_version',
      keyword: 'consistency',
      message: 'unsupported protocol version',
    });
  }
  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: { request: requestResult.value, response: responseResult.value } };
}

export function isRetryableParseError(code: ParseErrorCode): boolean {
  return code === 'PARSER_TIMEOUT' || code === 'INTERNAL_ERROR';
}

export function createParseError(
  code: ParseErrorCode,
  message: string,
  requestId: string,
): ApiError {
  return createApiError(code, message, requestId, isRetryableParseError(code));
}

export function createApiError(
  code: string,
  message: string,
  requestId: string,
  retryable = false,
): ApiError {
  return { error: { code, message, requestId, retryable } };
}
