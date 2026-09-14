import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createParserServer } from '../../services/ai-parser/src/server.js';

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

function request(requestId = 'ai-server-request'): Record<string, unknown> {
  const text = '适用对象：本科生\n1. 提交材料\n截止：2099-10-03 17:00 前';
  return {
    schema_version: 'text-parse-request/v1',
    request_id: requestId,
    idempotency_key: 'ai-server-test-1',
    protocol_version: '1.0.0',
    document: {
      document_id: 'ai-server-document',
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

test('AI parser rejects a request_id/header mismatch with a unified error', async () => {
  const server = createParserServer();
  const url = await listen(server);
  try {
    const response = await fetch(`${url}/v1/parse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': 'header-request' },
      body: JSON.stringify(request('body-request')),
    });
    const body = (await response.json()) as { error: { code: string; requestId: string } };
    assert.equal(response.status, 400);
    assert.equal(body.error.code, 'INVALID_REQUEST');
    assert.equal(body.error.requestId, 'header-request');
    assert.equal(response.headers.get('x-request-id'), 'header-request');
  } finally {
    await close(server);
  }
});

test('AI parser uses the body request_id when no request header is supplied', async () => {
  const server = createParserServer();
  const url = await listen(server);
  try {
    const response = await fetch(`${url}/v1/parse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request('body-request-no-header')),
    });
    const body = (await response.json()) as { request_id: string };
    assert.equal(response.status, 200);
    assert.equal(body.request_id, 'body-request-no-header');
    assert.equal(response.headers.get('x-request-id'), 'body-request-no-header');
  } finally {
    await close(server);
  }
});
