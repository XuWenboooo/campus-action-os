import { createHash, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  createApiError,
  protocolVersion,
  validateTextParseExchange,
  validateTextParseResponseAgainstText,
  type ApiError,
  type Document,
  type NotificationRevision,
  type Task,
  type TextParseRequest,
  type UserProfile,
  type VerifiedActionObject,
} from '@campus-action-os/protocol';
import { normalizeDocument } from '../../ai-parser/src/document-normalizer.js';
import { parseText } from '../../ai-parser/src/rule-parser.js';
import type { OcrProvider } from '../../ai-parser/src/ocr.js';
import { AudioPipelineError, transcribeAudio } from '../../audio-intelligence/src/pipeline.js';
import { createLocalAsrFailover } from '../../audio-intelligence/src/asr.js';
import type { AsrProvider, VoiceToTranscriptResult } from '../../audio-intelligence/src/types.js';
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
  audioProvider?: AsrProvider;
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

function assertAllowedFields(body: Body, allowed: readonly string[]): void {
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length > 0)
    throw new RepositoryError(
      'INVALID_REQUEST',
      400,
      `Unknown request field(s): ${unknown.join(', ')}`,
    );
}

async function readJson(request: IncomingMessage, maxBytes = 1_100_000): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    length += buffer.length;
    if (length > maxBytes)
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
    value === 'image/jpeg' ||
    value === 'application/pdf' ||
    value === 'text/html'
  )
    return value;
  throw new RepositoryError('UNSUPPORTED_CONTENT_TYPE', 415, 'Unsupported document content type');
}

const maxBinaryUploadBytes = 800_000;

function binaryUpload(
  value: unknown,
  contentTypeValue: 'image/png' | 'image/jpeg' | 'application/pdf',
): Uint8Array {
  if (typeof value !== 'string' || value.length % 4 !== 0)
    throw new RepositoryError('INVALID_REQUEST', 400, 'content_base64 must be canonical Base64');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    throw new RepositoryError('INVALID_REQUEST', 400, 'content_base64 must be canonical Base64');
  const content = Buffer.from(value, 'base64');
  if (content.byteLength === 0)
    throw new RepositoryError('EMPTY_FILE', 400, 'Binary upload cannot be empty');
  if (content.byteLength > maxBinaryUploadBytes)
    throw new RepositoryError(
      'TEXT_TOO_LARGE',
      413,
      `Binary upload must be between 1 and ${maxBinaryUploadBytes} bytes`,
    );
  if (content.toString('base64') !== value)
    throw new RepositoryError('INVALID_REQUEST', 400, 'content_base64 must be canonical Base64');
  const isPng =
    contentTypeValue === 'image/png' &&
    Buffer.from(content.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg =
    contentTypeValue === 'image/jpeg' &&
    content.byteLength >= 3 &&
    content[0] === 0xff &&
    content[1] === 0xd8 &&
    content[2] === 0xff;
  const isPdf =
    contentTypeValue === 'application/pdf' &&
    Buffer.from(content.subarray(0, 5)).toString('ascii') === '%PDF-';
  if (!isPng && !isJpeg && !isPdf)
    throw new RepositoryError(
      'INVALID_REQUEST',
      400,
      'content_base64 bytes do not match the declared media type',
    );
  return content;
}

function dataOrigin(value: unknown): Document['data_origin'] {
  if (value === undefined) return 'user_provided';
  if (value === 'synthetic' || value === 'user_provided') return value;
  throw new RepositoryError(
    'INVALID_REQUEST',
    400,
    'data_origin must be synthetic or user_provided',
  );
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
  const normalized = await normalizeDocument(
    document,
    options.ocrProvider,
    repository.getDocumentContent(userId, document.document_id) ?? undefined,
  );
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
  const exchange = validateTextParseExchange(input, result.body);
  if (!exchange.ok) {
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
  const valid = validateTextParseResponseAgainstText(exchange.value.response, normalized.text);
  if (!valid.ok) {
    repository.failParseJob(
      userId,
      parseJobId,
      createApiError(
        'PARSER_RESPONSE_INVALID',
        'AI parser response failed evidence alignment validation',
        requestId,
      ),
      requestId,
    );
    return;
  }
  repository.completeParseJob(userId, parseJobId, valid.value, requestId);
}

type AudioRuntimeRecord = {
  userId: string;
  bytes: Uint8Array;
  result: VoiceToTranscriptResult;
  actionIds: string[];
};

function audioModelProvider(): AsrProvider {
  return createLocalAsrFailover({
    primary: {
      model_dir: process.env.SENSEVOICE_MODEL_DIR ?? '',
      python_command: process.env.ASR_PYTHON_COMMAND ?? 'python',
      device: process.env.ASR_DEVICE ?? 'cpu',
      compute_type: process.env.ASR_COMPUTE_TYPE ?? 'int8',
    },
    fallback: {
      model_dir: process.env.FASTER_WHISPER_MODEL_DIR ?? '',
      python_command: process.env.ASR_PYTHON_COMMAND ?? 'python',
      device: process.env.ASR_DEVICE ?? 'cpu',
      compute_type: process.env.ASR_COMPUTE_TYPE ?? 'int8',
    },
  });
}

function audioUpload(value: unknown, filename: string, declaredType: unknown): Uint8Array {
  const extension = filename.toLowerCase().split('.').pop();
  const normalizedType = declaredType === 'audio/x-wav' ? 'audio/wav' : declaredType;
  if (normalizedType !== 'audio/wav' && !(normalizedType === undefined && extension === 'wav'))
    throw new RepositoryError(
      'AUDIO_UNSUPPORTED_FORMAT',
      415,
      '当前真实音频入口只接受 WAV；M4A/MP3 尚未开放',
    );
  if (typeof value !== 'string' || value.length % 4 !== 0)
    throw new RepositoryError('INVALID_REQUEST', 400, 'content_base64 must be canonical Base64');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    throw new RepositoryError('INVALID_REQUEST', 400, 'content_base64 must be canonical Base64');
  const content = Buffer.from(value, 'base64');
  if (content.byteLength === 0)
    throw new RepositoryError('EMPTY_FILE', 400, 'Audio upload cannot be empty');
  const maxBytes = 8_000_000;
  if (content.byteLength > maxBytes)
    throw new RepositoryError(
      'TEXT_TOO_LARGE',
      413,
      `Audio upload must be at most ${maxBytes} bytes`,
    );
  if (content.toString('base64') !== value)
    throw new RepositoryError('INVALID_REQUEST', 400, 'content_base64 must be canonical Base64');
  return content;
}

async function parseAudioTranscript(
  repository: Repository,
  userId: string,
  document: Document,
  parseJobId: string,
  requestId: string,
  transcript: VoiceToTranscriptResult,
  environment: string,
): Promise<Exclude<ReturnType<typeof parseText>, { code: string }>> {
  const sourceText = transcript.transcript_segments
    .map((segment) => segment.text.trim())
    .join('\n');
  const storedProfile = repository.getProfile(userId);
  const {
    schema_version: _schemaVersion,
    profile_id: _profileId,
    updated_at: _updatedAt,
    ...profile
  } = storedProfile;
  const input: TextParseRequest = {
    schema_version: 'text-parse-request/v1',
    request_id: requestId,
    idempotency_key: `audio-parse-job:${parseJobId}`,
    protocol_version: protocolVersion,
    document: {
      document_id: document.document_id,
      content_type: 'text/plain',
      text: sourceText,
      content_sha256: createHash('sha256').update(sourceText, 'utf8').digest('hex'),
      language: 'zh-CN',
      timezone: 'Asia/Shanghai',
    },
    user_profile: profile,
    execution_context: {
      environment: environment === 'production' ? 'production' : 'local',
      deadline_ms: Number(process.env.API_REQUEST_TIMEOUT_MS ?? 5000),
      requested_at: new Date().toISOString(),
    },
  };
  const parsed = parseText(input);
  if ('code' in parsed)
    throw new AudioPipelineError('ACTION_COMPILER_FAILED', parsed.message, {
      request_id: requestId,
      audio_id: transcript.audio_id,
      raw_audio_hash: transcript.provenance.raw_audio_hash,
    });
  const valid = validateTextParseResponseAgainstText(parsed, sourceText);
  if (!valid.ok)
    throw new AudioPipelineError(
      'ACTION_COMPILER_FAILED',
      'Action Compiler evidence alignment failed',
      {
        request_id: requestId,
        audio_id: transcript.audio_id,
        raw_audio_hash: transcript.provenance.raw_audio_hash,
      },
    );
  repository.completeParseJob(userId, parseJobId, valid.value, requestId);
  return valid.value;
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  options: ApiServerOptions,
  repository: Repository,
  audioRuntime: Map<string, AudioRuntimeRecord>,
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
  const body =
    request.method === 'GET'
      ? {}
      : bodyObject(await readJson(request, path === '/documents/audio' ? 6_000_000 : undefined));
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
    assertAllowedFields(body, ['userId', 'role', 'idempotencyKey']);
    if ((options.environment ?? process.env.APP_ENV ?? 'local') === 'production')
      throw new RepositoryError(
        'DEV_LOGIN_DISABLED',
        403,
        'Development login is disabled in production',
      );
    const key = idempotencyKey(request, body);
    const hash = requestHash(body);
    const requested =
      typeof body.userId === 'string' && /^[A-Za-z0-9._:-]{1,100}$/.test(body.userId)
        ? body.userId
        : userId;
    const previous = repository.getIdempotency(requested, path, key, hash);
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
    let role: 'student' | 'publisher' | 'admin' = 'student';
    if (body.role !== undefined) {
      if (body.role !== 'student' && body.role !== 'publisher' && body.role !== 'admin')
        throw new RepositoryError(
          'INVALID_REQUEST',
          400,
          'role must be student, publisher, or admin',
        );
      role = body.role;
      repository.setDevelopmentRole(requested, role, requestId);
    } else {
      repository.ensureUser(requested);
    }
    const output = {
      user_id: requested,
      role: repository.getUserRole(requested),
      access_token: `dev:${requested}`,
      environment: options.environment ?? process.env.APP_ENV ?? 'local',
    };
    repository.saveIdempotency(requested, path, key, hash, 200, output);
    send(response, 200, output, requestId);
    return;
  }
  if (request.method === 'GET' && path === '/users/me') {
    send(response, 200, { user_id: userId, profile: repository.getProfile(userId) }, requestId);
    return;
  }
  if (request.method === 'GET' && path === '/users/me/export') {
    send(response, 200, repository.exportUserData(userId), requestId);
    return;
  }
  if (request.method === 'PATCH' && path === '/users/me/profile') {
    assertAllowedFields(body, [
      'education_level',
      'grade',
      'college',
      'major',
      'campus',
      'student_categories',
      'organization_memberships',
      'idempotencyKey',
    ]);
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
    const output = repository.updateProfile(userId, profile, requestId);
    repository.saveIdempotency(userId, path, key, hash, 200, output);
    send(response, 200, output, requestId);
    return;
  }

  if (request.method === 'POST' && (path === '/documents' || path === '/documents/upload')) {
    assertAllowedFields(
      body,
      path === '/documents'
        ? ['title', 'contentType', 'text', 'data_origin', 'idempotencyKey']
        : ['title', 'contentType', 'text', 'content_base64', 'data_origin', 'idempotencyKey'],
    );
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
    const uploaded = path === '/documents/upload';
    const documentContentType = contentType(body.contentType);
    if (
      !uploaded &&
      (documentContentType === 'image/png' ||
        documentContentType === 'image/jpeg' ||
        documentContentType === 'application/pdf')
    )
      throw new RepositoryError(
        'UNSUPPORTED_CONTENT_TYPE',
        415,
        'image/png, image/jpeg, and application/pdf documents must use /documents/upload',
      );
    let sourceContent: Uint8Array | undefined;
    let text: string | undefined;
    if (
      uploaded &&
      (documentContentType === 'image/png' ||
        documentContentType === 'image/jpeg' ||
        documentContentType === 'application/pdf')
    ) {
      sourceContent = binaryUpload(body.content_base64, documentContentType);
      text = stringField(body, 'text', false) ?? '';
    } else {
      if (uploaded && body.content_base64 !== undefined)
        throw new RepositoryError(
          'UNSUPPORTED_CONTENT_TYPE',
          415,
          'content_base64 uploads require image/png, image/jpeg, or application/pdf',
        );
      text = stringField(body, 'text');
    }
    const document = repository.createDocument({
      ownerUserId: userId,
      title: stringField(body, 'title', false) ?? '校园通知',
      contentType: documentContentType,
      text: text!,
      dataOrigin: dataOrigin(body.data_origin),
      sourceContent,
    });
    const output = { document };
    repository.saveIdempotency(userId, path, key, hash, 201, output);
    send(response, 201, output, requestId);
    return;
  }

  if (request.method === 'POST' && path === '/documents/audio') {
    assertAllowedFields(body, [
      'title',
      'filename',
      'contentType',
      'content_base64',
      'data_origin',
      'idempotencyKey',
    ]);
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
    const filename = stringField(body, 'filename', false) ?? 'voice.wav';
    const bytes = audioUpload(body.content_base64, filename, body.contentType);
    let transcript: VoiceToTranscriptResult;
    try {
      const maxSilenceMs = Number(process.env.ASR_VAD_MAX_SILENCE_MS ?? 20_000);
      transcript = await transcribeAudio(bytes, options.audioProvider ?? audioModelProvider(), {
        content_type: body.contentType === 'audio/x-wav' ? 'audio/wav' : 'audio/wav',
        audio_id: `audio-${randomUUID()}`,
        request_id: requestId,
        vad:
          Number.isFinite(maxSilenceMs) && maxSilenceMs > 0
            ? { max_silence_ms: maxSilenceMs }
            : undefined,
      });
    } catch (error) {
      if (error instanceof AudioPipelineError)
        throw new RepositoryError(
          error.code,
          error.code.startsWith('AUDIO_') ? 400 : 503,
          error.message,
          true,
        );
      throw error;
    }
    const document = repository.createDocument({
      ownerUserId: userId,
      title: stringField(body, 'title', false) ?? filename,
      contentType: 'text/plain',
      text: transcript.transcript_segments.map((segment) => segment.text.trim()).join('\n'),
      dataOrigin: dataOrigin(body.data_origin),
    });
    const job = repository.createParseJob(userId, document.document_id, requestId, key, hash);
    repository.startParseJob(userId, job.parseJobId, requestId);
    let parsed;
    try {
      parsed = await parseAudioTranscript(
        repository,
        userId,
        document,
        job.parseJobId,
        requestId,
        transcript,
        environment,
      );
    } catch (error) {
      if (repository.getParseJob(userId, job.parseJobId)?.status === 'running')
        repository.failParseJob(userId, job.parseJobId, error, requestId);
      if (error instanceof AudioPipelineError)
        throw new RepositoryError(
          error.code,
          error.code.startsWith('AUDIO_') ? 400 : 503,
          error.message,
          true,
        );
      throw error;
    }
    const output = {
      document,
      parse_job: jobResponse(repository, userId, job.parseJobId),
      audio: {
        audio_id: transcript.audio_id,
        info: transcript.info,
        provenance: transcript.provenance,
        asr_provider: transcript.asr_provider,
        transcript_segments: transcript.transcript_segments,
        audio_evidence: transcript.audio_evidence,
        spoken_revisions: transcript.spoken_revisions,
      },
    };
    audioRuntime.set(transcript.audio_id, {
      userId,
      bytes,
      result: transcript,
      actionIds: parsed.verified_actions.map((action) => action.action_id),
    });
    repository.saveIdempotency(userId, path, key, hash, 201, output);
    send(response, 201, output, requestId);
    return;
  }

  if (request.method === 'GET' && segments[0] === 'audio' && segments[1] && segments.length === 2) {
    const record = audioRuntime.get(segments[1]);
    if (!record || record.userId !== userId)
      throw new RepositoryError('AUDIO_NOT_FOUND', 404, 'Audio not found');
    response.setHeader('x-request-id', requestId);
    response.setHeader('content-type', 'audio/wav');
    response.setHeader('content-length', String(record.bytes.byteLength));
    response.writeHead(200).end(Buffer.from(record.bytes));
    return;
  }

  if (
    request.method === 'GET' &&
    segments[0] === 'actions' &&
    segments[1] &&
    segments[2] === 'audio-evidence'
  ) {
    if (!repository.getAction(userId, segments[1]))
      throw new RepositoryError('ACTION_NOT_FOUND', 404, 'Action not found');
    const record = [...audioRuntime.values()].find(
      (candidate) => candidate.userId === userId && candidate.actionIds.includes(segments[1]),
    );
    if (!record)
      throw new RepositoryError('AUDIO_EVIDENCE_NOT_FOUND', 404, 'Audio evidence not found');
    send(response, 200, record.result, requestId);
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
    assertAllowedFields(body, ['confirmed', 'idempotencyKey']);
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
        'Deleting a document requires explicit confirmation',
      );
    if (!repository.deleteDocument(userId, segments[1]))
      throw new RepositoryError('DOCUMENT_NOT_FOUND', 404, 'Document not found');
    repository.saveIdempotency(userId, path, key, hash, 204, null);
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
    assertAllowedFields(body, ['idempotencyKey']);
    const key = idempotencyKey(request, body);
    const document = repository.getDocument(userId, segments[1]);
    if (!document) throw new RepositoryError('DOCUMENT_NOT_FOUND', 404, 'Document not found');
    const job = repository.createParseJob(
      userId,
      document.document_id,
      requestId,
      key,
      requestHash(body),
    );
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
    assertAllowedFields(body, ['confirmed', 'idempotencyKey']);
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
    assertAllowedFields(body, ['rejected', 'idempotencyKey']);
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
    assertAllowedFields(body, [
      'title',
      'summary',
      'deadline',
      'required_materials',
      'idempotencyKey',
    ]);
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
    const actionPatch: Partial<
      Pick<VerifiedActionObject, 'title' | 'summary' | 'deadline' | 'required_materials'>
    > = {};
    const hasField = (field: string): boolean => Object.prototype.hasOwnProperty.call(body, field);
    if (!['title', 'summary', 'deadline', 'required_materials'].some(hasField))
      throw new RepositoryError('INVALID_REQUEST', 400, 'At least one action field is required');
    if (hasField('title')) actionPatch.title = stringField(body, 'title')!;
    if (hasField('summary')) actionPatch.summary = stringField(body, 'summary')!;
    if (hasField('deadline')) {
      if (
        typeof body.deadline !== 'object' ||
        body.deadline === null ||
        Array.isArray(body.deadline)
      )
        throw new RepositoryError('INVALID_REQUEST', 400, 'deadline must be an object');
      actionPatch.deadline = body.deadline as VerifiedActionObject['deadline'];
    }
    if (hasField('required_materials')) {
      if (!Array.isArray(body.required_materials))
        throw new RepositoryError('INVALID_REQUEST', 400, 'required_materials must be an array');
      actionPatch.required_materials =
        body.required_materials as VerifiedActionObject['required_materials'];
    }
    const output = {
      action: repository.updateAction(userId, segments[1], actionPatch, requestId),
    };
    repository.saveIdempotency(userId, path, key, hash, 200, output);
    send(response, 200, output, requestId);
    return;
  }

  if (request.method === 'POST' && path === '/tasks') {
    assertAllowedFields(body, ['actionId', 'title', 'idempotencyKey']);
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
  if (request.method === 'POST' && path === '/tasks/manual') {
    assertAllowedFields(body, ['documentId', 'title', 'due_at', 'confirmed', 'idempotencyKey']);
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
        'Manual task creation requires explicit confirmation',
      );
    const dueAt =
      body.due_at === undefined
        ? null
        : body.due_at === null
          ? null
          : typeof body.due_at === 'string' && body.due_at.trim().length > 0
            ? body.due_at.trim()
            : (() => {
                throw new RepositoryError(
                  'INVALID_REQUEST',
                  400,
                  'due_at must be a date string or null',
                );
              })();
    const output = repository.createManualTask(
      userId,
      stringField(body, 'documentId')!,
      stringField(body, 'title')!,
      dueAt,
      requestId,
    );
    repository.saveIdempotency(userId, path, key, hash, 201, output);
    send(response, 201, output, requestId);
    return;
  }
  if (
    segments[0] === 'tasks' &&
    segments[1] &&
    segments[2] === 'notices' &&
    request.method === 'POST'
  ) {
    assertAllowedFields(body, ['noticeId', 'confirmed', 'idempotencyKey']);
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
      link: repository.linkTaskToNotice(
        userId,
        segments[1],
        stringField(body, 'noticeId')!,
        requestId,
        body.confirmed === true,
      ),
    };
    repository.saveIdempotency(userId, path, key, hash, 201, output);
    send(response, 201, output, requestId);
    return;
  }
  if (request.method === 'GET' && path === '/tasks') {
    send(response, 200, { tasks: repository.listTasks(userId) }, requestId);
    return;
  }
  if (
    segments[0] === 'tasks' &&
    segments[1] &&
    segments[2] === 'notice-sync' &&
    request.method === 'GET'
  ) {
    send(response, 200, { sync: repository.listNoticeTaskSync(userId, segments[1]) }, requestId);
    return;
  }
  if (
    segments[0] === 'tasks' &&
    segments[1] &&
    segments[2] === 'notice-sync' &&
    segments[3] &&
    segments[4] === 'resolve' &&
    request.method === 'POST'
  ) {
    assertAllowedFields(body, ['decision', 'confirmed', 'idempotencyKey']);
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
    if (body.decision !== 'accept' && body.decision !== 'reject')
      throw new RepositoryError('INVALID_REQUEST', 400, 'decision must be accept or reject');
    const output = repository.resolveNoticeTaskSync(
      userId,
      segments[1],
      segments[3],
      body.decision,
      body.confirmed === true,
      requestId,
    );
    repository.saveIdempotency(userId, path, key, hash, 200, output);
    send(response, 200, output, requestId);
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
    assertAllowedFields(body, ['title', 'status', 'due_at', 'confirmed', 'idempotencyKey']);
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
    const hasField = (field: string): boolean => Object.prototype.hasOwnProperty.call(body, field);
    if (!['title', 'status', 'due_at'].some(hasField))
      throw new RepositoryError('INVALID_REQUEST', 400, 'At least one task field is required');
    if (hasField('title')) stringField(body, 'title');
    if (hasField('status')) {
      if (
        !['pending', 'in_progress', 'completed', 'expired', 'cancelled'].includes(
          body.status as string,
        )
      )
        throw new RepositoryError('INVALID_REQUEST', 400, 'status is not a valid task status');
      if (['completed', 'cancelled'].includes(body.status as string) && body.confirmed !== true)
        throw new RepositoryError(
          'CONFIRMATION_REQUIRED',
          400,
          'Completing or cancelling a task requires explicit confirmation',
        );
    }
    if (hasField('due_at') && body.due_at !== null) {
      if (typeof body.due_at !== 'string' || body.due_at.trim().length === 0)
        throw new RepositoryError('INVALID_REQUEST', 400, 'due_at must be a date string or null');
    }
    const output = {
      task: repository.updateTask(
        userId,
        segments[1],
        {
          title: hasField('title') ? stringField(body, 'title') : undefined,
          status: hasField('status') ? (body.status as Task['status']) : undefined,
          due_at: hasField('due_at') ? (body.due_at as string | null) : undefined,
        },
        requestId,
      ),
    };
    repository.saveIdempotency(userId, path, key, hash, 200, output);
    send(response, 200, output, requestId);
    return;
  }
  if (
    segments[0] === 'tasks' &&
    segments[1] &&
    request.method === 'POST' &&
    segments[2] === 'complete'
  ) {
    assertAllowedFields(body, ['confirmed', 'idempotencyKey']);
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
    assertAllowedFields(body, ['title', 'body', 'idempotencyKey']);
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
    assertAllowedFields(body, ['confirmed', 'idempotencyKey']);
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
    assertAllowedFields(body, ['title', 'body', 'status', 'confirmed', 'idempotencyKey']);
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
        {
          status: body.status as NotificationRevision['status'] | undefined,
          confirmed: body.confirmed === true,
        },
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
    assertAllowedFields(body, ['actionId', 'kind', 'message', 'idempotencyKey']);
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
  const audioRuntime = new Map<string, AudioRuntimeRecord>();
  const server = createServer((request, response) => {
    const requestId = requestIdFor(request);
    response.setHeader('x-request-id', requestId);
    void handle(request, response, options, repository, audioRuntime).catch((error: unknown) => {
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

