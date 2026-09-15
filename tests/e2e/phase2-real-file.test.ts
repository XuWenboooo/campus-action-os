import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createParserServer } from '../../services/ai-parser/src/server.js';
import { LocalRapidOcrProvider } from '../../services/ai-parser/src/ocr.js';
import { createApiServer } from '../../services/api/src/server.js';
import { Repository } from '../../services/api/src/repository.js';

const execFile = promisify(execFileCallback);
const fixtureScript = join(process.cwd(), 'tools', 'create-phase2-synthetic-fixtures.py');

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

async function createFixtures(): Promise<{ directory: string; cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), 'campus-action-os-phase2-e2e-'));
  await execFile(process.env.PHASE2_PYTHON_BIN ?? process.env.PYTHON_BIN ?? 'python', [
    '-X',
    'utf8',
    fixtureScript,
    directory,
  ]);
  return { directory, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

test('real files run upload → extract/OCR → parse → evidence → confirm → task', async () => {
  const { directory, cleanup } = await createFixtures();
  const ai = createParserServer();
  const aiUrl = await listen(ai);
  const repository = new Repository(':memory:');
  const api = createApiServer({
    repository,
    parserUrl: aiUrl,
    ocrProvider: new LocalRapidOcrProvider({ timeoutMs: 30_000 }),
  });
  const apiUrl = await listen(api.server);
  const headers = { 'content-type': 'application/json', 'x-dev-user-id': 'synthetic-phase2-user' };
  const call = async (method: string, path: string, body: unknown, key: string) => {
    const response = await fetch(`${apiUrl}${path}`, {
      method,
      headers: { ...headers, 'idempotency-key': key },
      body: JSON.stringify(body),
    });
    return { response, body: response.status === 204 ? null : await response.json() };
  };
  try {
    const profile = await call(
      'PATCH',
      '/users/me/profile',
      { education_level: '本科生' },
      'phase2-profile-1',
    );
    assert.equal(profile.response.status, 200);

    const scanBytes = await readFile(join(directory, 'scanned.pdf'));
    const uploaded = await call(
      'POST',
      '/documents/upload',
      {
        title: '合成扫描 PDF 通知',
        contentType: 'application/pdf',
        content_base64: scanBytes.toString('base64'),
        data_origin: 'synthetic',
      },
      'phase2-scanned-upload-1',
    );
    assert.equal(uploaded.response.status, 201);
    const documentId = uploaded.body.document.document_id as string;

    const parsed = await call(
      'POST',
      `/documents/${documentId}/parse`,
      {},
      'phase2-scanned-parse-1',
    );
    assert.equal(parsed.response.status, 202);
    assert.equal(parsed.body.status, 'succeeded');
    const action = parsed.body.result.verified_actions[0];
    assert.ok(action);
    assert.match(action.title, /提交材料/);
    assert.ok(
      action.evidence.some((item: { field_name: string }) => item.field_name === 'deadline'),
    );
    assert.ok(
      action.evidence.every((item: { source_text: string }) => item.source_text.length > 0),
    );

    const confirmed = await call(
      'POST',
      `/actions/${action.action_id}/confirm`,
      { confirmed: true },
      'phase2-confirm-1',
    );
    assert.equal(confirmed.response.status, 200);
    const task = await call('POST', '/tasks', { actionId: action.action_id }, 'phase2-task-1');
    assert.equal(task.response.status, 201);
    assert.equal(task.body.task.status, 'pending');
    assert.equal(task.body.task.document_id, documentId);

    const jpegBytes = await readFile(join(directory, 'synthetic-screenshot.jpg'));
    const jpeg = await call(
      'POST',
      '/documents/upload',
      {
        title: '合成 JPEG 截图通知',
        contentType: 'image/jpeg',
        content_base64: jpegBytes.toString('base64'),
        data_origin: 'synthetic',
      },
      'phase2-jpeg-upload-1',
    );
    assert.equal(jpeg.response.status, 201);
    assert.equal(jpeg.body.document.content_type, 'image/jpeg');
  } finally {
    await close(api.server);
    await close(ai);
    repository.close();
    await cleanup();
  }
});

test('real malformed/empty/corrupted files and unavailable OCR remain explicit failures', async () => {
  const { directory, cleanup } = await createFixtures();
  const ai = createParserServer();
  const aiUrl = await listen(ai);
  const repository = new Repository(':memory:');
  const api = createApiServer({ repository, parserUrl: aiUrl });
  const apiUrl = await listen(api.server);
  const headers = {
    'content-type': 'application/json',
    'x-dev-user-id': 'synthetic-phase2-failure-user',
  };
  const call = async (method: string, path: string, body: unknown, key: string) => {
    const response = await fetch(`${apiUrl}${path}`, {
      method,
      headers: { ...headers, 'idempotency-key': key },
      body: JSON.stringify(body),
    });
    return { response, body: response.status === 204 ? null : await response.json() };
  };
  const uploadAndParse = async (filename: string, contentType: string, key: string) => {
    const bytes = await readFile(join(directory, filename));
    const uploaded = await call(
      'POST',
      '/documents/upload',
      {
        title: `合成失败样本 ${filename}`,
        contentType,
        content_base64: bytes.toString('base64'),
        data_origin: 'synthetic',
      },
      `${key}-upload`,
    );
    assert.equal(uploaded.response.status, 201);
    return call(
      'POST',
      `/documents/${uploaded.body.document.document_id}/parse`,
      {},
      `${key}-parse`,
    );
  };
  try {
    const malformed = await uploadAndParse('malformed.pdf', 'application/pdf', 'phase2-malformed');
    assert.equal(malformed.response.status, 202);
    assert.equal(malformed.body.status, 'failed');
    assert.equal(malformed.body.error.code, 'MALFORMED_FILE');

    const emptyUpload = await call(
      'POST',
      '/documents/upload',
      {
        title: '合成空文件',
        contentType: 'application/pdf',
        content_base64: (await readFile(join(directory, 'empty.pdf'))).toString('base64'),
        data_origin: 'synthetic',
      },
      'phase2-empty-upload',
    );
    assert.equal(emptyUpload.response.status, 400);
    assert.equal(emptyUpload.body.error.code, 'EMPTY_FILE');

    const corrupted = await call(
      'POST',
      '/documents/upload',
      {
        title: '合成损坏 PNG',
        contentType: 'image/png',
        content_base64: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]).toString('base64'),
        data_origin: 'synthetic',
      },
      'phase2-corrupted-upload',
    );
    assert.equal(corrupted.response.status, 201);
    const corruptedParse = await call(
      'POST',
      `/documents/${corrupted.body.document.document_id}/parse`,
      {},
      'phase2-corrupted-parse',
    );
    assert.equal(corruptedParse.body.status, 'failed');
    assert.equal(corruptedParse.body.error.code, 'MALFORMED_FILE');

    const unavailable = await uploadAndParse(
      'synthetic-screenshot.png',
      'image/png',
      'phase2-ocr-unavailable',
    );
    assert.equal(unavailable.body.status, 'failed');
    assert.equal(unavailable.body.error.code, 'OCR_NOT_CONFIGURED');

    const unsupported = await call(
      'POST',
      '/documents/upload',
      {
        title: '合成不支持类型',
        contentType: 'image/gif',
        content_base64: Buffer.from('synthetic').toString('base64'),
        data_origin: 'synthetic',
      },
      'phase2-unsupported-upload',
    );
    assert.equal(unsupported.response.status, 415);
    assert.equal(unsupported.body.error.code, 'UNSUPPORTED_CONTENT_TYPE');
  } finally {
    await close(api.server);
    await close(ai);
    repository.close();
    await cleanup();
  }
});
