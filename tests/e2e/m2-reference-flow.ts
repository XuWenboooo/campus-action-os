import { createHash } from 'node:crypto';
import {
  type ApiError,
  type TextParseRequest,
  type TextParseResponse,
  type VerifiedActionObject,
  validateTextParseExchange,
} from '@campus-action-os/protocol';
import {
  DeterministicMockParser,
  type MockResult,
} from '../../tools/integration/mock-ai-parser/mock.js';

export const referenceFlowProvenance = {
  development_only: true as const,
  synthetic: true as const,
  not_model_output: true as const,
};

export type ReferenceParseResult = {
  request_id: string;
  request: TextParseRequest | null;
  status: number;
  response?: TextParseResponse;
  error?: ApiError;
  validation_errors?: Array<{ path: string; keyword: string; message: string }>;
};

export type ReferenceParser = {
  parse(input: unknown): MockResult;
};

export type ReferenceReview = typeof referenceFlowProvenance & {
  request_id: string;
  document_id: string;
  status: TextParseResponse['status'];
  user_relevance: TextParseResponse['document_assessment']['user_relevance'];
  relevance_reason: string;
  evidence: TextParseResponse['document_assessment']['evidence'];
  warnings: TextParseResponse['warnings'];
  actions: VerifiedActionObject[];
  explicit_confirmation_required: boolean;
  task_creation_allowed: boolean;
};

export type ReferenceTask = typeof referenceFlowProvenance & {
  task_id: string;
  document_id: string;
  action_id: string;
  title: string;
  created_at: '2026-01-01T00:00:00.000Z';
  source: 'm2-reference-flow';
};

export class ReferenceFlowError extends Error {
  readonly code = 'CONFIRMATION_NOT_ALLOWED';

  constructor(message: string) {
    super(message);
    this.name = 'ReferenceFlowError';
  }
}

function requestIdFromInput(input: unknown): string {
  if (typeof input === 'object' && input !== null && 'request_id' in input) {
    return String((input as { request_id?: unknown }).request_id ?? 'unknown');
  }
  return 'unknown';
}

function taskId(documentId: string, actionId: string): string {
  return `task-${createHash('sha256').update(`${documentId}:${actionId}`, 'utf8').digest('hex').slice(0, 16)}`;
}

function isApiError(body: TextParseResponse | ApiError): body is ApiError {
  return 'error' in body;
}

function toRequest(input: unknown): TextParseRequest | null {
  if (typeof input !== 'object' || input === null || !('document' in input)) return null;
  return input as TextParseRequest;
}

export class M2ReferenceFlow {
  private readonly parser: ReferenceParser;
  private readonly results = new Map<string, ReferenceParseResult>();
  private readonly tasks = new Map<string, ReferenceTask>();

  constructor(parser: ReferenceParser = new DeterministicMockParser()) {
    this.parser = parser;
  }

  submit(input: unknown): ReferenceParseResult {
    const result: MockResult = this.parser.parse(input);
    const requestId = requestIdFromInput(input);
    const request = toRequest(input);
    const referenceResult: ReferenceParseResult = {
      request_id: requestId,
      request,
      status: result.status,
    };

    if (isApiError(result.body)) {
      referenceResult.error = result.body;
    } else if (request) {
      const exchange = validateTextParseExchange(request, result.body);
      if (!exchange.ok) {
        referenceResult.status = 500;
        referenceResult.error = {
          error: {
            code: 'PARSER_RESPONSE_INVALID',
            message: '参考闭环拒绝未通过共享协议验证的 parser response',
            requestId,
            retryable: false,
          },
        };
        referenceResult.validation_errors = exchange.errors;
      } else {
        referenceResult.response = exchange.value.response;
      }
    }

    this.results.set(requestId, referenceResult);
    return referenceResult;
  }

  review(requestId: string): ReferenceReview {
    const result = this.results.get(requestId);
    if (!result?.response) {
      throw new ReferenceFlowError('只有通过协议验证的 parser response 才能进入用户 review');
    }
    const response = result.response;
    const irrelevant = response.document_assessment.user_relevance === 'irrelevant';
    return {
      ...referenceFlowProvenance,
      request_id: response.request_id,
      document_id: response.document_id,
      status: response.status,
      user_relevance: response.document_assessment.user_relevance,
      relevance_reason: response.document_assessment.relevance_reason,
      evidence: response.document_assessment.evidence,
      warnings: response.warnings,
      actions: response.verified_actions,
      explicit_confirmation_required: !irrelevant,
      task_creation_allowed:
        !irrelevant &&
        response.verified_actions.length > 0 &&
        ['succeeded', 'partial', 'needs_confirmation'].includes(response.status),
    };
  }

  confirm(requestId: string, actionIds: string[]): ReferenceTask[] {
    const review = this.review(requestId);
    if (!review.task_creation_allowed) {
      throw new ReferenceFlowError('当前结果不允许创建任务');
    }
    const actionMap = new Map(review.actions.map((action) => [action.action_id, action]));
    const selected = [...new Set(actionIds)];
    if (selected.some((actionId) => !actionMap.has(actionId))) {
      throw new ReferenceFlowError('确认的 action_id 不属于当前 review');
    }

    for (const actionId of selected) {
      const action = actionMap.get(actionId);
      if (!action) continue;
      const id = taskId(review.document_id, actionId);
      this.tasks.set(id, {
        ...referenceFlowProvenance,
        task_id: id,
        document_id: review.document_id,
        action_id: actionId,
        title: action.title,
        created_at: '2026-01-01T00:00:00.000Z',
        source: 'm2-reference-flow',
      });
    }
    return this.listTasksForDocument(review.document_id);
  }

  listTasks(): ReferenceTask[] {
    return [...this.tasks.values()].sort((left, right) =>
      left.task_id.localeCompare(right.task_id),
    );
  }

  private listTasksForDocument(documentId: string): ReferenceTask[] {
    return this.listTasks().filter((task) => task.document_id === documentId);
  }
}
