import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { migrateDatabase } from '../../../database/migrate.js';
import {
  createApiError,
  validateDocument,
  validateNotificationRevision,
  validateParseJob,
  validateTask,
  validateTextParseResponse,
  validateUserDataExport,
  validateUserProfile,
  validateVerifiedActionObject,
  type ApiError,
  type Document,
  type NotificationRevision,
  type ParseJob,
  type PublicUserProfile,
  type Task,
  type TextParseResponse,
  type UserProfile,
  type UserDataExport,
  type VerifiedActionObject,
} from '@campus-action-os/protocol';

type Row = Record<string, unknown>;

export class RepositoryError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'RepositoryError';
  }
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function parseJson<T>(value: unknown): T {
  return JSON.parse(String(value)) as T;
}

function text(value: unknown): string {
  return String(value);
}

function sha256Bytes(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function now(): string {
  return new Date().toISOString();
}

function documentFromRow(row: Row): Document {
  const document: Document = {
    schema_version: 'document/v1',
    document_id: text(row.document_id),
    owner_user_id: text(row.owner_user_id),
    title: text(row.title),
    content_type: row.content_type as Document['content_type'],
    text: text(row.text),
    content_sha256: text(row.content_sha256),
    data_origin: row.data_origin as Document['data_origin'],
    created_at: text(row.created_at),
  };
  const valid = validateDocument(document);
  if (!valid.ok)
    throw new RepositoryError('DATA_CORRUPTION', 500, 'Stored document failed schema validation');
  return valid.value;
}

function actionFromRow(row: Row): VerifiedActionObject {
  const valid = validateVerifiedActionObject(parseJson<VerifiedActionObject>(row.payload_json));
  if (!valid.ok)
    throw new RepositoryError('DATA_CORRUPTION', 500, 'Stored action failed schema validation');
  return valid.value;
}

function insertActionChanges(db: DatabaseSync, action: VerifiedActionObject): void {
  const statement = db.prepare(
    'INSERT OR IGNORE INTO action_change_history (change_id, action_id, occurred_at, actor, change_type, reason, previous_action_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  for (const change of action.change_history) {
    statement.run(
      change.change_id,
      action.action_id,
      change.occurred_at,
      change.actor,
      change.change_type,
      change.reason,
      change.previous_action_id ?? null,
    );
  }
}

function replaceActionProjections(db: DatabaseSync, action: VerifiedActionObject): void {
  db.prepare('DELETE FROM materials WHERE action_id = ?').run(action.action_id);
  db.prepare('DELETE FROM action_dependencies WHERE action_id = ?').run(action.action_id);
  db.prepare('DELETE FROM deadlines WHERE action_id = ?').run(action.action_id);
  db.prepare('DELETE FROM action_steps WHERE action_id = ?').run(action.action_id);

  const stepStatement = db.prepare(
    'INSERT INTO action_steps (action_id, step_id, instruction, location_json, platform_json, epistemic_status, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  for (const [position, step] of action.steps.entries())
    stepStatement.run(
      action.action_id,
      step.step_id,
      step.instruction,
      step.location ? json(step.location) : null,
      step.platform ? json(step.platform) : null,
      step.epistemic_status,
      position,
    );

  const dependencyStatement = db.prepare(
    'INSERT INTO action_dependencies (action_id, dependency_id, from_step_id, to_step_id, dependency_type, condition_id) VALUES (?, ?, ?, ?, ?, ?)',
  );
  for (const dependency of action.dependencies)
    dependencyStatement.run(
      action.action_id,
      dependency.dependency_id,
      dependency.from_step_id,
      dependency.to_step_id,
      dependency.type,
      dependency.condition_id ?? null,
    );

  db.prepare(
    'INSERT INTO deadlines (action_id, value, precision, boundary_semantics, timezone, epistemic_status, evidence_ids_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    action.action_id,
    action.deadline.value,
    action.deadline.precision,
    action.deadline.boundary_semantics,
    action.deadline.timezone ?? null,
    action.deadline.epistemic_status,
    json(action.deadline.evidence_ids),
  );

  const materialStatement = db.prepare(
    'INSERT INTO materials (material_record_id, material_id, action_id, step_id, description, epistemic_status, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  for (const [position, material] of action.required_materials.entries())
    materialStatement.run(
      `${action.action_id}:action-material:${position}`,
      material.material_id,
      action.action_id,
      null,
      material.description,
      material.epistemic_status,
      position,
    );
  for (const step of action.steps)
    for (const [position, material] of (step.required_materials ?? []).entries())
      materialStatement.run(
        `${action.action_id}:step-material:${step.step_id}:${position}`,
        material.material_id,
        action.action_id,
        step.step_id,
        material.description,
        material.epistemic_status,
        position,
      );
}

function normalizedError(value: unknown, requestId: string): ApiError['error'] {
  const candidate =
    typeof value === 'object' && value !== null && 'error' in value
      ? (value as { error: unknown }).error
      : value;
  if (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof (candidate as Record<string, unknown>).code === 'string' &&
    typeof (candidate as Record<string, unknown>).message === 'string' &&
    typeof (candidate as Record<string, unknown>).retryable === 'boolean'
  ) {
    return {
      code: (candidate as Record<string, string>).code,
      message: (candidate as Record<string, string>).message,
      requestId:
        typeof (candidate as Record<string, unknown>).requestId === 'string'
          ? String((candidate as Record<string, unknown>).requestId)
          : requestId,
      retryable: Boolean((candidate as Record<string, unknown>).retryable),
    };
  }
  if (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof (candidate as Record<string, unknown>).code === 'string' &&
    typeof (candidate as Record<string, unknown>).message === 'string'
  ) {
    return {
      code: String((candidate as Record<string, unknown>).code),
      message: String((candidate as Record<string, unknown>).message),
      requestId,
      retryable: false,
    };
  }
  return {
    code: 'PARSER_REJECTED',
    message: 'Parser failed without a valid error object',
    requestId,
    retryable: false,
  };
}

function taskFromRow(row: Row): Task {
  const task: Task = {
    schema_version: 'task/v1',
    task_id: text(row.task_id),
    user_id: text(row.user_id),
    action_id: text(row.action_id),
    document_id: text(row.document_id),
    title: text(row.title),
    status: row.status as Task['status'],
    due_at: row.due_at === null ? null : text(row.due_at),
    created_at: text(row.created_at),
    updated_at: text(row.updated_at),
    completed_at: row.completed_at === null ? null : text(row.completed_at),
  };
  const result = validateTask(task);
  if (!result.ok)
    throw new RepositoryError('DATA_CORRUPTION', 500, 'Stored task failed schema validation');
  return result.value;
}

function revisionFromRow(row: Row): NotificationRevision {
  const revision: NotificationRevision = {
    schema_version: 'notification-revision/v1',
    notice_id: text(row.notice_id),
    revision_id: text(row.revision_id),
    revision_number: Number(row.revision_number),
    status: row.status as NotificationRevision['status'],
    title: text(row.title),
    body: text(row.body),
    created_at: text(row.created_at),
    published_at: row.published_at === null ? null : text(row.published_at),
  };
  const valid = validateNotificationRevision(revision);
  if (!valid.ok)
    throw new RepositoryError(
      'DATA_CORRUPTION',
      500,
      'Stored notification revision failed schema validation',
    );
  return valid.value;
}

export type NoticeTaskSyncChangeType = 'replaced' | 'postponed' | 'revoked';
export type NoticeTaskSyncStatus = 'pending_review' | 'accepted' | 'rejected';
export type NoticeTaskLink = {
  link_id: string;
  notice_id: string;
  task_id: string;
  revision_id: string;
  status: 'active' | 'unlinked';
  linked_at: string;
};
export type NoticeTaskSyncEvent = {
  sync_event_id: string;
  link_id: string;
  from_revision_id: string;
  to_revision_id: string;
  change_type: NoticeTaskSyncChangeType;
  status: NoticeTaskSyncStatus;
  reason: string;
  request_id: string;
  created_at: string;
  resolved_at: string | null;
};

function noticeTaskLinkFromRow(row: Row): NoticeTaskLink {
  return {
    link_id: text(row.link_id),
    notice_id: text(row.notice_id),
    task_id: text(row.task_id),
    revision_id: text(row.revision_id),
    status: row.status as NoticeTaskLink['status'],
    linked_at: text(row.linked_at),
  };
}

function noticeTaskSyncEventFromRow(row: Row): NoticeTaskSyncEvent {
  return {
    sync_event_id: text(row.sync_event_id),
    link_id: text(row.link_id),
    from_revision_id: text(row.from_revision_id),
    to_revision_id: text(row.to_revision_id),
    change_type: row.change_type as NoticeTaskSyncChangeType,
    status: row.status as NoticeTaskSyncStatus,
    reason: text(row.reason),
    request_id: text(row.request_id),
    created_at: text(row.created_at),
    resolved_at: row.resolved_at === null ? null : text(row.resolved_at),
  };
}

export type CreateDocumentInput = {
  documentId?: string;
  ownerUserId: string;
  title: string;
  contentType: Document['content_type'];
  text: string;
  dataOrigin?: Document['data_origin'];
  sourceContent?: Uint8Array;
};

export type DocumentFile = {
  document_id: string;
  content_type: 'image/png' | 'image/jpeg' | 'application/pdf';
  byte_length: number;
  content_sha256: string;
  created_at: string;
};

export type NoticeRevisionInput = {
  status?: NotificationRevision['status'];
  confirmed?: boolean;
};

export type UserRole = 'student' | 'publisher' | 'admin';

export class Repository {
  readonly db: DatabaseSync;

  constructor(databasePath = process.env.DATABASE_PATH) {
    this.db = migrateDatabase(databasePath ?? undefined);
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }

  ensureUser(userId: string, role: UserRole = 'student'): void {
    const timestamp = now();
    this.db
      .prepare(
        'INSERT OR IGNORE INTO users (user_id, open_id, role, created_at) VALUES (?, ?, ?, ?)',
      )
      .run(userId, `dev:${userId}`, role, timestamp);
    this.db
      .prepare(
        'INSERT OR IGNORE INTO user_profiles (user_id, profile_json, updated_at) VALUES (?, ?, ?)',
      )
      .run(userId, json({}), timestamp);
  }

  setDevelopmentRole(userId: string, role: UserRole, requestId: string): void {
    this.ensureUser(userId);
    this.db.prepare('UPDATE users SET role = ? WHERE user_id = ?').run(role, userId);
    this.recordAudit(requestId, userId, 'auth.dev_role_set', 'user', userId, { role });
  }

  getUserRole(userId: string): UserRole | null {
    const row = this.db.prepare('SELECT role FROM users WHERE user_id = ?').get(userId) as
      Row | undefined;
    return row ? (row.role as UserRole) : null;
  }

  requireRole(userId: string, roles: UserRole[]): void {
    const role = this.getUserRole(userId);
    if (!role || !roles.includes(role))
      throw new RepositoryError('FORBIDDEN', 403, 'This operation requires publisher access');
  }

  getProfile(userId: string): PublicUserProfile {
    this.ensureUser(userId);
    const row = this.db
      .prepare('SELECT profile_json, updated_at FROM user_profiles WHERE user_id = ?')
      .get(userId) as Row;
    const profile: PublicUserProfile = {
      schema_version: 'user-profile/v1',
      profile_id: userId,
      ...parseJson<UserProfile>(row.profile_json),
      updated_at: text(row.updated_at),
    };
    const valid = validateUserProfile(profile);
    if (!valid.ok)
      throw new RepositoryError('DATA_CORRUPTION', 500, 'Stored profile failed schema validation');
    return valid.value;
  }

  exportUserData(userId: string): UserDataExport {
    const documents = (
      this.db
        .prepare(
          'SELECT * FROM documents WHERE owner_user_id = ? AND deleted_at IS NULL ORDER BY created_at',
        )
        .all(userId) as Row[]
    ).map(documentFromRow);
    const documentFiles = documents.flatMap((document) => {
      const file = this.getDocumentFile(userId, document.document_id);
      if (!file) return [];
      const content = this.getDocumentContent(userId, document.document_id);
      if (!content)
        throw new RepositoryError(
          'DATA_CORRUPTION',
          500,
          'Stored document file disappeared during export',
        );
      return [{ ...file, content_base64: Buffer.from(content).toString('base64') }];
    });
    const parseJobs = (
      this.db
        .prepare('SELECT parse_job_id FROM parse_jobs WHERE user_id = ? ORDER BY created_at')
        .all(userId) as Row[]
    ).map((row) => {
      const job = this.getParseJob(userId, text(row.parse_job_id));
      if (!job)
        throw new RepositoryError('DATA_CORRUPTION', 500, 'Parse job disappeared during export');
      return job;
    });
    const actions = (
      this.db
        .prepare('SELECT payload_json FROM verified_actions WHERE user_id = ? ORDER BY created_at')
        .all(userId) as Row[]
    ).map(actionFromRow);
    const tasks = (
      this.db
        .prepare('SELECT * FROM tasks WHERE user_id = ? ORDER BY created_at')
        .all(userId) as Row[]
    ).map(taskFromRow);
    const exported: UserDataExport = {
      schema_version: 'user-data-export/v1',
      user_id: userId,
      exported_at: now(),
      profile: this.getProfile(userId),
      documents,
      document_files: documentFiles,
      parse_jobs: parseJobs,
      actions,
      tasks,
    };
    const valid = validateUserDataExport(exported);
    if (!valid.ok)
      throw new RepositoryError(
        'DATA_CORRUPTION',
        500,
        valid.errors[0]?.message ?? 'Generated user data export failed schema validation',
      );
    return valid.value;
  }

  updateProfile(userId: string, profile: UserProfile, requestId?: string): PublicUserProfile {
    this.ensureUser(userId);
    const current = this.getProfile(userId);
    const {
      schema_version: _schemaVersion,
      profile_id: _profileId,
      updated_at: _updatedAt,
      ...currentFields
    } = current;
    const merged = { ...currentFields, ...profile };
    const updatedAt = now();
    const candidate: PublicUserProfile = {
      schema_version: 'user-profile/v1',
      profile_id: userId,
      ...merged,
      updated_at: updatedAt,
    };
    const valid = validateUserProfile(candidate);
    if (!valid.ok)
      throw new RepositoryError(
        'INVALID_PROFILE',
        400,
        valid.errors[0]?.message ?? 'Invalid user profile',
      );
    this.db
      .prepare('UPDATE user_profiles SET profile_json = ?, updated_at = ? WHERE user_id = ?')
      .run(json(merged), updatedAt, userId);
    if (requestId)
      this.recordAudit(requestId, userId, 'profile.updated', 'user', userId, {
        fields: Object.keys(profile).sort(),
      });
    return valid.value;
  }

  createDocument(input: CreateDocumentInput): Document {
    this.ensureUser(input.ownerUserId);
    if (
      input.sourceContent !== undefined &&
      input.contentType !== 'image/png' &&
      input.contentType !== 'image/jpeg' &&
      input.contentType !== 'application/pdf'
    )
      throw new RepositoryError(
        'INVALID_DOCUMENT',
        400,
        'Binary source content is only supported for image/png, image/jpeg, or application/pdf',
      );
    if (input.sourceContent !== undefined && input.sourceContent.byteLength === 0)
      throw new RepositoryError('INVALID_DOCUMENT', 400, 'Binary source content cannot be empty');
    const document: Document = {
      schema_version: 'document/v1',
      document_id: input.documentId ?? randomUUID(),
      owner_user_id: input.ownerUserId,
      title: input.title.trim(),
      content_type: input.contentType,
      text: input.text,
      content_sha256: createHash('sha256').update(input.text, 'utf8').digest('hex'),
      data_origin: input.dataOrigin ?? 'user_provided',
      created_at: now(),
    };
    const valid = validateDocument(document);
    if (!valid.ok)
      throw new RepositoryError(
        'INVALID_DOCUMENT',
        400,
        valid.errors[0]?.message ?? 'Invalid document',
      );
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          'INSERT INTO documents (document_id, owner_user_id, title, content_type, text, content_sha256, data_origin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          document.document_id,
          document.owner_user_id,
          document.title,
          document.content_type,
          document.text,
          document.content_sha256,
          document.data_origin,
          document.created_at,
        );
      if (input.sourceContent !== undefined) {
        this.db
          .prepare(
            'INSERT INTO document_files (document_id, content, content_type, byte_length, content_sha256, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .run(
            document.document_id,
            input.sourceContent,
            document.content_type,
            input.sourceContent.byteLength,
            sha256Bytes(input.sourceContent),
            document.created_at,
          );
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      if (String(error).includes('UNIQUE'))
        throw new RepositoryError('DOCUMENT_EXISTS', 409, 'Document already exists');
      throw error;
    }
    return document;
  }

  getDocumentFile(userId: string, documentId: string): DocumentFile | null {
    const document = this.getDocument(userId, documentId);
    if (!document) return null;
    const row = this.db
      .prepare(
        'SELECT document_id, content, content_type, byte_length, content_sha256, created_at FROM document_files WHERE document_id = ?',
      )
      .get(documentId) as Row | undefined;
    if (!row) return null;
    if (!(row.content instanceof Uint8Array))
      throw new RepositoryError('DATA_CORRUPTION', 500, 'Stored document file is not binary data');
    if (
      row.content_type !== document.content_type ||
      Number(row.byte_length) !== row.content.byteLength ||
      sha256Bytes(row.content) !== text(row.content_sha256)
    )
      throw new RepositoryError(
        'DATA_CORRUPTION',
        500,
        'Stored document file integrity check failed',
      );
    return {
      document_id: text(row.document_id),
      content_type: row.content_type as DocumentFile['content_type'],
      byte_length: Number(row.byte_length),
      content_sha256: text(row.content_sha256),
      created_at: text(row.created_at),
    };
  }

  getDocumentContent(userId: string, documentId: string): Uint8Array | null {
    const file = this.getDocumentFile(userId, documentId);
    if (!file) return null;
    const row = this.db
      .prepare('SELECT content FROM document_files WHERE document_id = ?')
      .get(documentId) as Row | undefined;
    if (!row || !(row.content instanceof Uint8Array)) return null;
    return new Uint8Array(row.content);
  }

  getDocument(userId: string, documentId: string): Document | null {
    const row = this.db
      .prepare(
        'SELECT * FROM documents WHERE document_id = ? AND owner_user_id = ? AND deleted_at IS NULL',
      )
      .get(documentId, userId) as Row | undefined;
    return row ? documentFromRow(row) : null;
  }

  deleteDocument(userId: string, documentId: string): boolean {
    const result = this.db
      .prepare(
        'UPDATE documents SET deleted_at = ? WHERE document_id = ? AND owner_user_id = ? AND deleted_at IS NULL',
      )
      .run(now(), documentId, userId);
    return Number(result.changes) === 1;
  }

  createParseJob(
    userId: string,
    documentId: string,
    requestId: string,
    idempotencyKey: string,
    requestHash: string,
  ): { parseJobId: string; existed: boolean } {
    const document = this.getDocument(userId, documentId);
    if (!document) throw new RepositoryError('DOCUMENT_NOT_FOUND', 404, 'Document not found');
    const existing = this.db
      .prepare(
        'SELECT parse_job_id, document_id, request_hash FROM parse_jobs WHERE user_id = ? AND idempotency_key = ?',
      )
      .get(userId, idempotencyKey) as Row | undefined;
    if (existing) {
      if (text(existing.document_id) !== documentId || text(existing.request_hash) !== requestHash)
        throw new RepositoryError(
          'IDEMPOTENCY_CONFLICT',
          409,
          'Idempotency key was reused with a different parse request',
        );
      return { parseJobId: text(existing.parse_job_id), existed: true };
    }
    const parseJobId = randomUUID();
    const timestamp = now();
    this.db
      .prepare(
        'INSERT INTO parse_jobs (parse_job_id, document_id, user_id, request_id, idempotency_key, request_hash, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        parseJobId,
        documentId,
        userId,
        requestId,
        idempotencyKey,
        requestHash,
        'queued',
        timestamp,
        timestamp,
      );
    return { parseJobId, existed: false };
  }

  getParseJob(userId: string, parseJobId: string): ParseJob | null {
    const row = this.db
      .prepare('SELECT * FROM parse_jobs WHERE parse_job_id = ? AND user_id = ?')
      .get(parseJobId, userId) as Row | undefined;
    if (!row) return null;
    const job: ParseJob = {
      schema_version: 'parse-job/v1',
      parse_job_id: text(row.parse_job_id),
      document_id: text(row.document_id),
      user_id: text(row.user_id),
      request_id: text(row.request_id),
      idempotency_key: text(row.idempotency_key),
      status: row.status as ParseJob['status'],
      result: row.result_json ? parseJson<TextParseResponse>(row.result_json) : null,
      error: row.error_json ? parseJson<ApiError['error']>(row.error_json) : null,
      created_at: text(row.created_at),
      updated_at: text(row.updated_at),
    };
    const valid = validateParseJob(job);
    if (!valid.ok)
      throw new RepositoryError(
        'DATA_CORRUPTION',
        500,
        'Stored parse job failed schema validation',
      );
    return valid.value;
  }

  startParseJob(userId: string, parseJobId: string, requestId: string): void {
    const result = this.db
      .prepare(
        "UPDATE parse_jobs SET status = 'running', updated_at = ? WHERE parse_job_id = ? AND user_id = ? AND status = 'queued'",
      )
      .run(now(), parseJobId, userId);
    if (Number(result.changes) !== 1)
      throw new RepositoryError('PARSE_JOB_NOT_FOUND', 404, 'Queued parse job not found');
    this.recordAudit(requestId, userId, 'parse_job.started', 'parse_job', parseJobId, {
      status: 'running',
    });
  }

  completeParseJob(
    userId: string,
    parseJobId: string,
    response: TextParseResponse,
    requestId: string,
  ): void {
    const job = this.db
      .prepare('SELECT * FROM parse_jobs WHERE parse_job_id = ? AND user_id = ?')
      .get(parseJobId, userId) as Row | undefined;
    if (!job) throw new RepositoryError('PARSE_JOB_NOT_FOUND', 404, 'Parse job not found');
    if (job.status !== 'running')
      throw new RepositoryError(
        'INVALID_STATE_TRANSITION',
        409,
        `Parse job in ${text(job.status)} state cannot be completed`,
      );
    if (
      text(job.document_id) !== response.document_id ||
      text(job.request_id) !== response.request_id
    )
      throw new RepositoryError(
        'PARSER_RESPONSE_INVALID',
        500,
        'Parser response identity does not match the parse job',
      );
    const validResponse = validateTextParseResponse(response);
    if (!validResponse.ok)
      throw new RepositoryError(
        'PARSER_RESPONSE_INVALID',
        500,
        'Parser response failed schema validation',
      );
    const persistedResponse = validResponse.value;
    const timestamp = now();
    const jobStatus = persistedResponse.status === 'rejected' ? 'failed' : persistedResponse.status;
    const storedError =
      persistedResponse.status === 'rejected'
        ? createApiError('PARSER_REJECTED', 'Parser rejected the document', requestId).error
        : null;
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          'UPDATE parse_jobs SET status = ?, result_json = ?, error_json = ?, updated_at = ? WHERE parse_job_id = ?',
        )
        .run(
          jobStatus,
          json(persistedResponse),
          storedError ? json(storedError) : null,
          timestamp,
          parseJobId,
        );
      for (const action of persistedResponse.verified_actions) {
        const valid = validateVerifiedActionObject(action);
        if (!valid.ok)
          throw new RepositoryError(
            'PARSER_RESPONSE_INVALID',
            500,
            'Parser response failed schema validation',
          );
        if (valid.value.document_id !== response.document_id) {
          throw new RepositoryError(
            'PARSER_RESPONSE_INVALID',
            500,
            'Parser action document_id does not match the parse job document',
          );
        }
        const existing = this.db
          .prepare('SELECT document_id, user_id FROM verified_actions WHERE action_id = ?')
          .get(valid.value.action_id) as Row | undefined;
        if (
          existing &&
          (text(existing.document_id) !== response.document_id || text(existing.user_id) !== userId)
        ) {
          throw new RepositoryError(
            'PARSER_RESPONSE_INVALID',
            500,
            'Parser action_id is already owned by another document or user',
          );
        }
        this.db
          .prepare(
            'INSERT INTO verified_actions (action_id, document_id, user_id, payload_json, result_stage, verification_status, task_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM verified_actions WHERE action_id = ?), ?), ?) ON CONFLICT(action_id) DO UPDATE SET payload_json = excluded.payload_json, result_stage = excluded.result_stage, verification_status = excluded.verification_status, task_status = excluded.task_status, updated_at = excluded.updated_at',
          )
          .run(
            action.action_id,
            action.document_id,
            userId,
            json(action),
            action.result_stage,
            action.verification_status,
            action.task_status,
            action.action_id,
            timestamp,
            timestamp,
          );
        replaceActionProjections(this.db, valid.value);
        this.db.prepare('DELETE FROM evidence WHERE action_id = ?').run(action.action_id);
        for (const evidence of action.evidence) {
          this.db
            .prepare(
              'INSERT INTO evidence (evidence_id, action_id, field_name, source_text, page_or_image, bounding_box_json, epistemic_status) VALUES (?, ?, ?, ?, ?, ?, ?)',
            )
            .run(
              evidence.evidence_id,
              action.action_id,
              evidence.field_name,
              evidence.source_text,
              evidence.page_or_image,
              evidence.bounding_box ? json(evidence.bounding_box) : null,
              evidence.epistemic_status,
            );
        }
        insertActionChanges(this.db, action);
      }
      if (persistedResponse.action_graph) {
        this.db
          .prepare(
            'INSERT OR REPLACE INTO action_graphs (graph_id, document_id, user_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?)',
          )
          .run(
            persistedResponse.action_graph.graph_id,
            persistedResponse.document_id,
            userId,
            json(persistedResponse.action_graph),
            timestamp,
          );
      }
      this.recordAudit(requestId, userId, 'parse_job.completed', 'parse_job', parseJobId, {
        status: persistedResponse.status,
      });
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  failParseJob(userId: string, parseJobId: string, error: unknown, requestId: string): void {
    const job = this.db
      .prepare('SELECT status FROM parse_jobs WHERE parse_job_id = ? AND user_id = ?')
      .get(parseJobId, userId) as Row | undefined;
    if (!job) throw new RepositoryError('PARSE_JOB_NOT_FOUND', 404, 'Parse job not found');
    if (job.status !== 'queued' && job.status !== 'running')
      throw new RepositoryError(
        'INVALID_STATE_TRANSITION',
        409,
        `Parse job in ${text(job.status)} state cannot be failed`,
      );
    const timestamp = now();
    const storedError = normalizedError(error, requestId);
    const result = this.db
      .prepare(
        'UPDATE parse_jobs SET status = ?, error_json = ?, updated_at = ? WHERE parse_job_id = ? AND user_id = ?',
      )
      .run('failed', json(storedError), timestamp, parseJobId, userId);
    if (Number(result.changes) !== 1)
      throw new RepositoryError('PARSE_JOB_NOT_FOUND', 404, 'Parse job not found');
    this.recordAudit(requestId, userId, 'parse_job.failed', 'parse_job', parseJobId, error);
  }

  listActions(userId: string, documentId: string): VerifiedActionObject[] {
    const rows = this.db
      .prepare(
        'SELECT payload_json FROM verified_actions WHERE user_id = ? AND document_id = ? ORDER BY created_at',
      )
      .all(userId, documentId) as Row[];
    return rows.map(actionFromRow);
  }

  getAction(userId: string, actionId: string): VerifiedActionObject | null {
    const row = this.db
      .prepare('SELECT payload_json FROM verified_actions WHERE user_id = ? AND action_id = ?')
      .get(userId, actionId) as Row | undefined;
    return row ? actionFromRow(row) : null;
  }

  confirmAction(
    userId: string,
    actionId: string,
    requestId: string,
    confirmed: boolean,
  ): VerifiedActionObject {
    if (!confirmed)
      throw new RepositoryError(
        'CONFIRMATION_REQUIRED',
        400,
        'Explicit user confirmation is required',
      );
    const action = this.getAction(userId, actionId);
    if (!action) throw new RepositoryError('ACTION_NOT_FOUND', 404, 'Action not found');
    if (action.verification_status === 'conflict')
      throw new RepositoryError(
        'INVALID_STATE_TRANSITION',
        409,
        'A rejected action cannot be confirmed again',
      );
    if (action.task_status !== 'pending')
      throw new RepositoryError(
        'INVALID_STATE_TRANSITION',
        409,
        `An action with task status ${action.task_status} cannot be confirmed`,
      );
    if (action.result_stage === 'user_confirmed' && action.verification_status === 'passed')
      return action;
    const changed: VerifiedActionObject = {
      ...action,
      confidence: { score: action.confidence.score, basis: 'user_confirmed' },
      result_stage: 'user_confirmed',
      verification_status: 'passed',
      change_history: [
        ...action.change_history,
        {
          change_id: randomUUID(),
          occurred_at: now(),
          actor: 'user',
          change_type: 'confirmed',
          reason: 'Explicit user confirmation',
        },
      ],
    };
    this.saveAction(userId, changed, requestId, 'action.confirmed');
    return changed;
  }

  rejectAction(
    userId: string,
    actionId: string,
    requestId: string,
    rejected: boolean,
  ): VerifiedActionObject {
    if (!rejected)
      throw new RepositoryError(
        'CONFIRMATION_REQUIRED',
        400,
        'Explicit rejection confirmation is required',
      );
    const action = this.getAction(userId, actionId);
    if (!action) throw new RepositoryError('ACTION_NOT_FOUND', 404, 'Action not found');
    if (action.verification_status === 'conflict' || action.task_status === 'cancelled')
      throw new RepositoryError(
        'INVALID_STATE_TRANSITION',
        409,
        'An already rejected or cancelled action cannot be rejected again',
      );
    if (action.task_status === 'completed')
      throw new RepositoryError(
        'INVALID_STATE_TRANSITION',
        409,
        'A completed action cannot be rejected',
      );
    const changed: VerifiedActionObject = {
      ...action,
      verification_status: 'conflict',
      task_status: 'cancelled',
      change_history: [
        ...action.change_history,
        {
          change_id: randomUUID(),
          occurred_at: now(),
          actor: 'user',
          change_type: 'corrected',
          reason: 'User rejected generated action',
        },
      ],
    };
    this.saveAction(userId, changed, requestId, 'action.rejected');
    return changed;
  }

  updateAction(
    userId: string,
    actionId: string,
    patch: Partial<
      Pick<VerifiedActionObject, 'title' | 'summary' | 'deadline' | 'required_materials'>
    >,
    requestId: string,
  ): VerifiedActionObject {
    const action = this.getAction(userId, actionId);
    if (!action) throw new RepositoryError('ACTION_NOT_FOUND', 404, 'Action not found');
    const changed = {
      ...action,
      ...patch,
      change_history: [
        ...action.change_history,
        {
          change_id: randomUUID(),
          occurred_at: now(),
          actor: 'user',
          change_type: 'corrected',
          reason: 'User edited action fields',
        },
      ],
    };
    const valid = validateVerifiedActionObject(changed);
    if (!valid.ok)
      throw new RepositoryError(
        'INVALID_ACTION',
        400,
        valid.errors[0]?.message ?? 'Invalid action',
      );
    this.saveAction(userId, valid.value, requestId, 'action.updated', {
      title: patch.title !== undefined,
      deadline: patch.deadline !== undefined,
    });
    return valid.value;
  }

  private saveAction(
    userId: string,
    action: VerifiedActionObject,
    requestId: string,
    eventType: string,
    syncTaskFields: { title: boolean; deadline: boolean } = {
      title: false,
      deadline: false,
    },
  ): void {
    const updatedAt = now();
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          'UPDATE verified_actions SET payload_json = ?, result_stage = ?, verification_status = ?, task_status = ?, updated_at = ? WHERE action_id = ? AND user_id = ?',
        )
        .run(
          json(action),
          action.result_stage,
          action.verification_status,
          action.task_status,
          updatedAt,
          action.action_id,
          userId,
        );
      replaceActionProjections(this.db, action);
      insertActionChanges(this.db, action);
      const activeTasks = this.db
        .prepare(
          "SELECT task_id, title, due_at, status FROM tasks WHERE action_id = ? AND user_id = ? AND status IN ('pending', 'in_progress')",
        )
        .all(action.action_id, userId) as Row[];
      for (const taskRow of activeTasks) {
        const taskId = text(taskRow.task_id);
        const previousStatus = taskRow.status as Task['status'];
        if (action.verification_status === 'conflict') {
          this.db
            .prepare(
              "UPDATE tasks SET status = 'cancelled', completed_at = NULL, updated_at = ? WHERE task_id = ? AND user_id = ?",
            )
            .run(updatedAt, taskId, userId);
          this.db
            .prepare(
              'INSERT INTO task_events (event_id, task_id, from_status, to_status, reason, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            )
            .run(
              randomUUID(),
              taskId,
              previousStatus,
              'cancelled',
              'Task cancelled because the linked action was rejected',
              requestId,
              updatedAt,
            );
          this.recordAudit(requestId, userId, 'task.cancelled_by_action', 'task', taskId, {
            action_id: action.action_id,
            from_status: previousStatus,
          });
        } else {
          const nextTitle = syncTaskFields.title ? action.title : text(taskRow.title);
          const nextDueAt = syncTaskFields.deadline
            ? action.deadline.value
            : taskRow.due_at === null
              ? null
              : text(taskRow.due_at);
          if (nextTitle === text(taskRow.title) && nextDueAt === (taskRow.due_at ?? null)) continue;
          this.db
            .prepare(
              'UPDATE tasks SET title = ?, due_at = ?, updated_at = ? WHERE task_id = ? AND user_id = ?',
            )
            .run(nextTitle, nextDueAt, updatedAt, taskId, userId);
          this.recordAudit(requestId, userId, 'task.synced_from_action', 'task', taskId, {
            action_id: action.action_id,
            title: syncTaskFields.title ? action.title : undefined,
            due_at: syncTaskFields.deadline ? action.deadline.value : undefined,
          });
        }
      }
      this.recordAudit(requestId, userId, eventType, 'action', action.action_id, {
        result_stage: action.result_stage,
      });
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  createTask(userId: string, actionId: string, title: string | undefined, requestId: string): Task {
    const action = this.getAction(userId, actionId);
    if (!action) throw new RepositoryError('ACTION_NOT_FOUND', 404, 'Action not found');
    if (action.result_stage !== 'user_confirmed' || action.verification_status !== 'passed') {
      throw new RepositoryError(
        'ACTION_CONFIRMATION_REQUIRED',
        409,
        'Only a confirmed and verified action can become a task',
      );
    }
    if (action.task_status !== 'pending')
      throw new RepositoryError(
        'INVALID_STATE_TRANSITION',
        409,
        `An action with task status ${action.task_status} cannot create a task`,
      );
    const activeTask = this.db
      .prepare(
        "SELECT task_id FROM tasks WHERE user_id = ? AND action_id = ? AND status IN ('pending', 'in_progress') LIMIT 1",
      )
      .get(userId, actionId) as Row | undefined;
    if (activeTask)
      throw new RepositoryError(
        'TASK_EXISTS',
        409,
        'A pending or in-progress task already exists for this action',
      );
    const timestamp = now();
    const task: Task = {
      schema_version: 'task/v1',
      task_id: randomUUID(),
      user_id: userId,
      action_id: action.action_id,
      document_id: action.document_id,
      title: title?.trim() || action.title,
      status: 'pending',
      due_at: action.deadline.value,
      created_at: timestamp,
      updated_at: timestamp,
      completed_at: null,
    };
    const valid = validateTask(task);
    if (!valid.ok)
      throw new RepositoryError('INVALID_TASK', 400, valid.errors[0]?.message ?? 'Invalid task');
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          'INSERT INTO tasks (task_id, user_id, action_id, document_id, title, status, due_at, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          task.task_id,
          task.user_id,
          task.action_id,
          task.document_id,
          task.title,
          task.status,
          task.due_at,
          task.completed_at,
          task.created_at,
          task.updated_at,
        );
      this.db
        .prepare(
          'INSERT INTO task_events (event_id, task_id, from_status, to_status, reason, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          randomUUID(),
          task.task_id,
          null,
          task.status,
          'Task created after user confirmation',
          requestId,
          timestamp,
        );
      this.recordAudit(requestId, userId, 'task.created', 'task', task.task_id, {
        action_id: actionId,
      });
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return task;
  }

  createManualTask(
    userId: string,
    documentId: string,
    title: string,
    dueAt: string | null,
    requestId: string,
  ): { action: VerifiedActionObject; task: Task } {
    const document = this.getDocument(userId, documentId);
    if (!document) throw new RepositoryError('DOCUMENT_NOT_FOUND', 404, 'Document not found');
    const timestamp = now();
    const actionId = `${documentId}:manual-action:${randomUUID()}`;
    const evidenceId = `${actionId}:evidence:manual`;
    const action: VerifiedActionObject = {
      schema_version: 'verified-action-object/v1',
      action_id: actionId,
      document_id: documentId,
      title: title.trim(),
      target_population: ['当前用户'],
      user_relevance: 'relevant',
      relevance_reason: '用户在解析降级后手动创建行动',
      action_type: 'manual_task',
      steps: [
        {
          step_id: `${actionId}:step:1`,
          instruction: title.trim(),
          epistemic_status: 'explicit',
          evidence_ids: [evidenceId],
        },
      ],
      dependencies: [],
      conditions: [],
      exceptions: [],
      deadline: {
        value: null,
        precision: 'unknown',
        boundary_semantics: 'unknown',
        epistemic_status: 'unknown',
        evidence_ids: [],
      },
      location: null,
      platform: null,
      entry_link: null,
      required_materials: [],
      consequence: null,
      obligation: 'unknown',
      evidence: [
        {
          evidence_id: evidenceId,
          source_text: title.trim(),
          page_or_image: 'manual:user-input',
          field_name: 'steps',
          epistemic_status: 'explicit',
        },
      ],
      confidence: { score: 1, basis: 'user_confirmed' },
      epistemic_status: 'explicit',
      field_status: {
        user_relevance: 'unknown',
        target_population: 'unknown',
        steps: 'explicit',
        deadline: 'unknown',
        required_materials: 'unknown',
        location: 'unknown',
        platform: 'unknown',
        conditions: 'unknown',
        exceptions: 'unknown',
      },
      result_stage: 'user_confirmed',
      verification_status: 'passed',
      task_status: 'pending',
      change_history: [
        {
          change_id: randomUUID(),
          occurred_at: timestamp,
          actor: 'user',
          change_type: 'created',
          reason: 'Manual task fallback after parser degradation',
        },
      ],
    };
    const validAction = validateVerifiedActionObject(action);
    if (!validAction.ok)
      throw new RepositoryError(
        'INVALID_ACTION',
        400,
        validAction.errors[0]?.message ?? 'Invalid manual action',
      );
    const task: Task = {
      schema_version: 'task/v1',
      task_id: randomUUID(),
      user_id: userId,
      action_id: actionId,
      document_id: documentId,
      title: title.trim(),
      status: 'pending',
      due_at: dueAt,
      created_at: timestamp,
      updated_at: timestamp,
      completed_at: null,
    };
    const validTask = validateTask(task);
    if (!validTask.ok)
      throw new RepositoryError(
        'INVALID_TASK',
        400,
        validTask.errors[0]?.message ?? 'Invalid manual task',
      );
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          'INSERT INTO verified_actions (action_id, document_id, user_id, payload_json, result_stage, verification_status, task_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          action.action_id,
          action.document_id,
          userId,
          json(action),
          action.result_stage,
          action.verification_status,
          action.task_status,
          timestamp,
          timestamp,
        );
      this.db
        .prepare(
          'INSERT INTO evidence (evidence_id, action_id, field_name, source_text, page_or_image, bounding_box_json, epistemic_status) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          evidenceId,
          action.action_id,
          'steps',
          title.trim(),
          'manual:user-input',
          null,
          'explicit',
        );
      insertActionChanges(this.db, action);
      this.db
        .prepare(
          'INSERT INTO tasks (task_id, user_id, action_id, document_id, title, status, due_at, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          task.task_id,
          task.user_id,
          task.action_id,
          task.document_id,
          task.title,
          task.status,
          task.due_at,
          task.completed_at,
          task.created_at,
          task.updated_at,
        );
      this.db
        .prepare(
          'INSERT INTO task_events (event_id, task_id, from_status, to_status, reason, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          randomUUID(),
          task.task_id,
          null,
          task.status,
          'Manual task fallback after parser degradation',
          requestId,
          timestamp,
        );
      this.recordAudit(requestId, userId, 'manual_task.created', 'task', task.task_id, {
        document_id: documentId,
        action_id: actionId,
      });
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return { action: validAction.value, task: validTask.value };
  }

  listTasks(userId: string): Task[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM tasks WHERE user_id = ? ORDER BY CASE WHEN status = 'completed' THEN 1 ELSE 0 END, due_at IS NULL, due_at",
        )
        .all(userId) as Row[]
    ).map(taskFromRow);
  }

  getTask(userId: string, taskId: string): Task | null {
    const row = this.db
      .prepare('SELECT * FROM tasks WHERE task_id = ? AND user_id = ?')
      .get(taskId, userId) as Row | undefined;
    return row ? taskFromRow(row) : null;
  }

  updateTask(
    userId: string,
    taskId: string,
    patch: { title?: string; status?: Task['status']; due_at?: string | null },
    requestId: string,
  ): Task {
    const task = this.getTask(userId, taskId);
    if (!task) throw new RepositoryError('TASK_NOT_FOUND', 404, 'Task not found');
    const status = patch.status ?? task.status;
    const allowed: Record<Task['status'], Task['status'][]> = {
      pending: ['pending', 'in_progress', 'cancelled', 'expired'],
      in_progress: ['in_progress', 'completed', 'cancelled', 'expired'],
      completed: ['completed'],
      expired: ['expired', 'cancelled'],
      cancelled: ['cancelled'],
    };
    if (!allowed[task.status].includes(status))
      throw new RepositoryError(
        'INVALID_STATE_TRANSITION',
        409,
        `Cannot change task from ${task.status} to ${status}`,
      );
    const updatedAt = now();
    const completedAt = status === 'completed' ? (task.completed_at ?? updatedAt) : null;
    const changed: Task = {
      ...task,
      title: patch.title?.trim() || task.title,
      due_at: patch.due_at === undefined ? task.due_at : patch.due_at,
      status,
      completed_at: completedAt,
      updated_at: updatedAt,
    };
    const valid = validateTask(changed);
    if (!valid.ok)
      throw new RepositoryError('INVALID_TASK', 400, valid.errors[0]?.message ?? 'Invalid task');
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          'UPDATE tasks SET title = ?, status = ?, due_at = ?, completed_at = ?, updated_at = ? WHERE task_id = ? AND user_id = ?',
        )
        .run(
          changed.title,
          changed.status,
          changed.due_at,
          changed.completed_at,
          changed.updated_at,
          taskId,
          userId,
        );
      const action = this.getAction(userId, task.action_id);
      if (action) {
        this.db
          .prepare(
            'UPDATE verified_actions SET payload_json = ?, task_status = ?, updated_at = ? WHERE action_id = ? AND user_id = ?',
          )
          .run(
            json({ ...action, task_status: changed.status }),
            changed.status,
            updatedAt,
            task.action_id,
            userId,
          );
      }
      this.db
        .prepare(
          'INSERT INTO task_events (event_id, task_id, from_status, to_status, reason, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          randomUUID(),
          taskId,
          task.status,
          changed.status,
          'User-authorized task update',
          requestId,
          updatedAt,
        );
      this.recordAudit(requestId, userId, 'task.updated', 'task', taskId, {
        from_status: task.status,
        to_status: changed.status,
      });
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return changed;
  }

  createNotice(
    userId: string,
    title: string,
    body: string,
    requestId: string,
  ): NotificationRevision {
    this.requireRole(userId, ['publisher', 'admin']);
    const noticeId = randomUUID();
    const revisionId = randomUUID();
    const createdAt = now();
    const revision: NotificationRevision = {
      schema_version: 'notification-revision/v1',
      notice_id: noticeId,
      revision_id: revisionId,
      revision_number: 1,
      status: 'draft',
      title: title.trim(),
      body,
      created_at: createdAt,
      published_at: null,
    };
    const valid = validateNotificationRevision(revision);
    if (!valid.ok)
      throw new RepositoryError(
        'INVALID_NOTICE',
        400,
        valid.errors[0]?.message ?? 'Invalid notice',
      );
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          'INSERT INTO notices (notice_id, publisher_user_id, title, current_revision_id, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(noticeId, userId, revision.title, revisionId, createdAt);
      this.db
        .prepare(
          'INSERT INTO notification_revisions (revision_id, notice_id, revision_number, status, title, body, created_at, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          revisionId,
          noticeId,
          1,
          revision.status,
          revision.title,
          revision.body,
          createdAt,
          null,
        );
      this.recordAudit(requestId, userId, 'notice.created', 'notice', noticeId, {
        revision_id: revisionId,
      });
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return revision;
  }

  getNotice(
    userId: string,
    noticeId: string,
  ): {
    notice_id: string;
    publisher_user_id: string;
    current_revision_id: string;
    revisions: NotificationRevision[];
  } | null {
    const notice = this.db
      .prepare('SELECT * FROM notices WHERE notice_id = ? AND publisher_user_id = ?')
      .get(noticeId, userId) as Row | undefined;
    if (!notice) return null;
    const revisions = (
      this.db
        .prepare(
          'SELECT * FROM notification_revisions WHERE notice_id = ? ORDER BY revision_number',
        )
        .all(noticeId) as Row[]
    ).map(revisionFromRow);
    return {
      notice_id: noticeId,
      publisher_user_id: userId,
      current_revision_id: text(notice.current_revision_id),
      revisions,
    };
  }

  publishNotice(
    userId: string,
    noticeId: string,
    requestId: string,
    confirmed: boolean,
  ): NotificationRevision {
    if (!confirmed)
      throw new RepositoryError(
        'CONFIRMATION_REQUIRED',
        400,
        'Publishing requires explicit confirmation',
      );
    const notice = this.getNotice(userId, noticeId);
    if (!notice) throw new RepositoryError('NOTICE_NOT_FOUND', 404, 'Notice not found');
    const revision = notice.revisions.at(-1);
    if (!revision) throw new RepositoryError('NOTICE_NOT_FOUND', 404, 'Notice revision not found');
    if (revision.status !== 'draft')
      throw new RepositoryError(
        'NOTICE_REVISION_NOT_DRAFT',
        409,
        'Only a draft notice revision can be published',
      );
    const publishedAt = now();
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          'UPDATE notification_revisions SET status = ?, published_at = ? WHERE revision_id = ?',
        )
        .run('published', publishedAt, revision.revision_id);
      const published = { ...revision, status: 'published' as const, published_at: publishedAt };
      this.recordAudit(requestId, userId, 'notice.published', 'notice', noticeId, {
        revision_id: revision.revision_id,
      });
      this.syncNoticeTasks(noticeId, published, requestId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return { ...revision, status: 'published', published_at: publishedAt };
  }

  private syncNoticeTasks(
    noticeId: string,
    revision: NotificationRevision,
    requestId: string,
  ): void {
    if (revision.status === 'draft') return;
    const changeType: NoticeTaskSyncChangeType =
      revision.status === 'postponed'
        ? 'postponed'
        : revision.status === 'revoked'
          ? 'revoked'
          : 'replaced';
    const reason =
      revision.status === 'postponed'
        ? 'Published notice revision postpones an existing task-linked notice'
        : revision.status === 'revoked'
          ? 'Published notice revision revokes an existing task-linked notice'
          : 'Published notice revision replaces an existing task-linked notice';
    const links = this.db
      .prepare(
        'SELECT link_id, notice_id, task_id, revision_id, status, linked_at FROM notice_task_links WHERE notice_id = ? AND status = ? AND revision_id <> ?',
      )
      .all(noticeId, 'active', revision.revision_id) as Row[];
    for (const linkRow of links) {
      const link = noticeTaskLinkFromRow(linkRow);
      this.db
        .prepare(
          'INSERT INTO notice_task_sync_events (sync_event_id, link_id, from_revision_id, to_revision_id, change_type, status, reason, request_id, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          randomUUID(),
          link.link_id,
          link.revision_id,
          revision.revision_id,
          changeType,
          'pending_review',
          reason,
          requestId,
          now(),
          null,
        );
      this.db
        .prepare('UPDATE notice_task_links SET revision_id = ? WHERE link_id = ?')
        .run(revision.revision_id, link.link_id);
      this.recordAudit(requestId, null, 'notice.task_sync_pending', 'task', link.task_id, {
        notice_id: noticeId,
        from_revision_id: link.revision_id,
        to_revision_id: revision.revision_id,
        change_type: changeType,
      });
    }
  }

  createRevision(
    userId: string,
    noticeId: string,
    title: string,
    body: string,
    requestId: string,
    options: NoticeRevisionInput = {},
  ): NotificationRevision {
    const notice = this.getNotice(userId, noticeId);
    if (!notice) throw new RepositoryError('NOTICE_NOT_FOUND', 404, 'Notice not found');
    const status = options.status ?? 'draft';
    if (status === 'published')
      throw new RepositoryError(
        'INVALID_NOTICE',
        400,
        'Use the publish endpoint for a published revision',
      );
    if (status !== 'draft' && options.confirmed !== true)
      throw new RepositoryError(
        'CONFIRMATION_REQUIRED',
        400,
        'Postponing or revoking a notice requires explicit confirmation',
      );
    const createdAt = now();
    const publishedAt = status === 'draft' ? null : createdAt;
    const revision: NotificationRevision = {
      schema_version: 'notification-revision/v1',
      notice_id: noticeId,
      revision_id: randomUUID(),
      revision_number: notice.revisions.length + 1,
      status,
      title: title.trim(),
      body,
      created_at: createdAt,
      published_at: publishedAt,
    };
    const valid = validateNotificationRevision(revision);
    if (!valid.ok)
      throw new RepositoryError(
        'INVALID_NOTICE',
        400,
        valid.errors[0]?.message ?? 'Invalid notice',
      );
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          'INSERT INTO notification_revisions (revision_id, notice_id, revision_number, status, title, body, created_at, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          revision.revision_id,
          noticeId,
          revision.revision_number,
          revision.status,
          revision.title,
          revision.body,
          createdAt,
          publishedAt,
        );
      this.db
        .prepare('UPDATE notices SET current_revision_id = ?, title = ? WHERE notice_id = ?')
        .run(revision.revision_id, revision.title, noticeId);
      this.recordAudit(requestId, userId, 'notice.revised', 'notice', noticeId, {
        revision_id: revision.revision_id,
        status,
      });
      this.syncNoticeTasks(noticeId, revision, requestId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return revision;
  }

  linkTaskToNotice(
    userId: string,
    taskId: string,
    noticeId: string,
    requestId: string,
    confirmed: boolean,
  ): NoticeTaskLink {
    if (!confirmed)
      throw new RepositoryError(
        'CONFIRMATION_REQUIRED',
        400,
        'Linking a notice to a task requires explicit confirmation',
      );
    const task = this.getTask(userId, taskId);
    if (!task) throw new RepositoryError('TASK_NOT_FOUND', 404, 'Task not found');
    const notice = this.db
      .prepare('SELECT notice_id FROM notices WHERE notice_id = ?')
      .get(noticeId) as Row | undefined;
    if (!notice) throw new RepositoryError('NOTICE_NOT_FOUND', 404, 'Notice not found');
    const revision = this.db
      .prepare(
        'SELECT * FROM notification_revisions WHERE notice_id = ? AND status = ? ORDER BY revision_number DESC LIMIT 1',
      )
      .get(noticeId, 'published') as Row | undefined;
    if (!revision)
      throw new RepositoryError(
        'NOTICE_NOT_PUBLISHED',
        409,
        'A task can only link to a published notice revision',
      );
    const existing = this.db
      .prepare('SELECT * FROM notice_task_links WHERE notice_id = ? AND task_id = ?')
      .get(noticeId, taskId) as Row | undefined;
    if (existing)
      throw new RepositoryError('NOTICE_TASK_LINK_EXISTS', 409, 'Task is already linked to notice');
    const link: NoticeTaskLink = {
      link_id: randomUUID(),
      notice_id: noticeId,
      task_id: taskId,
      revision_id: text(revision.revision_id),
      status: 'active',
      linked_at: now(),
    };
    this.db
      .prepare(
        'INSERT INTO notice_task_links (link_id, notice_id, task_id, revision_id, status, linked_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        link.link_id,
        link.notice_id,
        link.task_id,
        link.revision_id,
        link.status,
        link.linked_at,
      );
    this.recordAudit(requestId, userId, 'task.notice_linked', 'task', taskId, {
      notice_id: noticeId,
      revision_id: link.revision_id,
    });
    return link;
  }

  listNoticeTaskSync(
    userId: string,
    taskId: string,
  ): Array<NoticeTaskLink & { events: NoticeTaskSyncEvent[] }> {
    const task = this.getTask(userId, taskId);
    if (!task) throw new RepositoryError('TASK_NOT_FOUND', 404, 'Task not found');
    const links = this.db
      .prepare(
        'SELECT link_id, notice_id, task_id, revision_id, status, linked_at FROM notice_task_links WHERE task_id = ? ORDER BY linked_at',
      )
      .all(taskId) as Row[];
    return links.map((row) => {
      const link = noticeTaskLinkFromRow(row);
      const events = this.db
        .prepare('SELECT * FROM notice_task_sync_events WHERE link_id = ? ORDER BY created_at')
        .all(link.link_id) as Row[];
      return { ...link, events: events.map(noticeTaskSyncEventFromRow) };
    });
  }

  resolveNoticeTaskSync(
    userId: string,
    taskId: string,
    syncEventId: string,
    decision: 'accept' | 'reject',
    confirmed: boolean,
    requestId: string,
  ): { sync: NoticeTaskSyncEvent; task: Task } {
    if (!confirmed)
      throw new RepositoryError(
        'CONFIRMATION_REQUIRED',
        400,
        'Resolving a notice task change requires explicit confirmation',
      );
    const task = this.getTask(userId, taskId);
    if (!task) throw new RepositoryError('TASK_NOT_FOUND', 404, 'Task not found');
    const eventRow = this.db
      .prepare(
        'SELECT e.* FROM notice_task_sync_events e JOIN notice_task_links l ON l.link_id = e.link_id WHERE e.sync_event_id = ? AND l.task_id = ? AND l.status = ?',
      )
      .get(syncEventId, taskId, 'active') as Row | undefined;
    if (!eventRow)
      throw new RepositoryError('SYNC_EVENT_NOT_FOUND', 404, 'Notice task sync event not found');
    if (eventRow.status !== 'pending_review')
      throw new RepositoryError(
        'SYNC_EVENT_NOT_PENDING',
        409,
        'Notice task sync event is already resolved',
      );
    const resolvedStatus: NoticeTaskSyncStatus = decision === 'accept' ? 'accepted' : 'rejected';
    const resolvedAt = now();
    let changedTask = task;
    this.db.exec('BEGIN');
    try {
      if (
        decision === 'accept' &&
        eventRow.change_type === 'revoked' &&
        (task.status === 'pending' || task.status === 'in_progress')
      ) {
        const cancelled: Task = {
          ...task,
          status: 'cancelled',
          completed_at: null,
          updated_at: resolvedAt,
        };
        const valid = validateTask(cancelled);
        if (!valid.ok)
          throw new RepositoryError(
            'INVALID_TASK',
            400,
            valid.errors[0]?.message ?? 'Invalid task',
          );
        this.db
          .prepare(
            'UPDATE tasks SET status = ?, completed_at = ?, updated_at = ? WHERE task_id = ? AND user_id = ?',
          )
          .run(cancelled.status, null, cancelled.updated_at, taskId, userId);
        const action = this.getAction(userId, task.action_id);
        if (action && action.task_status !== 'cancelled') {
          const changedAction: VerifiedActionObject = {
            ...action,
            task_status: 'cancelled',
            change_history: [
              ...action.change_history,
              {
                change_id: randomUUID(),
                occurred_at: resolvedAt,
                actor: 'system',
                change_type: 'revoked',
                reason: 'User accepted a linked notice revocation',
              },
            ],
          };
          this.db
            .prepare(
              'UPDATE verified_actions SET payload_json = ?, task_status = ?, updated_at = ? WHERE action_id = ? AND user_id = ?',
            )
            .run(
              json(changedAction),
              changedAction.task_status,
              resolvedAt,
              action.action_id,
              userId,
            );
          insertActionChanges(this.db, changedAction);
        }
        this.db
          .prepare(
            'INSERT INTO task_events (event_id, task_id, from_status, to_status, reason, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            randomUUID(),
            taskId,
            task.status,
            'cancelled',
            'User accepted a linked notice revocation',
            requestId,
            resolvedAt,
          );
        changedTask = cancelled;
      }
      this.db
        .prepare(
          'UPDATE notice_task_sync_events SET status = ?, resolved_at = ? WHERE sync_event_id = ?',
        )
        .run(resolvedStatus, resolvedAt, syncEventId);
      this.recordAudit(requestId, userId, `notice.task_sync_${decision}`, 'task', taskId, {
        sync_event_id: syncEventId,
        change_type: eventRow.change_type,
      });
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    const resolved = this.db
      .prepare('SELECT * FROM notice_task_sync_events WHERE sync_event_id = ?')
      .get(syncEventId) as Row;
    return { sync: noticeTaskSyncEventFromRow(resolved), task: changedTask };
  }

  addFeedback(
    userId: string,
    actionId: string | undefined,
    kind: string,
    message: string,
    requestId: string,
  ): { feedback_id: string } {
    if (actionId && !this.getAction(userId, actionId))
      throw new RepositoryError('ACTION_NOT_FOUND', 404, 'Action not found');
    const feedbackId = randomUUID();
    this.db
      .prepare(
        'INSERT INTO feedback (feedback_id, user_id, action_id, kind, message, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(feedbackId, userId, actionId ?? null, kind, message, now());
    this.recordAudit(requestId, userId, 'feedback.created', 'feedback', feedbackId, {
      action_id: actionId ?? null,
    });
    return { feedback_id: feedbackId };
  }

  getIdempotency(
    userId: string,
    scope: string,
    key: string,
    requestHash: string,
  ): { status: number; body: unknown } | 'conflict' | null {
    const row = this.db
      .prepare(
        'SELECT request_hash, response_status, response_json FROM idempotency_keys WHERE user_id = ? AND scope = ? AND idempotency_key = ?',
      )
      .get(userId, scope, key) as Row | undefined;
    if (!row) return null;
    if (text(row.request_hash) !== requestHash) return 'conflict';
    return { status: Number(row.response_status), body: parseJson<unknown>(row.response_json) };
  }

  saveIdempotency(
    userId: string,
    scope: string,
    key: string,
    requestHash: string,
    status: number,
    body: unknown,
  ): void {
    this.db
      .prepare(
        'INSERT INTO idempotency_keys (user_id, scope, idempotency_key, request_hash, response_status, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(userId, scope, key, requestHash, status, json(body), now());
  }

  recordAudit(
    requestId: string,
    actorUserId: string | null,
    eventType: string,
    entityType: string,
    entityId: string,
    detail: unknown,
  ): void {
    this.db
      .prepare(
        'INSERT INTO audit_events (audit_event_id, request_id, actor_user_id, event_type, entity_type, entity_id, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        randomUUID(),
        requestId,
        actorUserId,
        eventType,
        entityType,
        entityId,
        json(detail),
        now(),
      );
  }
}
