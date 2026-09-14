import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createParseError,
  isRetryableParseError,
  loadSchema,
  validateDocumentAssessment,
  validateTextParseExchange,
  validateTextParseRequest,
  validateTextParseResponse,
} from '@campus-action-os/protocol';
import { fixtures } from '../fixtures/m2-text/catalog.js';
import { DeterministicMockParser } from '../../tools/integration/mock-ai-parser/mock.js';

test('M2 interface schemas are local Draft 2020-12 documents', () => {
  for (const name of [
    'text-parse-request',
    'document-assessment',
    'text-parse-response',
  ] as const) {
    const schema = loadSchema(name) as { $schema?: string; $id?: string };
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.match(schema.$id ?? '', /interfaces\/v1/);
  }
});

test('all fixed fixtures are synthetic development-only data', () => {
  assert.equal(fixtures.length, 12);
  for (const fixture of fixtures) {
    assert.deepEqual(fixture.metadata, {
      development_only: true,
      synthetic: true,
      not_model_output: true,
      scenario: fixture.metadata.scenario,
      expected_validation: fixture.metadata.expected_validation,
    });
    assert.equal(fixture.request.document.content_type, 'text/plain');
    assert.match(fixture.request.document.content_sha256, /^[a-f0-9]{64}$/);
  }
});

test('valid fixture responses pass the exchange validator and invalid cases fail safely', () => {
  for (const fixture of fixtures) {
    if (fixture.expected.kind === 'response') {
      const result = validateTextParseExchange(fixture.request, fixture.expected.response);
      assert.equal(result.ok, true, fixture.id);
    } else if (fixture.expected.unsafe_response !== undefined) {
      const result = validateTextParseResponse(fixture.expected.unsafe_response);
      assert.equal(result.ok, false, fixture.id);
      assert.ok(result.errors.some((error) => error.path.includes('verified_actions')));
    }
  }
});

test('irrelevant assessment and response cannot create a fake action', () => {
  const fixture = fixtures.find((item) => item.id === 'irrelevant-profile');
  assert.ok(fixture && fixture.expected.kind === 'response');
  if (!fixture || fixture.expected.kind !== 'response') return;
  assert.equal(fixture.expected.response.document_assessment.user_relevance, 'irrelevant');
  assert.deepEqual(fixture.expected.response.verified_actions, []);
  assert.equal(fixture.expected.response.action_graph, null);
  assert.equal(validateDocumentAssessment(fixture.expected.response.document_assessment).ok, true);
});

test('request hashes, versions, and privacy boundary are enforced', () => {
  const fixture = fixtures[0];
  const wrongHash = {
    ...fixture.request,
    document: { ...fixture.request.document, content_sha256: '0'.repeat(64) },
  };
  assert.equal(validateTextParseRequest(wrongHash).ok, false);
  const wrongType = {
    ...fixture.request,
    document: { ...fixture.request.document, content_type: 'application/pdf' },
  };
  assert.equal(validateTextParseRequest(wrongType).ok, false);
  const sensitive = {
    ...fixture.request,
    user_profile: { ...fixture.request.user_profile, student_id: 'nope' },
  };
  assert.equal(validateTextParseRequest(sensitive).ok, false);
});

test('deterministic mock covers timeout, unconfigured, invalid response, and idempotency', () => {
  const parser = new DeterministicMockParser();
  for (const fixture of fixtures) {
    const result = parser.parse(fixture.request);
    if (fixture.id === 'invalid-response') {
      assert.equal(result.status, 500);
      assert.equal(
        (result.body as { error: { code: string } }).error.code,
        'PARSER_RESPONSE_INVALID',
      );
    } else if (fixture.expected.kind === 'error') {
      assert.deepEqual(result.body, fixture.expected.error, fixture.id);
    } else {
      assert.equal(result.status, 200, fixture.id);
      assert.deepEqual(result.body, fixture.expected.response, fixture.id);
    }
  }
  const replay = fixtures.find((item) => item.id === 'idempotent-replay');
  const reuse = fixtures.find((item) => item.id === 'idempotency-key-reuse');
  assert.ok(replay && reuse);
  if (!replay || !reuse) return;
  const first = parser.parse(replay.request);
  const second = parser.parse(replay.request);
  assert.deepEqual(second, first);
  const conflict = parser.parse(reuse.request);
  assert.equal(conflict.status, 409);
  assert.equal((conflict.body as { error: { code: string } }).error.code, 'INVALID_REQUEST');
  assert.doesNotMatch(
    readFileSync('tools/integration/mock-ai-parser/mock.ts', 'utf8'),
    /fetch\s*\(/,
  );
});

test('error retry semantics are stable and never confuse rejection with infrastructure failure', () => {
  assert.equal(isRetryableParseError('PARSER_TIMEOUT'), true);
  assert.equal(isRetryableParseError('INTERNAL_ERROR'), true);
  assert.equal(isRetryableParseError('PARSER_REJECTED'), false);
  assert.equal(isRetryableParseError('PARSER_NOT_CONFIGURED'), false);
  assert.deepEqual(createParseError('PARSER_TIMEOUT', 'timeout', 'req-1'), {
    error: { code: 'PARSER_TIMEOUT', message: 'timeout', requestId: 'req-1', retryable: true },
  });
});
