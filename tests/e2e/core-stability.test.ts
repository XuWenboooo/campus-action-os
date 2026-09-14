import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createParserServer } from '../../services/ai-parser/src/server.js';
import { createApiServer } from '../../services/api/src/server.js';
import { Repository } from '../../services/api/src/repository.js';

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: { close(callback: (error?: Error) => void): void }): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

test('synthetic core API/AI/SQLite loop survives 100 consecutive runs', async () => {
  const ai = createParserServer();
  const aiUrl = await listen(ai);
  const repository = new Repository(':memory:');
  const api = createApiServer({ repository, parserUrl: aiUrl });
  const apiUrl = await listen(api.server);
  const headers = { 'content-type': 'application/json', 'x-dev-user-id': 'synthetic-stability' };
  const call = async (method: string, path: string, body: unknown, key: string) => {
    const result = await fetch(`${apiUrl}${path}`, {
      method,
      headers: { ...headers, 'idempotency-key': key },
      body: JSON.stringify(body),
    });
    const parsed = await result.json();
    return { result, parsed };
  };

  try {
    for (let index = 0; index < 100; index += 1) {
      const text = `【合成稳定性通知 ${index}】\n适用对象：本科生\n1. 完成第${index}项登记\n截止：2099-10-01 前`;
      const document = await call(
        'POST',
        '/documents',
        { title: `合成稳定性通知 ${index}`, text, data_origin: 'synthetic' },
        `stability-document-${index}`,
      );
      assert.equal(document.result.status, 201);
      const documentId = document.parsed.document.document_id as string;
      const parsed = await call(
        'POST',
        `/documents/${documentId}/parse`,
        {},
        `stability-parse-${index}`,
      );
      assert.equal(parsed.result.status, 202, `run ${index}: ${JSON.stringify(parsed.parsed)}`);
      assert.ok(['succeeded', 'needs_confirmation'].includes(parsed.parsed.status));
      const actionId = parsed.parsed.result.verified_actions[0].action_id as string;
      const confirmed = await call(
        'POST',
        `/actions/${actionId}/confirm`,
        { confirmed: true },
        `stability-confirm-${index}`,
      );
      assert.equal(confirmed.result.status, 200);
      const task = await call('POST', '/tasks', { actionId }, `stability-task-${index}`);
      assert.equal(task.result.status, 201, JSON.stringify(task.parsed));
      const taskId = task.parsed.task.task_id as string;
      const started = await call(
        'PATCH',
        `/tasks/${taskId}`,
        { status: 'in_progress' },
        `stability-start-${index}`,
      );
      assert.equal(started.result.status, 200);
      const completed = await call(
        'POST',
        `/tasks/${taskId}/complete`,
        { confirmed: true },
        `stability-complete-${index}`,
      );
      assert.equal(completed.result.status, 200);
      assert.equal(completed.parsed.task.status, 'completed');
    }
    assert.equal(
      (repository.db.prepare('SELECT count(*) AS count FROM tasks').get() as { count: number })
        .count,
      100,
    );
  } finally {
    await close(api.server);
    await close(ai);
    repository.close();
  }
});
