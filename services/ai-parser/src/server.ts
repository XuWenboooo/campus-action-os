import { createServer } from 'node:http';
const port = Number(process.env.AI_PORT ?? 3001);
createServer((request, response) => {
  response.setHeader('content-type', 'application/json; charset=utf-8');
  if (request.url === '/health' && request.method === 'GET') {
    response
      .writeHead(200)
      .end(JSON.stringify({ status: 'ok', service: 'ai-parser', configured: false }));
    return;
  }
  response.writeHead(501).end(
    JSON.stringify({
      error: {
        code: 'PARSER_NOT_CONFIGURED',
        message: 'AI parsing is not configured',
        retryable: false,
      },
    }),
  );
}).listen(port, () => console.log(`AI parser boundary listening on ${port}`));
