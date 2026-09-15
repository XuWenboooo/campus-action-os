import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  ExternalProvider,
  FallbackPolicy,
  RuleBasedProvider,
  type ParserProvider,
  type ProviderFailure,
  type SafeProviderLog,
} from '../../services/ai-parser/src/parser-provider.js';
import type { TextParseRequest } from '@campus-action-os/protocol';

function request(): TextParseRequest {
  const text = '适用对象：本科生\n1. 提交材料\n截止：2099-10-03 前';
  return {
    schema_version: 'text-parse-request/v1',
    request_id: 'phase2-provider-request',
    idempotency_key: 'phase2-provider-idempotency',
    protocol_version: '1.0.0',
    document: {
      document_id: 'phase2-provider-document',
      content_type: 'text/plain',
      text,
      content_sha256: createHash('sha256').update(text).digest('hex'),
      language: 'zh-CN',
      timezone: 'Asia/Shanghai',
    },
    user_profile: { education_level: '本科生' },
    execution_context: {
      environment: 'test',
      deadline_ms: 5000,
      requested_at: '2099-01-01T00:00:00.000Z',
    },
  };
}

function responseFor(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('ExternalProvider validates output, forwards requestId, and safely logs without source text', async () => {
  const input = request();
  const expected = await new RuleBasedProvider().parse(input);
  assert.equal('code' in expected, false);
  const logs: SafeProviderLog[] = [];
  let attempts = 0;
  let receivedRequestId = '';
  const provider = new ExternalProvider({
    endpoint: 'http://synthetic-provider.invalid',
    maxRetries: 1,
    backoffMs: () => 0,
    log: (event) => logs.push(event),
    fetchImpl: async (_input, init) => {
      attempts += 1;
      receivedRequestId = new Headers(init?.headers).get('x-request-id') ?? '';
      if (attempts === 1) return responseFor({}, 429);
      return responseFor(expected);
    },
  });
  const result = await provider.parse(input);
  assert.equal('code' in result, false);
  assert.equal(attempts, 2);
  assert.equal(receivedRequestId, input.request_id);
  assert.ok(logs.some((event) => event.event === 'retry'));
  assert.ok(!JSON.stringify(logs).includes(input.document.text));
});

test('ExternalProvider rejects malformed and schema-invalid responses without fabricated success', async () => {
  const input = request();
  const malformed = new ExternalProvider({
    endpoint: 'http://synthetic-malformed.invalid',
    maxRetries: 0,
    fetchImpl: async () => new Response('not-json', { status: 200 }),
  });
  const malformedResult = await malformed.parse(input);
  assert.equal('code' in malformedResult, true);
  if ('code' in malformedResult) assert.equal(malformedResult.code, 'PARSER_RESPONSE_INVALID');

  const invalid = new ExternalProvider({
    endpoint: 'http://synthetic-invalid.invalid',
    maxRetries: 0,
    fetchImpl: async () => responseFor({ schema_version: 'wrong' }),
  });
  const invalidResult = await invalid.parse(input);
  assert.equal('code' in invalidResult, true);
  if ('code' in invalidResult) assert.equal(invalidResult.code, 'PARSER_RESPONSE_INVALID');
});

test('ExternalProvider handles timeout, cancellation, and unavailable provider paths', async () => {
  const input = request();
  const timeout = new ExternalProvider({
    endpoint: 'http://synthetic-timeout.invalid',
    timeoutMs: 10,
    maxRetries: 0,
    fetchImpl: async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
  });
  const timeoutResult = await timeout.parse(input);
  assert.equal('code' in timeoutResult, true);
  if ('code' in timeoutResult) assert.equal(timeoutResult.code, 'PARSER_TIMEOUT');

  const unavailable = new ExternalProvider({
    endpoint: 'http://synthetic-unavailable.invalid',
    maxRetries: 1,
    backoffMs: () => 0,
    fetchImpl: async () => {
      throw new Error('synthetic network outage');
    },
  });
  const unavailableResult = await unavailable.parse(input);
  assert.equal('code' in unavailableResult, true);
  if ('code' in unavailableResult) assert.equal(unavailableResult.code, 'PARSER_UNAVAILABLE');

  const controller = new AbortController();
  const cancellation = new ExternalProvider({
    endpoint: 'http://synthetic-cancel.invalid',
    timeoutMs: 1000,
    maxRetries: 0,
    fetchImpl: async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
  });
  const cancellationPromise = cancellation.parse(input, controller.signal);
  setImmediate(() => controller.abort());
  const cancellationResult = await cancellationPromise;
  assert.equal('code' in cancellationResult, true);
  if ('code' in cancellationResult) assert.equal(cancellationResult.code, 'PARSER_CANCELLED');
});

test('FallbackPolicy only falls back for configured infrastructure failures', async () => {
  const input = request();
  const failure: ProviderFailure = {
    code: 'PARSER_TIMEOUT',
    message: 'synthetic timeout',
    retryable: true,
  };
  const primary: ParserProvider = {
    name: 'synthetic-primary',
    async parse() {
      return failure;
    },
  };
  const fallback = new FallbackPolicy({
    primary,
    fallback: new RuleBasedProvider(),
  });
  const result = await fallback.parse(input);
  assert.equal('code' in result, false);
  if (!('code' in result))
    assert.equal(result.parser_metadata.model_provider, 'deterministic-rule-engine');

  const malformedPrimary: ParserProvider = {
    name: 'synthetic-malformed-primary',
    async parse() {
      return {
        code: 'PARSER_RESPONSE_INVALID' as const,
        message: 'synthetic malformed response',
        retryable: false,
      };
    },
  };
  const noFallback = new FallbackPolicy({
    primary: malformedPrimary,
    fallback: new RuleBasedProvider(),
  });
  const rejected = await noFallback.parse(input);
  assert.equal('code' in rejected, true);
  if ('code' in rejected) assert.equal(rejected.code, 'PARSER_RESPONSE_INVALID');
});
