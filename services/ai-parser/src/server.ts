import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createApiError, protocolVersion } from '@campus-action-os/protocol';
const port = Number(process.env.AI_PORT ?? 3001);
createServer((request, response) => {
  const requestId = request.headers['x-request-id']?.toString() || randomUUID();
  response.setHeader('x-request-id', requestId);
  response.setHeader('content-type', 'application/json; charset=utf-8');
  if (request.url === '/health' && request.method === 'GET') {
    response
      .writeHead(200)
      .end(
        JSON.stringify({ status: 'ok', service: 'ai-parser', configured: false, protocolVersion }),
      );
    return;
  }
  response
    .writeHead(501)
    .end(
      JSON.stringify(
        createApiError('PARSER_NOT_CONFIGURED', 'AI parsing is not configured', requestId),
      ),
    );
}).listen(port, () => console.log(`AI parser boundary listening on ${port}`));
