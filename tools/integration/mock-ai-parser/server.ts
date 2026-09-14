import { createServer } from 'node:http';
import { createApiError, protocolVersion } from '@campus-action-os/protocol';
import { mockParser } from './mock.js';

const port = Number(process.env.MOCK_AI_PORT ?? 3101);

function readBody(request: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
      if (body.length > 120000) reject(new Error('request body too large'));
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function send(response: import('node:http').ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

createServer(async (request, response) => {
  if (request.url === '/health' && request.method === 'GET') {
    send(response, 200, { status: 'ok', service: 'mock-ai-parser', protocolVersion, development_only: true, synthetic: true, not_model_output: true });
    return;
  }
  if (request.url !== '/internal/v1/parse-text' || request.method !== 'POST') {
    send(response, 404, createApiError('INVALID_REQUEST', '开发 mock 只提供 POST /internal/v1/parse-text', 'unknown'));
    return;
  }
  try {
    const raw = await readBody(request);
    const input = JSON.parse(raw) as unknown;
    const result = mockParser.parse(input);
    response.setHeader('x-request-id', typeof input === 'object' && input !== null && 'request_id' in input ? String((input as { request_id?: unknown }).request_id ?? '') : 'unknown');
    send(response, result.status, result.body);
  } catch {
    send(response, 400, createApiError('INVALID_REQUEST', '请求不是合法 JSON', 'unknown'));
  }
}).listen(port, () => console.log(`Development-only mock AI parser listening on ${port}`));
