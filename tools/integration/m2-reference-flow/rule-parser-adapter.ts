import { createHash } from 'node:crypto';
import {
  createParseError,
  validateTextParseRequest,
  validateTextParseResponseAgainstText,
  type TextParseRequest,
} from '@campus-action-os/protocol';
import { parseText } from '../../../services/ai-parser/src/rule-parser.js';
import type { MockResult } from '../mock-ai-parser/mock.js';

/**
 * Development-only bridge: the M2 reference flow keeps its review/task state,
 * while this adapter delegates text compilation to the current rule parser.
 * It never turns the synthetic fixture mock into a production dependency.
 */
export class RuleParserM2Adapter {
  private readonly idempotency = new Map<string, { contentHash: string; result: MockResult }>();

  parse(input: unknown): MockResult {
    const requestId =
      typeof input === 'object' && input !== null && 'request_id' in input
        ? String((input as { request_id?: unknown }).request_id ?? 'unknown')
        : 'unknown';
    const requestResult = validateTextParseRequest(input);
    if (!requestResult.ok)
      return {
        status: 400,
        body: createParseError('INVALID_REQUEST', '请求不符合 text-parse-request/v1', requestId),
      };
    const request = requestResult.value;
    const previous = this.idempotency.get(request.idempotency_key);
    if (previous && previous.contentHash !== request.document.content_sha256)
      return {
        status: 409,
        body: createParseError(
          'INVALID_REQUEST',
          'idempotency_key 已绑定其他 document 内容',
          request.request_id,
        ),
      };
    if (previous) return previous.result;

    const parsed = parseText(request);
    if ('code' in parsed) {
      const result: MockResult = {
        status: 422,
        body: createParseError('PARSER_REJECTED', parsed.message, request.request_id),
      };
      this.idempotency.set(request.idempotency_key, {
        contentHash: request.document.content_sha256,
        result,
      });
      return result;
    }
    const aligned = validateTextParseResponseAgainstText(parsed, request.document.text);
    if (!aligned.ok)
      return {
        status: 500,
        body: createParseError(
          'PARSER_RESPONSE_INVALID',
          'rule parser response failed evidence alignment validation',
          request.request_id,
        ),
      };
    const result: MockResult = { status: 200, body: aligned.value };
    this.idempotency.set(request.idempotency_key, {
      contentHash: request.document.content_sha256,
      result,
    });
    return result;
  }
}

export function requestForRuleParserBridge(text: string): TextParseRequest {
  const contentSha256 = createHash('sha256').update(text, 'utf8').digest('hex');
  return {
    schema_version: 'text-parse-request/v1',
    request_id: 'm2-voice-parser-bridge',
    idempotency_key: 'm2-voice-parser-bridge',
    protocol_version: '1.0.0',
    document: {
      document_id: 'm2-voice-parser-bridge-doc',
      content_type: 'text/plain',
      text,
      content_sha256: contentSha256,
      language: 'zh-CN',
      timezone: 'Asia/Shanghai',
    },
    user_profile: { education_level: '本科生' },
    execution_context: {
      environment: 'demo',
      deadline_ms: 5000,
      requested_at: '2026-09-16T10:00:00+08:00',
    },
  };
}
