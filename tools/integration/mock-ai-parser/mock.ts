import {
  createParseError,
  validateTextParseExchange,
  validateTextParseRequest,
  type ApiError,
  type TextParseRequest,
  type TextParseResponse,
} from '@campus-action-os/protocol';
import { fixtureForRequest, type MockFixture } from '../../../tests/fixtures/m2-text/catalog.js';

export type MockResult = {
  status: number;
  body: TextParseResponse | ApiError;
};

export class DeterministicMockParser {
  private readonly idempotency = new Map<string, { contentHash: string; result: MockResult }>();

  parse(input: unknown): MockResult {
    const requestId = typeof input === 'object' && input !== null && 'request_id' in input
      ? String((input as { request_id?: unknown }).request_id ?? 'unknown')
      : 'unknown';
    const requestResult = validateTextParseRequest(input);
    if (!requestResult.ok) {
      return { status: 400, body: createParseError('INVALID_REQUEST', '请求不符合 text-parse-request/v1', requestId) };
    }
    const request = requestResult.value;
    const previous = this.idempotency.get(request.idempotency_key);
    if (previous && previous.contentHash !== request.document.content_sha256) {
      return {
        status: 409,
        body: createParseError('INVALID_REQUEST', 'idempotency_key 已绑定其他 document 内容', request.request_id),
      };
    }
    if (previous) return previous.result;

    const fixture = fixtureForRequest(request);
    if (!fixture) {
      const result = { status: 422, body: createParseError('PARSER_REJECTED', '开发 mock 未匹配到固定 fixture', request.request_id) };
      this.idempotency.set(request.idempotency_key, { contentHash: request.document.content_sha256, result });
      return result;
    }
    const result = this.resultForFixture(request, fixture);
    this.idempotency.set(request.idempotency_key, { contentHash: request.document.content_sha256, result });
    return result;
  }

  private resultForFixture(request: TextParseRequest, fixture: MockFixture): MockResult {
    if (fixture.expected.kind === 'error') {
      if (fixture.expected.unsafe_response !== undefined) {
        const unsafe = validateTextParseExchange(request, fixture.expected.unsafe_response);
        if (!unsafe.ok) {
          return {
            status: 500,
            body: createParseError('PARSER_RESPONSE_INVALID', '开发 mock 响应未通过共享协议验证', request.request_id),
          };
        }
      }
      const status = fixture.expected.error.error.code === 'PARSER_TIMEOUT' ? 504 : fixture.expected.error.error.code === 'PARSER_NOT_CONFIGURED' ? 503 : 422;
      return { status, body: fixture.expected.error };
    }
    const exchange = validateTextParseExchange(request, fixture.expected.response);
    if (!exchange.ok) {
      return {
        status: 500,
        body: createParseError('PARSER_RESPONSE_INVALID', '开发 mock 响应未通过共享协议验证', request.request_id),
      };
    }
    return { status: 200, body: fixture.expected.response };
  }
}

export const mockParser = new DeterministicMockParser();
