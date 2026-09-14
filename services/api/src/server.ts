import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createApiError, protocolVersion } from '@campus-action-os/protocol';

const port = Number(process.env.API_PORT ?? 3000);
const server = createServer((request, response) => {
  const requestId = request.headers['x-request-id']?.toString() || randomUUID();
  response.setHeader('x-request-id', requestId);
  response.setHeader('content-type', 'application/json; charset=utf-8');
  if (request.url === '/health' && request.method === 'GET') {
    response.writeHead(200).end(JSON.stringify({ status: 'ok', service: 'api' }));
    return;
  }
  if (request.url === '/v1/capabilities' && request.method === 'GET') {
    response
      .writeHead(200)
      .end(JSON.stringify({ service: 'api', protocolVersion, parsing: 'not-configured' }));
    return;
  }
  response
    .writeHead(404)
    .end(JSON.stringify(createApiError('NOT_FOUND', 'Route not found', requestId)));
});

server.listen(port, () => console.log(`API listening on ${port}`));
