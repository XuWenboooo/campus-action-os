import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { migrateDatabase } from '../../../database/migrate.js';
import {
  validateDocument,
  validateNotificationRevision,
  validateTask,
  validateVerifiedActionObject,
  type Document,
  type NotificationRevision,
  type PublicUserProfile,
  type Task,
  type TextParseResponse,
  type UserProfile,
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

function now(): string {
  return new Date().toISOString();
}

function documentFromRow(row: Row): Document {
  return {
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
}

function actionFromRow(row: Row): VerifiedActionObject {
  return parseJson<VerifiedActionObject>(row.payload_json);
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

export type CreateDocumentInput = {
  documentId?: string;
  ownerUserId: string;
  title: string;
  contentType: Document['content_type'];
  text: string;
  dataOrigin?: Document['data_origin'];
};

export class Repository {
  readonly db: DatabaseSync;

  constructor(databasePath = process.env.DATABASE_PATH) {
    this.db = migrateDatabase(databasePath ?? undefined);
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }

  ensureUser(userId: string, role: 'student' | 'publisher' | 'admin' = 'student'): void {
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

  getProfile(userId: string): PublicUserProfile {
    this.ensureUser(userId);
    const row = this.db
      .prepare('SELECT profile_json, updated_at FROM user_profiles WHERE user_id = ?')
      .get(userId) as Row;
    return {
      schema_version: 'user-profile/v1',
      profile_id: userId,
      ...parseJson<UserProfile>(row.profile_json),
      updated_at: text(row.updated_at),
    };
  }

  updateProfile(userId: string, profile: UserProfile): PublicUserProfile {
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
    this.db
      .prepare('UPDATE user_profiles SET profile_json = ?, updated_at = ? WHERE user_id = ?')
      .run(json(merged), updatedAt, userId);
    return {
      schema_version: 'user-profile/v1',
      profile_id: userId,
      ...merged,
      updated_at: updatedAt,
    };
  }

  createDocument(input: CreateDocumentInput): Document {
    this.ensureUser(input.ownerUserId);
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
    } catch (error) {
      if (String(error).includes('UNIQUE'))
        throw new RepositoryError('DOCUMENT_EXISTS', 409, 'Document already exists');
      throw error;
    }
    return document;
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
  ): { parseJobId: string; existed: boolean } {
    const document = this.getDocument(userId, documentId);
    if (!document) throw new RepositoryError('DOCUMENT_NOT_FOUND', 404, 'Document not found');
    const existing = this.db
      .prepare('SELECT parse_job_id FROM parse_jobs WHERE user_id = ? AND idempotency_key = ?')
      .get(userId, idempotencyKey) as Row | undefined;
    if (existing) {
      const same = this.db
        .prepare('SELECT document_id FROM parse_jobs WHERE parse_job_id = ?')
        .get(String(existing.parse_job_id)) as Row;
      if (text(same.document_id) !== documentId)
        throw new RepositoryError(
          'IDEMPOTENCY_CONFLICT',
          409,
          'Idempotency key is bound to another document',
        );
      return { parseJobId: text(existing.parse_job_id), existed: true };
    }
    const parseJobId = randomUUID();
    const timestamp = now();
    this.db
      .prepare(
        'INSERT INTO parse_jobs (parse_job_id, document_id, user_id, request_id, idempotency_key, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        parseJobId,
        documentId,
        userId,
        requestId,
        idempotencyKey,
        'queued',
        timestamp,
        timestamp,
      );
    return { parseJobId, existed: false };
  }

  getParseJob(userId: string, parseJobId: string): Row | null {
    const row = this.db
      .prepare('SELECT * FROM parse_jobs WHERE parse_job_id = ? AND user_id = ?')
      .get(parseJobId, userId) as Row | undefined;
    if (!row) return null;
    return {
      schema_version: 'parse-job/v1',
      parse_job_id: text(row.parse_job_id),
      document_id: text(row.document_id),
      user_id: text(row.user_id),
      request_id: text(row.request_id),
      idempotency_key: text(row.idempotency_key),
      status: row.status,
      result: row.result_json ? parseJson<TextParseResponse>(row.result_json) : null,
      error: row.error_json ? parseJson<unknown>(row.error_json) : null,
      created_at: text(row.created_at),
      updated_at: text(row.updated_at),
    };
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
    const timestamp = now();
    const jobStatus = response.status === 'rejected' ? 'failed' : response.status;
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          'UPDATE parse_jobs SET status = ?, result_json = ?, error_json = NULL, updated_at = ? WHERE parse_job_id = ?',
        )
        .run(jobStatus, json(response), timestamp, parseJobId);
      for (const action of response.verified_actions) {
        const valid = validateVerifiedActionObject(action);
        if (!valid.ok)
          throw new RepositoryError(
            'PARSER_RESPONSE_INVALID',
            500,
            'Parser response failed schema validation',
          );
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
      }
      if (response.action_graph) {
        this.db
          .prepare(
            'INSERT OR REPLACE INTO action_graphs (graph_id, document_id, user_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?)',
          )
          .run(
            response.action_graph.graph_id,
            response.document_id,
            userId,
            json(response.action_graph),
            timestamp,
          );
      }
      this.recordAudit(requestId, userId, 'parse_job.completed', 'parse_job', parseJobId, {
        status: response.status,
      });
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  failParseJob(userId: string, parseJobId: string, error: unknown, requestId: string): void {
    const timestamp = now();
    const storedError =
      typeof error === 'object' && error !== null && 'error' in error
        ? (error as { error: unknown }).error
        : error;
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
    this.saveAction(userId, valid.value, requestId, 'action.updated');
    return valid.value;
  }

  private saveAction(
    userId: string,
    action: VerifiedActionObject,
    requestId: string,
    eventType: string,
  ): void {
    this.db
      .prepare(
        'UPDATE verified_actions SET payload_json = ?, result_stage = ?, verification_status = ?, task_status = ?, updated_at = ? WHERE action_id = ? AND user_id = ?',
      )
      .run(
        json(action),
        action.result_stage,
        action.verification_status,
        action.task_status,
        now(),
        action.action_id,
        userId,
      );
    this.recordAudit(requestId, userId, eventType, 'action', action.action_id, {
      result_stage: action.result_stage,
    });
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
    this.ensureUser(userId, 'publisher');
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
    ).map((row) => ({
      schema_version: 'notification-revision/v1' as const,
      notice_id: text(row.notice_id),
      revision_id: text(row.revision_id),
      revision_number: Number(row.revision_number),
      status: row.status as NotificationRevision['status'],
      title: text(row.title),
      body: text(row.body),
      created_at: text(row.created_at),
      published_at: row.published_at === null ? null : text(row.published_at),
    }));
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
    const publishedAt = now();
    this.db
      .prepare(
        'UPDATE notification_revisions SET status = ?, published_at = ? WHERE revision_id = ?',
      )
      .run('published', publishedAt, revision.revision_id);
    this.recordAudit(requestId, userId, 'notice.published', 'notice', noticeId, {
      revision_id: revision.revision_id,
    });
    return { ...revision, status: 'published', published_at: publishedAt };
  }

  createRevision(
    userId: string,
    noticeId: string,
    title: string,
    body: string,
    requestId: string,
  ): NotificationRevision {
    const notice = this.getNotice(userId, noticeId);
    if (!notice) throw new RepositoryError('NOTICE_NOT_FOUND', 404, 'Notice not found');
    const createdAt = now();
    const revision: NotificationRevision = {
      schema_version: 'notification-revision/v1',
      notice_id: noticeId,
      revision_id: randomUUID(),
      revision_number: notice.revisions.length + 1,
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
          null,
        );
      this.db
        .prepare('UPDATE notices SET current_revision_id = ?, title = ? WHERE notice_id = ?')
        .run(revision.revision_id, revision.title, noticeId);
      this.recordAudit(requestId, userId, 'notice.revised', 'notice', noticeId, {
        revision_id: revision.revision_id,
      });
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return revision;
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
