import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  createApiError,
  protocolVersion,
  validateTextParseRequest,
} from '@campus-action-os/protocol';
import { parseText, type ParserFailure } from './rule-parser.js';

const port = Number(process.env.AI_PORT ?? 3001);

function requestIdFor(request: IncomingMessage): string {
  const value = request.headers['x-request-id']?.toString().trim();
  return value && value.length <= 200 ? value : randomUUID();
}

function send(response: ServerResponse, status: number, body: unknown, requestId: string): void {
  response.setHeader('x-request-id', requestId);
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.writeHead(status).end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    length += buffer.length;
    if (length > 1_100_000) throw new Error('body too large');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function failureStatus(failure: ParserFailure): number {
  return failure.code === 'UNSUPPORTED_CONTENT_TYPE' ? 415 : 400;
}

export function createParserServer(): Server {
  return createServer(async (request, response) => {
    let requestId = requestIdFor(request);
    try {
      if (request.url === '/health' && request.method === 'GET') {
        send(
          response,
          200,
          {
            status: 'ok',
            service: 'ai-parser',
            configured: true,
            parser: 'rule-based',
            protocolVersion,
          },
          requestId,
        );
        return;
      }
      if (request.url === '/v1/parse' && request.method === 'POST') {
        const input = await readJson(request);
        const valid = validateTextParseRequest(input);
        if (!valid.ok) {
          send(
            response,
            400,
            createApiError('INVALID_REQUEST', '请求不符合 text-parse-request/v1', requestId),
            requestId,
          );
          return;
        }
        const suppliedRequestId = request.headers['x-request-id']?.toString().trim();
        if (suppliedRequestId && suppliedRequestId !== valid.value.request_id) {
          send(
            response,
            400,
            createApiError('INVALID_REQUEST', 'request_id must match x-request-id', requestId),
            requestId,
          );
          return;
        }
        if (!suppliedRequestId) requestId = valid.value.request_id;
        const parsed = parseText(valid.value);
        if ('code' in parsed) {
          send(
            response,
            failureStatus(parsed),
            createApiError(parsed.code, parsed.message, requestId),
            requestId,
          );
          return;
        }
        send(response, 200, parsed, requestId);
        return;
      }
      send(response, 404, createApiError('NOT_FOUND', 'Route not found', requestId), requestId);
    } catch (error) {
      const tooLarge = error instanceof Error && error.message === 'body too large';
      send(
        response,
        tooLarge ? 413 : 400,
        createApiError(
          tooLarge ? 'TEXT_TOO_LARGE' : 'INVALID_REQUEST',
          tooLarge ? 'Request body too large' : 'Invalid JSON request',
          requestId,
        ),
        requestId,
      );
    }
  });
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('services/ai-parser/src/server.ts')) {
  createParserServer().listen(port, () => console.log(`AI parser listening on ${port}`));
}
