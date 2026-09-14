import { createHash, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  createApiError,
  protocolVersion,
  validateTextParseResponse,
  type ApiError,
  type Document,
  type Task,
  type UserProfile,
  type VerifiedActionObject,
} from '@campus-action-os/protocol';
import { normalizeDocument } from '../../ai-parser/src/document-normalizer.js';
import type { OcrProvider } from '../../ai-parser/src/ocr.js';
import { Repository, RepositoryError } from './repository.js';

const port = Number(process.env.API_PORT ?? 3000);
const parserUrl = process.env.AI_SERVICE_URL ?? 'http://localhost:3001';

type Body = Record<string, unknown>;
type ApiServerOptions = {
  repository?: Repository;
  parserUrl?: string;
  environment?: string;
  requestTimeoutMs?: number;
  ocrProvider?: OcrProvider;
};

function requestIdFor(request: IncomingMessage): string {
  const value = request.headers['x-request-id']?.toString().trim();
  return value && value.length <= 200 ? value : randomUUID();
}

function send(response: ServerResponse, status: number, body: unknown, requestId: string): void {
  response.setHeader('x-request-id', requestId);
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.writeHead(status).end(JSON.stringify(body));
}

function bodyObject(input: unknown): Body {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    throw new RepositoryError('INVALID_REQUEST', 400, 'JSON object body is required');
  return input as Body;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    length += buffer.length;
    if (length > 1_100_000)
      throw new RepositoryError('TEXT_TOO_LARGE', 413, 'Request body too large');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RepositoryError('INVALID_REQUEST', 400, 'Invalid JSON request');
  }
}

function stringField(body: Body, key: string, required = true): string | undefined {
  const value = body[key];
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new RepositoryError('INVALID_REQUEST', 400, `${key} must be a non-empty string`);
  return value.trim();
}

function currentUser(request: IncomingMessage, repository: Repository): string {
  const header = request.headers['x-dev-user-id']?.toString().trim();
  const userId = header && /^[A-Za-z0-9._:-]{1,100}$/.test(header) ? header : 'dev-user';
  repository.ensureUser(userId);
  return userId;
}

function idempotencyKey(request: IncomingMessage, body: Body): string {
  const key =
    request.headers['idempotency-key']?.toString().trim() ||
    (typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '');
  if (!key || key.length > 200)
    throw new RepositoryError(
      'IDEMPOTENCY_KEY_REQUIRED',
      400,
      'Idempotency-Key is required for this operation',
    );
  return key;
}

function requestHash(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body), 'utf8').digest('hex');
}

function contentType(value: unknown): Document['content_type'] {
  if (value === undefined) return 'text/plain';
  if (
    value === 'text/plain' ||
    value === 'image/png' ||
    value === 'application/pdf' ||
    value === 'text/html'
  )
    return value;
  throw new RepositoryError('UNSUPPORTED_CONTENT_TYPE', 415, 'Unsupported document content type');
}

async function parserRequest(
  url: string,
  requestId: string,
  input: unknown,
  timeoutMs: number,
): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await fetch(`${url.replace(/\/$/, '')}/v1/parse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': requestId },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    const body = await result.json().catch(() => null);
    return { status: result.status, body };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError')
      return {
        status: 504,
        body: createApiError('PARSER_TIMEOUT', 'AI parser request timed out', requestId, true),
      };
    return {
      status: 503,
      body: createApiError('PARSER_NOT_CONFIGURED', 'AI parser service is unavailable', requestId),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function jobResponse(repository: Repository, userId: string, parseJobId: string): unknown {
  const job = repository.getParseJob(userId, parseJobId);
  if (!job) throw new RepositoryError('PARSE_JOB_NOT_FOUND', 404, 'Parse job not found');
  return job;
}

async function parseDocument(
  repository: Repository,
  userId: string,
  document: Document,
  parseJobId: string,
  requestId: string,
  parserBaseUrl: string,
  options: ApiServerOptions,
): Promise<void> {
  const normalized = await normalizeDocument(document, options.ocrProvider);
  if (!normalized.ok) {
    repository.failParseJob(
      userId,
      parseJobId,
      {
        code: normalized.code,
        message: normalized.message,
      },
      requestId,
    );
    return;
  }
  const storedProfile = repository.getProfile(userId);
  const {
    schema_version: _schemaVersion,
    profile_id: _profileId,
    updated_at: _updatedAt,
    ...profile
  } = storedProfile;
  const input = {
    schema_version: 'text-parse-request/v1',
    request_id: requestId,
    idempotency_key: `parse-job:${parseJobId}`,
    protocol_version: protocolVersion,
    document: {
      document_id: document.document_id,
      content_type: 'text/plain',
      text: normalized.text,
      content_sha256: normalized.content_sha256,
      language: 'zh-CN',
      timezone: 'Asia/Shanghai',
    },
    user_profile: profile,
    execution_context: {
      environment:
        (options.environment ?? process.env.APP_ENV ?? 'local') === 'production'
          ? 'production'
          : 'local',
      deadline_ms: Number(process.env.API_REQUEST_TIMEOUT_MS ?? 5000),
      requested_at: new Date().toISOString(),
    },
  };
  const result = await parserRequest(
    parserBaseUrl,
    requestId,
    input,
    options.requestTimeoutMs ?? Number(process.env.API_REQUEST_TIMEOUT_MS ?? 5000),
  );
  if (result.status < 200 || result.status >= 300) {
    repository.failParseJob(userId, parseJobId, result.body, requestId);
    return;
  }
  const valid = validateTextParseResponse(result.body);
  if (!valid.ok) {
    repository.failParseJob(
      userId,
      parseJobId,
      createApiError(
        'PARSER_RESPONSE_INVALID',
        'AI parser response failed protocol validation',
        requestId,
      ),
      requestId,
    );
    return;
  }
  repository.completeParseJob(userId, parseJobId, valid.value, requestId);
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  options: ApiServerOptions,
  repository: Repository,
): Promise<void> {
  const requestId = requestIdFor(request);
  const parsedUrl = new URL(request.url ?? '/', 'http://localhost');
  const path = parsedUrl.pathname.replace(/\/$/, '') || '/';
  const segments = path
    .split('/')
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));
  const environment = options.environment ?? process.env.APP_ENV ?? 'local';
  const publicHealthRoute =
    request.method === 'GET' &&
    (path === '/health' || path === '/ready' || path === '/v1/capabilities');
  const devLoginRoute = request.method === 'POST' && path === '/auth/dev-login';
  const publicRoute = publicHealthRoute || devLoginRoute;
  if (environment === 'production' && !publicRoute)
    throw new RepositoryError(
      'AUTH_NOT_CONFIGURED',
      503,
      'Production identity authentication is not configured for this local service',
      true,
    );
  const userId =
    publicHealthRoute || (environment === 'production' && devLoginRoute)
      ? 'anonymous'
      : currentUser(request, repository);
  const body = request.method === 'GET' ? {} : bodyObject(await readJson(request));
  const parserBaseUrl = options.parserUrl ?? parserUrl;

  if (request.method === 'GET' && path === '/health') {
    send(response, 200, { status: 'ok', service: 'api', database: 'sqlite' }, requestId);
    return;
  }
  if (request.method === 'GET' && path === '/ready') {
    send(response, 200, { status: 'ready', database: 'sqlite', parser: parserBaseUrl }, requestId);
    return;
  }
  if (request.method === 'GET' && path === '/v1/capabilities') {
    send(
      response,
      200,
      { service: 'api', protocolVersion, parsing: 'rule-based', database: 'sqlite' },
      requestId,
    );
    return;
  }
  if (request.method === 'POST' && path === '/auth/dev-login') {
    if ((options.environment ?? process.env.APP_ENV ?? 'local') === 'production')
      throw new RepositoryError(
        'DEV_LOGIN_DISABLED',
        403,
        'Development login is disabled in production',
      );
    const requested =
      typeof body.userId === 'string' && /^[A-Za-z0-9._:-]{1,100}$/.test(body.userId)
        ? body.userId
        : userId;
    repository.ensureUser(requested);
    send(
      response,
      200,
      {
        user_id: requested,
        access_token: `dev:${requested}`,
        environment: options.environment ?? process.env.APP_ENV ?? 'local',
      },
      requestId,
    );
    return;
  }
  if (request.method === 'GET' && path === '/users/me') {
    send(response, 200, { user_id: userId, profile: repository.getProfile(userId) }, requestId);
    return;
  }
  if (request.method === 'PATCH' && path === '/users/me/profile') {
    const profile: UserProfile = {};
    for (const key of ['education_level', 'grade', 'college', 'major', 'campus'] as const)
      if (body[key] !== undefined) {
        if (typeof body[key] !== 'string')
          throw new RepositoryError('INVALID_REQUEST', 400, `${key} must be a string`);
        profile[key] = body[key];
      }
    for (const key of ['student_categories', 'organization_memberships'] as const)
      if (body[key] !== undefined) {
        if (!Array.isArray(body[key]) || body[key].some((value) => typeof value !== 'string'))
          throw new RepositoryError('INVALID_REQUEST', 400, `${key} must be an array of strings`);
        profile[key] = body[key] as string[];
      }
    send(response, 200, repository.updateProfile(userId, profile), requestId);
    return;
  }

  if (request.method === 'POST' && (path === '/documents' || path === '/documents/upload')) {
    const key = idempotencyKey(request, body);
    const hash = requestHash(body);
    const previous = repository.getIdempotency(userId, path, key, hash);
    if (previous === 'conflict')
      throw new RepositoryError(
        'IDEMPOTENCY_CONFLICT',
        409,
        'Idempotency key was reused with a different request',
      );
    if (previous) {
      send(response, previous.status, previous.body, requestId);
      return;
    }
    const text = stringField(body, 'text');
    const document = repository.createDocument({
      ownerUserId: userId,
      title: stringField(body, 'title', false) ?? '校园通知',
      contentType: contentType(body.contentType),
      text: text!,
      dataOrigin: body.data_origin === 'synthetic' ? 'synthetic' : 'user_provided',
    });
    const output = { document };
    repository.saveIdempotency(userId, path, key, hash, 201, output);
    send(response, 201, output, requestId);
    return;
  }
  if (
    segments[0] === 'documents' &&
    segments[1] &&
    request.method === 'GET' &&
    segments.length === 2
  ) {
    const document = repository.getDocument(userId, segments[1]);
    if (!document) throw new RepositoryError('DOCUMENT_NOT_FOUND', 404, 'Document not found');
    send(response, 200, { document }, requestId);
    return;
  }
  if (
    segments[0] === 'documents' &&
    segments[1] &&
    request.method === 'DELETE' &&
    segments.length === 2
  ) {
    if (body.confirmed !== true)
      throw new RepositoryError(
        'CONFIRMATION_REQUIRED',
        400,
        'Deleting a document requires explicit confirmation',
      );
    if (!repository.deleteDocument(userId, segments[1]))
      throw new RepositoryError('DOCUMENT_NOT_FOUND', 404, 'Document not found');
    send(response, 204, null, requestId);
    return;
  }
  if (
    segments[0] === 'documents' &&
    segments[1] &&
    segments[2] === 'actions' &&
    request.method === 'GET'
  ) {
    if (!repository.getDocument(userId, segments[1]))
      throw new RepositoryError('DOCUMENT_NOT_FOUND', 404, 'Document not found');
    send(response, 200, { actions: repository.listActions(userId, segments[1]) }, requestId);
    return;
  }
  if (
    segments[0] === 'documents' &&
    segments[1] &&
    segments[2] === 'parse' &&
    request.method === 'POST'
  ) {
    const key = idempotencyKey(request, body);
    const document = repository.getDocument(userId, segments[1]);
    if (!document) throw new RepositoryError('DOCUMENT_NOT_FOUND', 404, 'Document not found');
    const job = repository.createParseJob(userId, document.document_id, requestId, key);
    if (!job.existed) {
      repository.startParseJob(userId, job.parseJobId, requestId);
      await parseDocument(
        repository,
        userId,
        document,
        job.parseJobId,
        requestId,
        parserBaseUrl,
        options,
      );
    }
    send(response, 202, jobResponse(repository, userId, job.parseJobId), requestId);
    return;
  }
  if (segments[0] === 'parse-jobs' && segments[1] && request.method === 'GET') {
    send(response, 200, jobResponse(repository, userId, segments[1]), requestId);
    return;
  }

  if (
    segments[0] === 'actions' &&
    segments[1] &&
    request.method === 'POST' &&
    segments[2] === 'confirm'
  ) {
    const key = idempotencyKey(request, body);
    const hash = requestHash(body);
    const previous = repository.getIdempotency(userId, path, key, hash);
    if (previous === 'conflict')
      throw new RepositoryError(
        'IDEMPOTENCY_CONFLICT',
        409,
        'Idempotency key was reused with a different request',
      );
    if (previous) {
      send(response, previous.status, previous.body, requestId);
      return;
    }
    const output = {
      action: repository.confirmAction(userId, segments[1], requestId, body.confirmed === true),
    };
    repository.saveIdempotency(userId, path, key, hash, 200, output);
    send(response, 200, output, requestId);
    return;
  }
  if (
    segments[0] === 'actions' &&
    segments[1] &&
    request.method === 'POST' &&
    segments[2] === 'reject'
  ) {
    const key = idempotencyKey(request, body);
    const hash = requestHash(body);
    const previous = repository.getIdempotency(userId, path, key, hash);
    if (previous === 'conflict')
      throw new RepositoryError(
        'IDEMPOTENCY_CONFLICT',
        409,
        'Idempotency key was reused with a different request',
      );
    if (previous) {
      send(response, previous.status, previous.body, requestId);
      return;
    }
    const output = {
      action: repository.rejectAction(userId, segments[1], requestId, body.rejected === true),
    };
    repository.saveIdempotency(userId, path, key, hash, 200, output);
    send(response, 200, output, requestId);
    return;
  }
  if (
    segments[0] === 'actions' &&
    segments[1] &&
    request.method === 'GET' &&
    segments.length === 2
  ) {
    const action = repository.getAction(userId, segments[1]);
    if (!action) throw new RepositoryError('ACTION_NOT_FOUND', 404, 'Action not found');
    send(response, 200, { action }, requestId);
    return;
  }
  if (segments[0] === 'actions' && segments[1] && request.method === 'PATCH') {
    const actionPatch: Partial<
      Pick<VerifiedActionObject, 'title' | 'summary' | 'deadline' | 'required_materials'>
    > = {};
    if (typeof body.title === 'string') actionPatch.title = body.title;
    if (typeof body.summary === 'string') actionPatch.summary = body.summary;
    if (body.deadline !== undefined)
      actionPatch.deadline = body.deadline as VerifiedActionObject['deadline'];
    if (body.required_materials !== undefined)
      actionPatch.required_materials =
        body.required_materials as VerifiedActionObject['required_materials'];
    send(
      response,
      200,
      {
        action: repository.updateAction(userId, segments[1], actionPatch, requestId),
      },
      requestId,
    );
    return;
  }

  if (request.method === 'POST' && path === '/tasks') {
    const key = idempotencyKey(request, body);
    const hash = requestHash(body);
    const previous = repository.getIdempotency(userId, path, key, hash);
    if (previous === 'conflict')
      throw new RepositoryError(
        'IDEMPOTENCY_CONFLICT',
        409,
        'Idempotency key was reused with a different request',
      );
    if (previous) {
      send(response, previous.status, previous.body, requestId);
      return;
    }
    const actionId = stringField(body, 'actionId')!;
    const task = repository.createTask(
      userId,
      actionId,
      stringField(body, 'title', false),
      requestId,
    );
    const output = { task };
    repository.saveIdempotency(userId, path, key, hash, 201, output);
    send(response, 201, output, requestId);
    return;
  }
  if (request.method === 'GET' && path === '/tasks') {
    send(response, 200, { tasks: repository.listTasks(userId) }, requestId);
    return;
  }
  if (segments[0] === 'tasks' && segments[1] && request.method === 'GET' && segments.length === 2) {
    const task = repository.getTask(userId, segments[1]);
    if (!task) throw new RepositoryError('TASK_NOT_FOUND', 404, 'Task not found');
    send(response, 200, { task }, requestId);
    return;
  }
  if (
    segments[0] === 'tasks' &&
    segments[1] &&
    request.method === 'PATCH' &&
    segments.length === 2
  ) {
    send(
      response,
      200,
      {
        task: repository.updateTask(
          userId,
          segments[1],
          {
            title: typeof body.title === 'string' ? body.title : undefined,
            status: body.status as Task['status'] | undefined,
            due_at:
              body.due_at === null || typeof body.due_at === 'string' ? body.due_at : undefined,
          },
          requestId,
        ),
      },
      requestId,
    );
    return;
  }
  if (
    segments[0] === 'tasks' &&
    segments[1] &&
    request.method === 'POST' &&
    segments[2] === 'complete'
  ) {
    const key = idempotencyKey(request, body);
    const hash = requestHash(body);
    const previous = repository.getIdempotency(userId, path, key, hash);
    if (previous === 'conflict')
      throw new RepositoryError(
        'IDEMPOTENCY_CONFLICT',
        409,
        'Idempotency key was reused with a different request',
      );
    if (previous) {
      send(response, previous.status, previous.body, requestId);
      return;
    }
    if (body.confirmed !== true)
      throw new RepositoryError(
        'CONFIRMATION_REQUIRED',
        400,
        'Completing a task requires explicit confirmation',
      );
    const output = {
      task: repository.updateTask(userId, segments[1], { status: 'completed' }, requestId),
    };
    repository.saveIdempotency(userId, path, key, hash, 200, output);
    send(response, 200, output, requestId);
    return;
  }

  if (request.method === 'POST' && path === '/notices') {
    const key = idempotencyKey(request, body);
    const hash = requestHash(body);
    const previous = repository.getIdempotency(userId, path, key, hash);
    if (previous === 'conflict')
      throw new RepositoryError(
        'IDEMPOTENCY_CONFLICT',
        409,
        'Idempotency key was reused with a different request',
      );
    if (previous) {
      send(response, previous.status, previous.body, requestId);
      return;
    }
    const title = stringField(body, 'title')!;
    const notice = repository.createNotice(userId, title, stringField(body, 'body')!, requestId);
    const output = { notice };
    repository.saveIdempotency(userId, path, key, hash, 201, output);
    send(response, 201, output, requestId);
    return;
  }
  if (
    segments[0] === 'notices' &&
    segments[1] &&
    request.method === 'GET' &&
    segments.length === 2
  ) {
    const notice = repository.getNotice(userId, segments[1]);
    if (!notice) throw new RepositoryError('NOTICE_NOT_FOUND', 404, 'Notice not found');
    send(response, 200, { notice }, requestId);
    return;
  }
  if (
    segments[0] === 'notices' &&
    segments[1] &&
    segments[2] === 'publish' &&
    request.method === 'POST'
  ) {
    const key = idempotencyKey(request, body);
    const hash = requestHash(body);
    const previous = repository.getIdempotency(userId, path, key, hash);
    if (previous === 'conflict')
      throw new RepositoryError(
        'IDEMPOTENCY_CONFLICT',
        409,
        'Idempotency key was reused with a different request',
      );
    if (previous) {
      send(response, previous.status, previous.body, requestId);
      return;
    }
    const output = {
      revision: repository.publishNotice(userId, segments[1], requestId, body.confirmed === true),
    };
    repository.saveIdempotency(userId, path, key, hash, 200, output);
    send(response, 200, output, requestId);
    return;
  }
  if (
    segments[0] === 'notices' &&
    segments[1] &&
    segments[2] === 'revisions' &&
    request.method === 'POST'
  ) {
    const key = idempotencyKey(request, body);
    const hash = requestHash(body);
    const previous = repository.getIdempotency(userId, path, key, hash);
    if (previous === 'conflict')
      throw new RepositoryError(
        'IDEMPOTENCY_CONFLICT',
        409,
        'Idempotency key was reused with a different request',
      );
    if (previous) {
      send(response, previous.status, previous.body, requestId);
      return;
    }
    const output = {
      revision: repository.createRevision(
        userId,
        segments[1],
        stringField(body, 'title')!,
        stringField(body, 'body')!,
        requestId,
      ),
    };
    repository.saveIdempotency(userId, path, key, hash, 201, output);
    send(response, 201, output, requestId);
    return;
  }
  if (
    segments[0] === 'notices' &&
    segments[1] &&
    segments[2] === 'preview' &&
    request.method === 'GET'
  ) {
    const notice = repository.getNotice(userId, segments[1]);
    if (!notice) throw new RepositoryError('NOTICE_NOT_FOUND', 404, 'Notice not found');
    send(
      response,
      200,
      {
        notice_id: notice.notice_id,
        revision: notice.revisions.at(-1) ?? null,
        audience: 'synthetic preview only',
      },
      requestId,
    );
    return;
  }
  if (request.method === 'POST' && path === '/feedback') {
    const key = idempotencyKey(request, body);
    const hash = requestHash(body);
    const previous = repository.getIdempotency(userId, path, key, hash);
    if (previous === 'conflict')
      throw new RepositoryError(
        'IDEMPOTENCY_CONFLICT',
        409,
        'Idempotency key was reused with a different request',
      );
    if (previous) {
      send(response, previous.status, previous.body, requestId);
      return;
    }
    const output = repository.addFeedback(
      userId,
      stringField(body, 'actionId', false),
      stringField(body, 'kind')!,
      stringField(body, 'message')!,
      requestId,
    );
    repository.saveIdempotency(userId, path, key, hash, 201, output);
    send(response, 201, output, requestId);
    return;
  }
  throw new RepositoryError('NOT_FOUND', 404, 'Route not found');
}

export function createApiServer(options: ApiServerOptions = {}): {
  server: Server;
  repository: Repository;
} {
  const repository = options.repository ?? new Repository();
  const server = createServer((request, response) => {
    const requestId = requestIdFor(request);
    response.setHeader('x-request-id', requestId);
    void handle(request, response, options, repository).catch((error: unknown) => {
      const requestId = response.getHeader('x-request-id')?.toString() ?? randomUUID();
      const domainError =
        error instanceof RepositoryError
          ? error
          : new RepositoryError('INTERNAL_ERROR', 500, 'Internal server error', true);
      send(
        response,
        domainError.status,
        createApiError(domainError.code, domainError.message, requestId, domainError.retryable),
        requestId,
      );
    });
  });
  return { server, repository };
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('services/api/src/server.ts')) {
  createApiServer().server.listen(port, () => console.log(`API listening on ${port}`));
}
