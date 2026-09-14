import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createParserServer } from '../../services/ai-parser/src/server.js';
import { createApiServer } from '../../services/api/src/server.js';
import { Repository } from '../../services/api/src/repository.js';
import { parseText } from '../../services/ai-parser/src/rule-parser.js';
import type { TextParseRequest } from '@campus-action-os/protocol';

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

test('API closes the document → parse job → verified action → confirmed task loop over SQLite', async () => {
  const ai = createParserServer();
  const aiUrl = await listen(ai);
  const repository = new Repository(':memory:');
  const api = createApiServer({ repository, parserUrl: aiUrl });
  const apiUrl = await listen(api.server);
  const headers = { 'content-type': 'application/json', 'x-dev-user-id': 'synthetic-student' };
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    extra: Record<string, string> = {},
  ) => {
    const result = await fetch(`${apiUrl}${path}`, {
      method,
      headers: { ...headers, ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const parsed = result.status === 204 ? null : await result.json();
    return { result, parsed };
  };

  try {
    const profileInput = {
      education_level: '本科生',
      grade: '大三',
      college: '虚构学院',
    };
    const profile = await call('PATCH', '/users/me/profile', profileInput, {
      'idempotency-key': 'profile-1',
      'x-request-id': 'profile-request-1',
    });
    assert.equal(profile.result.status, 200);
    assert.equal(profile.result.headers.get('x-request-id'), 'profile-request-1');
    const profileReplay = await call('PATCH', '/users/me/profile', profileInput, {
      'idempotency-key': 'profile-1',
    });
    assert.deepEqual(profileReplay.parsed, profile.parsed);
    const profileConflict = await call(
      'PATCH',
      '/users/me/profile',
      { ...profileInput, grade: '大四' },
      { 'idempotency-key': 'profile-1' },
    );
    assert.equal(profileConflict.result.status, 409);
    assert.equal(profileConflict.parsed.error.code, 'IDEMPOTENCY_CONFLICT');
    assert.equal(
      (
        repository.db
          .prepare(
            "SELECT count(*) AS count FROM audit_events WHERE event_type = 'profile.updated'",
          )
          .get() as { count: number }
      ).count,
      1,
    );
    const invalidOrigin = await call(
      'POST',
      '/documents',
      {
        title: '来源元数据错误',
        text: '适用对象：本科生\n1. 提交材料',
        data_origin: 'fixture',
      },
      { 'idempotency-key': 'invalid-origin-1', 'x-request-id': 'origin-request-1' },
    );
    assert.equal(invalidOrigin.result.status, 400);
    assert.equal(invalidOrigin.parsed.error.code, 'INVALID_REQUEST');
    assert.equal(invalidOrigin.parsed.error.requestId, 'origin-request-1');
    assert.equal(invalidOrigin.result.headers.get('x-request-id'), 'origin-request-1');
    assert.equal(
      (repository.db.prepare('SELECT count(*) AS count FROM documents').get() as { count: number })
        .count,
      0,
    );
    const text =
      '【虚构大学教务处】\n适用对象：本科生\n1. 在线系统提交申请\n2. 到现场核验材料\n截止：2099-10-03 17:00 前\n材料：学生证、成绩单\n地点：A楼101\n平台：https://example.invalid/apply';
    const document = await call(
      'POST',
      '/documents',
      { title: '合成报名通知', text, data_origin: 'synthetic' },
      { 'idempotency-key': 'doc-loop-1' },
    );
    assert.equal(document.result.status, 201);
    assert.equal(document.parsed.document.data_origin, 'synthetic');
    const replay = await call(
      'POST',
      '/documents',
      { title: '合成报名通知', text, data_origin: 'synthetic' },
      { 'idempotency-key': 'doc-loop-1' },
    );
    assert.equal(replay.result.status, 201);
    assert.equal(replay.parsed.document.document_id, document.parsed.document.document_id);
    const idempotencyConflict = await call(
      'POST',
      '/documents',
      { title: '不同请求', text, data_origin: 'synthetic' },
      { 'idempotency-key': 'doc-loop-1' },
    );
    assert.equal(idempotencyConflict.result.status, 409);
    assert.equal(idempotencyConflict.parsed.error.code, 'IDEMPOTENCY_CONFLICT');

    const documentId = document.parsed.document.document_id as string;
    const parsed = await call(
      'POST',
      `/documents/${documentId}/parse`,
      {},
      { 'idempotency-key': 'parse-loop-1' },
    );
    assert.equal(parsed.result.status, 202);
    assert.equal(parsed.parsed.status, 'succeeded');
    assert.equal(parsed.parsed.result.verified_actions.length, 2);
    assert.equal(parsed.parsed.result.action_graph.edges.length, 1);
    assert.equal(
      (
        repository.db.prepare('SELECT count(*) AS count FROM action_steps').get() as {
          count: number;
        }
      ).count,
      2,
    );
    assert.equal(
      (
        repository.db.prepare('SELECT count(*) AS count FROM action_dependencies').get() as {
          count: number;
        }
      ).count,
      0,
    );
    assert.equal(
      (repository.db.prepare('SELECT count(*) AS count FROM deadlines').get() as { count: number })
        .count,
      2,
    );
    assert.equal(
      (repository.db.prepare('SELECT count(*) AS count FROM materials').get() as { count: number })
        .count,
      4,
    );
    const parseConflict = await call(
      'POST',
      `/documents/${documentId}/parse`,
      { rerun: true },
      { 'idempotency-key': 'parse-loop-1' },
    );
    assert.equal(parseConflict.result.status, 409);
    assert.equal(parseConflict.parsed.error.code, 'IDEMPOTENCY_CONFLICT');
    assert.equal(
      (
        repository.db
          .prepare(
            "SELECT count(*) AS count FROM audit_events WHERE event_type = 'parse_job.started'",
          )
          .get() as { count: number }
      ).count,
      1,
    );

    const actions = await call('GET', `/documents/${documentId}/actions`);
    assert.equal(actions.result.status, 200);
    assert.equal(actions.parsed.actions.length, 2);
    const actionId = actions.parsed.actions[0].action_id as string;
    const missingConfirmation = await call(
      'POST',
      `/actions/${actionId}/confirm`,
      {},
      {
        'idempotency-key': 'confirm-missing-1',
      },
    );
    assert.equal(missingConfirmation.result.status, 400);
    assert.equal(missingConfirmation.parsed.error.code, 'CONFIRMATION_REQUIRED');
    const confirmation = await call(
      'POST',
      `/actions/${actionId}/confirm`,
      { confirmed: true },
      { 'idempotency-key': 'confirm-1' },
    );
    assert.equal(confirmation.result.status, 200);
    assert.equal(confirmation.parsed.action.result_stage, 'user_confirmed');
    const confirmationReplay = await call(
      'POST',
      `/actions/${actionId}/confirm`,
      { confirmed: true },
      { 'idempotency-key': 'confirm-1' },
    );
    assert.deepEqual(confirmationReplay.parsed, confirmation.parsed);
    const edited = await call(
      'PATCH',
      `/actions/${actionId}`,
      { title: '用户确认后的申请任务' },
      { 'idempotency-key': 'action-patch-1' },
    );
    assert.equal(edited.result.status, 200);
    assert.equal(edited.parsed.action.title, '用户确认后的申请任务');
    const editedReplay = await call(
      'PATCH',
      `/actions/${actionId}`,
      { title: '用户确认后的申请任务' },
      { 'idempotency-key': 'action-patch-1' },
    );
    assert.deepEqual(editedReplay.parsed, edited.parsed);
    const editedConflict = await call(
      'PATCH',
      `/actions/${actionId}`,
      { title: '同一 key 的不同修改' },
      { 'idempotency-key': 'action-patch-1' },
    );
    assert.equal(editedConflict.result.status, 409);
    assert.equal(editedConflict.parsed.error.code, 'IDEMPOTENCY_CONFLICT');
    assert.equal(
      (
        repository.db
          .prepare('SELECT count(*) AS count FROM action_change_history WHERE action_id = ?')
          .get(actionId) as { count: number }
      ).count,
      3,
    );
    const secondActionId = actions.parsed.actions[1].action_id as string;
    const rejection = await call(
      'POST',
      `/actions/${secondActionId}/reject`,
      { rejected: true },
      { 'idempotency-key': 'reject-1' },
    );
    assert.equal(rejection.result.status, 200);
    assert.equal(rejection.parsed.action.verification_status, 'conflict');
    const rejectedTask = await call(
      'POST',
      '/tasks',
      { actionId: secondActionId },
      { 'idempotency-key': 'task-rejected-1' },
    );
    assert.equal(rejectedTask.result.status, 409);
    assert.equal(rejectedTask.parsed.error.code, 'ACTION_CONFIRMATION_REQUIRED');

    const task = await call('POST', '/tasks', { actionId }, { 'idempotency-key': 'task-loop-1' });
    assert.equal(task.result.status, 201);
    assert.equal(task.parsed.task.status, 'pending');
    const customDueAt = await call(
      'PATCH',
      `/tasks/${task.parsed.task.task_id}`,
      { due_at: '2099-10-10' },
      { 'idempotency-key': 'task-custom-due-1' },
    );
    assert.equal(customDueAt.result.status, 200);
    assert.equal(customDueAt.parsed.task.due_at, '2099-10-10');
    const actionEditedAfterTask = await call(
      'PATCH',
      `/actions/${actionId}`,
      { title: '任务标题同步后的版本' },
      { 'idempotency-key': 'action-patch-after-task-1' },
    );
    assert.equal(actionEditedAfterTask.result.status, 200);
    const syncedTask = await call('GET', `/tasks/${task.parsed.task.task_id}`);
    assert.equal(syncedTask.result.status, 200);
    assert.equal(syncedTask.parsed.task.title, '任务标题同步后的版本');
    assert.equal(syncedTask.parsed.task.due_at, '2099-10-10');
    const invalidTaskPatch = await call(
      'PATCH',
      `/tasks/${task.parsed.task.task_id}`,
      { status: 'not-a-status' },
      { 'idempotency-key': 'task-patch-invalid-1' },
    );
    assert.equal(invalidTaskPatch.result.status, 400);
    assert.equal(invalidTaskPatch.parsed.error.code, 'INVALID_REQUEST');
    const started = await call(
      'PATCH',
      `/tasks/${task.parsed.task.task_id}`,
      { status: 'in_progress' },
      { 'idempotency-key': 'task-patch-1' },
    );
    assert.equal(started.result.status, 200);
    const startedReplay = await call(
      'PATCH',
      `/tasks/${task.parsed.task.task_id}`,
      { status: 'in_progress' },
      { 'idempotency-key': 'task-patch-1' },
    );
    assert.deepEqual(startedReplay.parsed, started.parsed);
    const missingCompleteConfirmation = await call(
      'POST',
      `/tasks/${task.parsed.task.task_id}/complete`,
      {},
      { 'idempotency-key': 'complete-missing-1' },
    );
    assert.equal(missingCompleteConfirmation.result.status, 400);
    assert.equal(missingCompleteConfirmation.parsed.error.code, 'CONFIRMATION_REQUIRED');
    const completed = await call(
      'POST',
      `/tasks/${task.parsed.task.task_id}/complete`,
      { confirmed: true },
      { 'idempotency-key': 'complete-1' },
    );
    assert.equal(completed.result.status, 200);
    assert.equal(completed.parsed.task.status, 'completed');
    const completedReplay = await call(
      'POST',
      `/tasks/${task.parsed.task.task_id}/complete`,
      { confirmed: true },
      { 'idempotency-key': 'complete-1' },
    );
    assert.equal(completedReplay.result.status, 200);
    assert.deepEqual(completedReplay.parsed, completed.parsed);
    const actionAfterComplete = await call('GET', `/actions/${actionId}`);
    assert.equal(actionAfterComplete.parsed.action.task_status, 'completed');
    const rejectCompleted = await call(
      'POST',
      `/actions/${actionId}/reject`,
      { rejected: true },
      { 'idempotency-key': 'reject-completed-action-1' },
    );
    assert.equal(rejectCompleted.result.status, 409);
    assert.equal(rejectCompleted.parsed.error.code, 'INVALID_STATE_TRANSITION');
    const illegal = await call(
      'PATCH',
      `/tasks/${task.parsed.task.task_id}`,
      { status: 'pending' },
      { 'idempotency-key': 'task-patch-illegal-1' },
    );
    assert.equal(illegal.result.status, 409);
    assert.equal(illegal.parsed.error.code, 'INVALID_STATE_TRANSITION');
    const unknown = await call('GET', '/does-not-exist', undefined, {
      'x-request-id': 'client-request-1',
    });
    assert.equal(unknown.result.status, 404);
    assert.equal(unknown.result.headers.get('x-request-id'), 'client-request-1');
    assert.equal(unknown.parsed.error.requestId, 'client-request-1');
    const deleteMissingConfirmation = await call('DELETE', `/documents/${documentId}`, undefined, {
      'idempotency-key': 'document-delete-missing-1',
    });
    assert.equal(deleteMissingConfirmation.result.status, 400);
    assert.equal(deleteMissingConfirmation.parsed.error.code, 'CONFIRMATION_REQUIRED');
    const deleted = await call(
      'DELETE',
      `/documents/${documentId}`,
      { confirmed: true },
      { 'idempotency-key': 'document-delete-1' },
    );
    assert.equal(deleted.result.status, 204);
    const deletedReplay = await call(
      'DELETE',
      `/documents/${documentId}`,
      { confirmed: true },
      { 'idempotency-key': 'document-delete-1' },
    );
    assert.equal(deletedReplay.result.status, 204);
    const deletedConflict = await call(
      'DELETE',
      `/documents/${documentId}`,
      { confirmed: true, reason: 'different request' },
      { 'idempotency-key': 'document-delete-1' },
    );
    assert.equal(deletedConflict.result.status, 409);
    assert.equal(deletedConflict.parsed.error.code, 'IDEMPOTENCY_CONFLICT');
    const deletedRead = await call('GET', `/documents/${documentId}`);
    assert.equal(deletedRead.result.status, 404);
  } finally {
    await close(api.server);
    await close(ai);
    repository.close();
  }
});

test('API persists parser outage as a failed ParseJob instead of a fake success', async () => {
  const repository = new Repository(':memory:');
  const api = createApiServer({ repository, parserUrl: 'http://127.0.0.1:1' });
  const url = await listen(api.server);
  const headers = { 'content-type': 'application/json', 'x-dev-user-id': 'outage-student' };
  try {
    const documentResponse = await fetch(`${url}/documents`, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': 'outage-doc-1' },
      body: JSON.stringify({ text: '适用对象：本科生\n1. 提交材料', data_origin: 'synthetic' }),
    });
    const documentBody = await documentResponse.json();
    const parseResponse = await fetch(
      `${url}/documents/${documentBody.document.document_id}/parse`,
      { method: 'POST', headers: { ...headers, 'idempotency-key': 'outage-parse-1' }, body: '{}' },
    );
    const parseBody = await parseResponse.json();
    assert.equal(parseResponse.status, 202);
    assert.equal(parseBody.status, 'failed');
    assert.equal(parseBody.error.code, 'PARSER_NOT_CONFIGURED');
  } finally {
    await close(api.server);
    repository.close();
  }
});

test('API persists a protocol-level parser rejection with both result and error', async () => {
  const rejectedParser = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += String(chunk);
    const input = JSON.parse(raw) as { request_id: string; document: { document_id: string } };
    const timestamp = '2099-01-01T00:00:00.000Z';
    response.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        schema_version: 'text-parse-response/v1',
        request_id: input.request_id,
        document_id: input.document.document_id,
        status: 'rejected',
        document_assessment: {
          schema_version: 'document-assessment/v1',
          document_id: input.document.document_id,
          user_relevance: 'uncertain',
          relevance_reason: '合成 Parser 拒答，需要人工处理',
          evidence: [
            {
              evidence_id: 'rejected-assessment-evidence',
              source_text: '适用对象：本科生',
              field_name: 'other',
            },
          ],
          verification_status: 'user_confirmation_required',
        },
        verified_actions: [],
        action_graph: null,
        warnings: [
          {
            code: 'PARSER_REJECTED',
            message: '合成 Parser 拒绝生成可执行行动',
          },
        ],
        parser_metadata: {
          parser_version: 'synthetic-rejection-test',
          model_provider: 'synthetic-rejection-test',
          model_version: 'test/1.0.0',
          prompt_version: 'test/1.0.0',
          rule_version: 'test/1.0.0',
          ocr_version: 'not_applicable',
          started_at: timestamp,
          completed_at: timestamp,
          latency_ms: 1,
        },
      }),
    );
  });
  const parserUrl = await listen(rejectedParser);
  const repository = new Repository(':memory:');
  const api = createApiServer({ repository, parserUrl });
  const url = await listen(api.server);
  const headers = {
    'content-type': 'application/json',
    'x-dev-user-id': 'rejected-parser-student',
  };
  try {
    const documentResponse = await fetch(`${url}/documents`, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': 'rejected-document-1' },
      body: JSON.stringify({
        title: '合成拒答通知',
        text: '适用对象：本科生\n请人工判断',
        data_origin: 'synthetic',
      }),
    });
    const documentBody = await documentResponse.json();
    const parseResponse = await fetch(
      `${url}/documents/${documentBody.document.document_id}/parse`,
      {
        method: 'POST',
        headers: { ...headers, 'idempotency-key': 'rejected-parse-1' },
        body: '{}',
      },
    );
    const parseBody = await parseResponse.json();
    assert.equal(parseResponse.status, 202);
    assert.equal(parseBody.status, 'failed');
    assert.equal(parseBody.result.status, 'rejected');
    assert.equal(parseBody.error.code, 'PARSER_REJECTED');
    const persisted = repository.getParseJob('rejected-parser-student', parseBody.parse_job_id);
    assert.equal(persisted?.status, 'failed');
    assert.equal(persisted?.result?.status, 'rejected');
    assert.equal(persisted?.error?.code, 'PARSER_REJECTED');
  } finally {
    await close(api.server);
    await close(rejectedParser);
    repository.close();
  }
});

test('API rejects structurally valid parser evidence that is absent from source text', async () => {
  const tamperedParser = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += String(chunk);
    const input = JSON.parse(raw) as TextParseRequest;
    const parsed = parseText(input);
    if ('code' in parsed) {
      response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify(parsed));
      return;
    }
    const action = parsed.verified_actions[0];
    const tampered = {
      ...parsed,
      verified_actions: [
        {
          ...action,
          evidence: action.evidence.map((item, index) =>
            index === 0 ? { ...item, source_text: '原文不存在的证据' } : item,
          ),
        },
        ...parsed.verified_actions.slice(1),
      ],
    };
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(tampered));
  });
  const parserUrl = await listen(tamperedParser);
  const repository = new Repository(':memory:');
  const api = createApiServer({ repository, parserUrl });
  const url = await listen(api.server);
  const headers = { 'content-type': 'application/json', 'x-dev-user-id': 'alignment-student' };
  try {
    const documentResponse = await fetch(`${url}/documents`, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': 'alignment-document-1' },
      body: JSON.stringify({
        title: '证据对齐通知',
        text: '适用对象：本科生\n1. 提交申请\n截止：2099-10-03 17:00 前',
        data_origin: 'synthetic',
      }),
    });
    const documentBody = await documentResponse.json();
    const parseResponse = await fetch(
      `${url}/documents/${documentBody.document.document_id}/parse`,
      {
        method: 'POST',
        headers: { ...headers, 'idempotency-key': 'alignment-parse-1' },
        body: '{}',
      },
    );
    const parseBody = await parseResponse.json();
    assert.equal(parseResponse.status, 202);
    assert.equal(parseBody.status, 'failed');
    assert.equal(parseBody.error.code, 'PARSER_RESPONSE_INVALID');
    assert.equal(
      repository.listActions('alignment-student', documentBody.document.document_id).length,
      0,
    );
  } finally {
    await close(api.server);
    await close(tamperedParser);
    repository.close();
  }
});

test('API cancels an active task when its linked action is rejected', async () => {
  const ai = createParserServer();
  const aiUrl = await listen(ai);
  const repository = new Repository(':memory:');
  const api = createApiServer({ repository, parserUrl: aiUrl });
  const url = await listen(api.server);
  const headers = { 'content-type': 'application/json', 'x-dev-user-id': 'reject-linked-student' };
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    extra: Record<string, string> = {},
  ) => {
    const result = await fetch(`${url}${path}`, {
      method,
      headers: { ...headers, ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { result, body: result.status === 204 ? null : await result.json() };
  };
  try {
    const document = await call(
      'POST',
      '/documents',
      {
        title: '关联拒绝合成通知',
        text: '适用对象：本科生\n1. 完成登记\n截止：2099-10-04 前',
        data_origin: 'synthetic',
      },
      { 'idempotency-key': 'reject-linked-document-1' },
    );
    const parsed = await call(
      'POST',
      `/documents/${document.body.document.document_id}/parse`,
      {},
      { 'idempotency-key': 'reject-linked-parse-1' },
    );
    const actionId = parsed.body.result.verified_actions[0].action_id as string;
    await call(
      'POST',
      `/actions/${actionId}/confirm`,
      { confirmed: true },
      { 'idempotency-key': 'reject-linked-confirm-1' },
    );
    const task = await call(
      'POST',
      '/tasks',
      { actionId },
      { 'idempotency-key': 'reject-linked-task-1' },
    );
    const rejected = await call(
      'POST',
      `/actions/${actionId}/reject`,
      { rejected: true },
      { 'idempotency-key': 'reject-linked-action-1' },
    );
    assert.equal(rejected.result.status, 200);
    assert.equal(rejected.body.action.verification_status, 'conflict');
    assert.equal(rejected.body.action.task_status, 'cancelled');
    const cancelled = await call('GET', `/tasks/${task.body.task.task_id}`);
    assert.equal(cancelled.result.status, 200);
    assert.equal(cancelled.body.task.status, 'cancelled');
    assert.equal(
      (
        repository.db
          .prepare(
            "SELECT count(*) AS count FROM task_events WHERE task_id = ? AND to_status = 'cancelled'",
          )
          .get(task.body.task.task_id) as { count: number }
      ).count,
      1,
    );
  } finally {
    await close(api.server);
    await close(ai);
    repository.close();
  }
});

test('API retains the source document and creates an explicit manual task after parser failure', async () => {
  const repository = new Repository(':memory:');
  const api = createApiServer({ repository, parserUrl: 'http://127.0.0.1:1' });
  const url = await listen(api.server);
  const headers = {
    'content-type': 'application/json',
    'x-dev-user-id': 'manual-fallback-student',
  };
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    extra: Record<string, string> = {},
  ) => {
    const result = await fetch(`${url}${path}`, {
      method,
      headers: { ...headers, ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { result, body: result.status === 204 ? null : await result.json() };
  };
  try {
    const sourceText = '【合成降级通知】\n适用对象：本科生\n请根据原文自行创建任务。';
    const created = await call(
      'POST',
      '/documents',
      { title: '保留原文的合成通知', text: sourceText, data_origin: 'synthetic' },
      { 'idempotency-key': 'manual-document-1' },
    );
    assert.equal(created.result.status, 201);
    const documentId = created.body.document.document_id as string;
    const failed = await call(
      'POST',
      `/documents/${documentId}/parse`,
      {},
      { 'idempotency-key': 'manual-parse-1' },
    );
    assert.equal(failed.result.status, 202);
    assert.equal(failed.body.status, 'failed');
    assert.equal(failed.body.error.code, 'PARSER_NOT_CONFIGURED');

    const noConfirmation = await call(
      'POST',
      '/tasks/manual',
      { documentId, title: '手动完成登记', due_at: '2099-10-04T12:00:00+08:00' },
      { 'idempotency-key': 'manual-task-1' },
    );
    assert.equal(noConfirmation.result.status, 400);
    assert.equal(noConfirmation.body.error.code, 'CONFIRMATION_REQUIRED');

    const manualInput = {
      documentId,
      title: '手动完成登记',
      due_at: '2099-10-04T12:00:00+08:00',
      confirmed: true,
    };
    const manual = await call('POST', '/tasks/manual', manualInput, {
      'idempotency-key': 'manual-task-1',
      'x-request-id': 'manual-task-request-1',
    });
    assert.equal(manual.result.status, 201);
    assert.equal(manual.result.headers.get('x-request-id'), 'manual-task-request-1');
    assert.equal(manual.body.action.result_stage, 'user_confirmed');
    assert.equal(manual.body.action.verification_status, 'passed');
    assert.equal(manual.body.action.action_type, 'manual_task');
    assert.equal(manual.body.action.evidence[0].page_or_image, 'manual:user-input');
    assert.equal(manual.body.task.status, 'pending');
    assert.equal(manual.body.task.due_at, manualInput.due_at);
    const replay = await call('POST', '/tasks/manual', manualInput, {
      'idempotency-key': 'manual-task-1',
    });
    assert.equal(replay.result.status, 201);
    assert.deepEqual(replay.body, manual.body);
    const conflict = await call(
      'POST',
      '/tasks/manual',
      { ...manualInput, title: '同一 key 的不同人工任务' },
      { 'idempotency-key': 'manual-task-1' },
    );
    assert.equal(conflict.result.status, 409);
    assert.equal(conflict.body.error.code, 'IDEMPOTENCY_CONFLICT');

    const source = await call('GET', `/documents/${documentId}`);
    assert.equal(source.result.status, 200);
    assert.equal(source.body.document.text, sourceText);
    assert.equal(
      (
        repository.db
          .prepare(
            "SELECT count(*) AS count FROM audit_events WHERE event_type = 'manual_task.created'",
          )
          .get() as { count: number }
      ).count,
      1,
    );
    assert.equal(
      (
        repository.db
          .prepare('SELECT count(*) AS count FROM evidence WHERE action_id = ?')
          .get(manual.body.action.action_id) as { count: number }
      ).count,
      1,
    );
    const started = await call(
      'PATCH',
      `/tasks/${manual.body.task.task_id}`,
      { status: 'in_progress' },
      { 'idempotency-key': 'manual-start-1' },
    );
    assert.equal(started.result.status, 200);
    assert.equal(started.body.task.status, 'in_progress');
    const completed = await call(
      'POST',
      `/tasks/${manual.body.task.task_id}/complete`,
      { confirmed: true },
      { 'idempotency-key': 'manual-complete-1' },
    );
    assert.equal(completed.result.status, 200);
    assert.equal(completed.body.task.status, 'completed');
  } finally {
    await close(api.server);
    repository.close();
  }
});

test('API aborts a stalled parser request and persists PARSER_TIMEOUT', async () => {
  const slowParser = createServer((_request, response) => {
    setTimeout(() => response.writeHead(200).end('{}'), 200);
  });
  const slowUrl = await listen(slowParser);
  const repository = new Repository(':memory:');
  const api = createApiServer({ repository, parserUrl: slowUrl, requestTimeoutMs: 20 });
  const url = await listen(api.server);
  const headers = { 'content-type': 'application/json', 'x-dev-user-id': 'timeout-student' };
  try {
    const documentResponse = await fetch(`${url}/documents`, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': 'timeout-doc-1' },
      body: JSON.stringify({ text: '适用对象：本科生\n1. 提交材料', data_origin: 'synthetic' }),
    });
    const documentBody = await documentResponse.json();
    const parseResponse = await fetch(
      `${url}/documents/${documentBody.document.document_id}/parse`,
      {
        method: 'POST',
        headers: { ...headers, 'idempotency-key': 'timeout-parse-1' },
        body: '{}',
      },
    );
    const parseBody = await parseResponse.json();
    assert.equal(parseResponse.status, 202);
    assert.equal(parseBody.status, 'failed');
    assert.equal(parseBody.error.code, 'PARSER_TIMEOUT');
    assert.equal(parseBody.error.retryable, true);
  } finally {
    await close(api.server);
    await close(slowParser);
    repository.close();
  }
});

test('API persists an explicit OCR degradation for image input', async () => {
  const repository = new Repository(':memory:');
  const api = createApiServer({ repository, parserUrl: 'http://127.0.0.1:1' });
  const url = await listen(api.server);
  const headers = {
    'content-type': 'application/json',
    'x-dev-user-id': 'ocr-student',
  };
  try {
    const documentResponse = await fetch(`${url}/documents`, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': 'ocr-doc-1' },
      body: JSON.stringify({
        title: '合成截图通知',
        contentType: 'image/png',
        text: 'binary-placeholder-not-used-as-ocr',
        data_origin: 'synthetic',
      }),
    });
    const documentBody = await documentResponse.json();
    const parseResponse = await fetch(
      `${url}/documents/${documentBody.document.document_id}/parse`,
      {
        method: 'POST',
        headers: { ...headers, 'idempotency-key': 'ocr-parse-1' },
        body: '{}',
      },
    );
    const parseBody = await parseResponse.json();
    assert.equal(parseResponse.status, 202);
    assert.equal(parseBody.status, 'failed');
    assert.equal(parseBody.error.code, 'OCR_NOT_CONFIGURED');
  } finally {
    await close(api.server);
    repository.close();
  }
});

test('API can route a controlled synthetic OCR result through the normal parse loop', async () => {
  const ai = createParserServer();
  const aiUrl = await listen(ai);
  const repository = new Repository(':memory:');
  const api = createApiServer({
    repository,
    parserUrl: aiUrl,
    ocrProvider: {
      name: 'synthetic-ocr-test-only',
      async extract() {
        return {
          status: 'succeeded' as const,
          text: '适用对象：本科生\n1. 上传截图要求的材料\n截止：2099-10-03 17:00 前',
          provider: 'synthetic-ocr-test-only',
          version: 'test/1.0.0',
        };
      },
    },
  });
  const url = await listen(api.server);
  const headers = { 'content-type': 'application/json', 'x-dev-user-id': 'ocr-test-student' };
  try {
    const documentResponse = await fetch(`${url}/documents`, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': 'ocr-success-doc-1' },
      body: JSON.stringify({
        title: '合成 OCR 通知',
        contentType: 'image/png',
        text: 'binary-placeholder-not-used-as-ocr',
        data_origin: 'synthetic',
      }),
    });
    const documentBody = await documentResponse.json();
    const parseResponse = await fetch(
      `${url}/documents/${documentBody.document.document_id}/parse`,
      {
        method: 'POST',
        headers: { ...headers, 'idempotency-key': 'ocr-success-parse-1' },
        body: '{}',
      },
    );
    const parseBody = await parseResponse.json();
    assert.equal(parseResponse.status, 202);
    assert.equal(parseBody.status, 'succeeded');
    assert.equal(parseBody.result.verified_actions[0].title, '上传截图要求的材料');
  } finally {
    await close(api.server);
    await close(ai);
    repository.close();
  }
});

test('API persists binary media uploads and passes source bytes to a controlled OCR provider', async () => {
  const ai = createParserServer();
  const aiUrl = await listen(ai);
  const repository = new Repository(':memory:');
  let receivedContent: Uint8Array | undefined;
  const api = createApiServer({
    repository,
    parserUrl: aiUrl,
    ocrProvider: {
      name: 'synthetic-binary-ocr-test-only',
      async extract(request) {
        receivedContent = request.content;
        return {
          status: 'succeeded' as const,
          text: '适用对象：本科生\n1. 完成截图中的申请\n截止：2099-10-03 17:00 前',
          provider: 'synthetic-binary-ocr-test-only',
          version: 'test/1.0.0',
        };
      },
    },
  });
  const url = await listen(api.server);
  const headers = {
    'content-type': 'application/json',
    'x-dev-user-id': 'binary-upload-student',
  };
  const raw = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  try {
    const missingContent = await fetch(`${url}/documents/upload`, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': 'binary-missing-1' },
      body: JSON.stringify({ contentType: 'image/png', data_origin: 'synthetic' }),
    });
    const missingBody = await missingContent.json();
    assert.equal(missingContent.status, 400);
    assert.equal(missingBody.error.code, 'INVALID_REQUEST');

    const malformedContent = await fetch(`${url}/documents/upload`, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': 'binary-malformed-1' },
      body: JSON.stringify({
        contentType: 'application/pdf',
        content_base64: 'not-canonical-base64',
        data_origin: 'synthetic',
      }),
    });
    const malformedBody = await malformedContent.json();
    assert.equal(malformedContent.status, 400);
    assert.equal(malformedBody.error.code, 'INVALID_REQUEST');

    const mismatchedContent = await fetch(`${url}/documents/upload`, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': 'binary-mismatched-1' },
      body: JSON.stringify({
        contentType: 'application/pdf',
        content_base64: raw.toString('base64'),
        data_origin: 'synthetic',
      }),
    });
    const mismatchedBody = await mismatchedContent.json();
    assert.equal(mismatchedContent.status, 400);
    assert.equal(mismatchedBody.error.code, 'INVALID_REQUEST');

    const uploaded = await fetch(`${url}/documents/upload`, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': 'binary-upload-1' },
      body: JSON.stringify({
        title: '合成截图二进制通知',
        contentType: 'image/png',
        content_base64: raw.toString('base64'),
        data_origin: 'synthetic',
      }),
    });
    const uploadedBody = await uploaded.json();
    assert.equal(uploaded.status, 201);
    assert.equal(uploadedBody.document.text, '');
    const documentId = uploadedBody.document.document_id as string;
    assert.equal(
      repository.getDocumentFile('binary-upload-student', documentId)?.byte_length,
      raw.length,
    );
    assert.deepEqual(
      Buffer.from(repository.getDocumentContent('binary-upload-student', documentId)!),
      raw,
    );

    const parsed = await fetch(`${url}/documents/${documentId}/parse`, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': 'binary-parse-1' },
      body: '{}',
    });
    const parsedBody = await parsed.json();
    assert.equal(parsed.status, 202);
    assert.equal(parsedBody.status, 'succeeded');
    assert.deepEqual(Buffer.from(receivedContent!), raw);
  } finally {
    await close(api.server);
    await close(ai);
    repository.close();
  }
});

test('API normalizes simple HTML before handing it to the text parser', async () => {
  const ai = createParserServer();
  const aiUrl = await listen(ai);
  const repository = new Repository(':memory:');
  const api = createApiServer({ repository, parserUrl: aiUrl });
  const url = await listen(api.server);
  const headers = { 'content-type': 'application/json', 'x-dev-user-id': 'html-student' };
  try {
    const documentResponse = await fetch(`${url}/documents`, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': 'html-doc-1' },
      body: JSON.stringify({
        title: '合成 HTML 通知',
        contentType: 'text/html',
        text: '<p>适用对象：本科生</p><p>1. 提交申请</p><p>截止：2099-10-03 前</p>',
        data_origin: 'synthetic',
      }),
    });
    const documentBody = await documentResponse.json();
    const parseResponse = await fetch(
      `${url}/documents/${documentBody.document.document_id}/parse`,
      {
        method: 'POST',
        headers: { ...headers, 'idempotency-key': 'html-parse-1' },
        body: '{}',
      },
    );
    const parseBody = await parseResponse.json();
    assert.equal(parseResponse.status, 202);
    assert.equal(parseBody.status, 'needs_confirmation');
    assert.equal(parseBody.result.verified_actions[0].deadline.value, '2099-10-03');
  } finally {
    await close(api.server);
    await close(ai);
    repository.close();
  }
});

test('production mode rejects dev login', async () => {
  const repository = new Repository(':memory:');
  const api = createApiServer({ repository, environment: 'production' });
  const url = await listen(api.server);
  try {
    const result = await fetch(`${url}/auth/dev-login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const body = await result.json();
    assert.equal(result.status, 403);
    assert.equal(body.error.code, 'DEV_LOGIN_DISABLED');
    const protectedRoute = await fetch(`${url}/users/me`, { headers: { 'x-dev-user-id': 'fake' } });
    const protectedBody = await protectedRoute.json();
    assert.equal(protectedRoute.status, 503);
    assert.equal(protectedBody.error.code, 'AUTH_NOT_CONFIGURED');
  } finally {
    await close(api.server);
    repository.close();
  }
});

test('publisher notice endpoints retain revision history and all side effects require confirmation', async () => {
  const repository = new Repository(':memory:');
  const api = createApiServer({ repository });
  const url = await listen(api.server);
  const headers = { 'content-type': 'application/json', 'x-dev-user-id': 'synthetic-publisher' };
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    extra: Record<string, string> = {},
  ) => {
    const result = await fetch(`${url}${path}`, {
      method,
      headers: { ...headers, ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { result, body: result.status === 204 ? null : await result.json() };
  };
  try {
    const unauthorized = await call(
      'POST',
      '/notices',
      {
        title: '未授权通知',
        body: '不应创建',
      },
      { 'idempotency-key': 'notice-unauthorized-1' },
    );
    assert.equal(unauthorized.result.status, 403);
    assert.equal(unauthorized.body.error.code, 'FORBIDDEN');
    const login = await call(
      'POST',
      '/auth/dev-login',
      {
        userId: 'synthetic-publisher',
        role: 'publisher',
      },
      { 'idempotency-key': 'publisher-login-1' },
    );
    assert.equal(login.result.status, 200);
    assert.equal(login.body.role, 'publisher');
    const loginReplay = await call(
      'POST',
      '/auth/dev-login',
      { userId: 'synthetic-publisher', role: 'publisher' },
      { 'idempotency-key': 'publisher-login-1' },
    );
    assert.deepEqual(loginReplay.body, login.body);
    assert.equal(
      (
        repository.db
          .prepare(
            "SELECT count(*) AS count FROM audit_events WHERE event_type = 'auth.dev_role_set'",
          )
          .get() as { count: number }
      ).count,
      1,
    );
    const loginConflict = await call(
      'POST',
      '/auth/dev-login',
      { userId: 'synthetic-publisher', role: 'admin' },
      { 'idempotency-key': 'publisher-login-1' },
    );
    assert.equal(loginConflict.result.status, 409);
    assert.equal(loginConflict.body.error.code, 'IDEMPOTENCY_CONFLICT');
    const noticeInput = { title: '合成发布通知', body: '请在 2099-10-01 前完成登记' };
    const created = await call('POST', '/notices', noticeInput, {
      'idempotency-key': 'notice-create-1',
    });
    assert.equal(created.result.status, 201);
    const noticeId = created.body.notice.notice_id as string;
    const noConfirmation = await call(
      'POST',
      `/notices/${noticeId}/publish`,
      {},
      {
        'idempotency-key': 'notice-publish-missing-1',
      },
    );
    assert.equal(noConfirmation.result.status, 400);
    assert.equal(noConfirmation.body.error.code, 'CONFIRMATION_REQUIRED');
    const published = await call(
      'POST',
      `/notices/${noticeId}/publish`,
      { confirmed: true },
      { 'idempotency-key': 'notice-publish-1' },
    );
    assert.equal(published.result.status, 200);
    assert.equal(published.body.revision.status, 'published');
    const revised = await call(
      'POST',
      `/notices/${noticeId}/revisions`,
      {
        title: '延期后的合成通知',
        body: '截止时间改为 2099-10-08',
      },
      { 'idempotency-key': 'notice-revision-1' },
    );
    assert.equal(revised.result.status, 201);
    assert.equal(revised.body.revision.revision_number, 2);
    const read = await call('GET', `/notices/${noticeId}`);
    assert.equal(read.body.notice.revisions.length, 2);
    const preview = await call('GET', `/notices/${noticeId}/preview`);
    assert.equal(preview.result.status, 200);
    assert.equal(preview.body.revision.revision_id, revised.body.revision.revision_id);
    const feedback = await call(
      'POST',
      '/feedback',
      {
        kind: 'notice_review',
        message: 'synthetic feedback',
      },
      { 'idempotency-key': 'feedback-1' },
    );
    assert.equal(feedback.result.status, 201);
  } finally {
    await close(api.server);
    repository.close();
  }
});

test('notice revisions create auditable task sync proposals and require user acceptance', async () => {
  const ai = createParserServer();
  const aiUrl = await listen(ai);
  const repository = new Repository(':memory:');
  const api = createApiServer({ repository, parserUrl: aiUrl });
  const apiUrl = await listen(api.server);
  const headers = { 'content-type': 'application/json', 'x-dev-user-id': 'synthetic-sync-user' };
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    extra: Record<string, string> = {},
  ) => {
    const result = await fetch(`${apiUrl}${path}`, {
      method,
      headers: { ...headers, ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { result, body: result.status === 204 ? null : await result.json() };
  };
  try {
    const login = await call(
      'POST',
      '/auth/dev-login',
      {
        userId: 'synthetic-sync-user',
        role: 'publisher',
      },
      { 'idempotency-key': 'sync-login-1' },
    );
    assert.equal(login.result.status, 200);
    const document = await call(
      'POST',
      '/documents',
      {
        title: '合成同步通知',
        text: '适用对象：本科生\n1. 完成登记\n截止：2099-10-01 前',
        data_origin: 'synthetic',
      },
      { 'idempotency-key': 'sync-document-1' },
    );
    const parsed = await call(
      'POST',
      `/documents/${document.body.document.document_id}/parse`,
      {},
      { 'idempotency-key': 'sync-parse-1' },
    );
    const actionId = parsed.body.result.verified_actions[0].action_id as string;
    await call(
      'POST',
      `/actions/${actionId}/confirm`,
      { confirmed: true },
      { 'idempotency-key': 'sync-confirm-1' },
    );
    const task = await call('POST', '/tasks', { actionId }, { 'idempotency-key': 'sync-task-1' });
    const taskId = task.body.task.task_id as string;
    const notice = await call(
      'POST',
      '/notices',
      { title: '合成同步通知', body: '截止：2099-10-01 前' },
      { 'idempotency-key': 'sync-notice-1' },
    );
    const noticeId = notice.body.notice.notice_id as string;
    await call(
      'POST',
      `/notices/${noticeId}/publish`,
      { confirmed: true },
      { 'idempotency-key': 'sync-publish-1' },
    );
    const link = await call(
      'POST',
      `/tasks/${taskId}/notices`,
      { noticeId, confirmed: true },
      { 'idempotency-key': 'sync-link-1' },
    );
    assert.equal(link.result.status, 201);
    const linkReplay = await call(
      'POST',
      `/tasks/${taskId}/notices`,
      { noticeId, confirmed: true },
      { 'idempotency-key': 'sync-link-1' },
    );
    assert.deepEqual(linkReplay.body, link.body);
    const replacement = await call(
      'POST',
      `/notices/${noticeId}/revisions`,
      { title: '延期后的合成同步通知', body: '截止：2099-10-08 前' },
      { 'idempotency-key': 'sync-revision-1' },
    );
    await call(
      'POST',
      `/notices/${noticeId}/publish`,
      { confirmed: true },
      { 'idempotency-key': 'sync-publish-2' },
    );
    const pending = await call('GET', `/tasks/${taskId}/notice-sync`);
    const replacementEvent = pending.body.sync[0].events.at(-1);
    assert.equal(replacementEvent.change_type, 'replaced');
    assert.equal(replacementEvent.status, 'pending_review');
    assert.notEqual(replacement.body.revision.revision_id, link.body.link.revision_id);
    const noConfirmation = await call(
      'POST',
      `/tasks/${taskId}/notice-sync/${replacementEvent.sync_event_id}/resolve`,
      { decision: 'reject' },
      { 'idempotency-key': 'sync-resolve-missing-1' },
    );
    assert.equal(noConfirmation.result.status, 400);
    assert.equal(noConfirmation.body.error.code, 'CONFIRMATION_REQUIRED');
    const rejected = await call(
      'POST',
      `/tasks/${taskId}/notice-sync/${replacementEvent.sync_event_id}/resolve`,
      { decision: 'reject', confirmed: true },
      { 'idempotency-key': 'sync-reject-1' },
    );
    assert.equal(rejected.result.status, 200);
    assert.equal(rejected.body.sync.status, 'rejected');
    const revokeWithoutConfirmation = await call(
      'POST',
      `/notices/${noticeId}/revisions`,
      { title: '未确认的撤销', body: '本通知撤销', status: 'revoked' },
      { 'idempotency-key': 'sync-revoked-missing-1' },
    );
    assert.equal(revokeWithoutConfirmation.result.status, 400);
    assert.equal(revokeWithoutConfirmation.body.error.code, 'CONFIRMATION_REQUIRED');
    const revoked = await call(
      'POST',
      `/notices/${noticeId}/revisions`,
      {
        title: '撤销的合成同步通知',
        body: '本通知撤销',
        status: 'revoked',
        confirmed: true,
      },
      { 'idempotency-key': 'sync-revoked-1' },
    );
    assert.equal(revoked.result.status, 201);
    const afterRevoke = await call('GET', `/tasks/${taskId}/notice-sync`);
    const revokeEvent = afterRevoke.body.sync[0].events.at(-1);
    assert.equal(revokeEvent.change_type, 'revoked');
    const accepted = await call(
      'POST',
      `/tasks/${taskId}/notice-sync/${revokeEvent.sync_event_id}/resolve`,
      { decision: 'accept', confirmed: true },
      { 'idempotency-key': 'sync-accept-revoke-1' },
    );
    assert.equal(accepted.result.status, 200);
    assert.equal(accepted.body.sync.status, 'accepted');
    assert.equal(accepted.body.task.status, 'cancelled');
    assert.equal(repository.getAction('synthetic-sync-user', actionId)?.task_status, 'cancelled');
  } finally {
    await close(api.server);
    await close(ai);
    repository.close();
  }
});
