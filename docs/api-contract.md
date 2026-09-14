# API contract

Every response includes `x-request-id`. Errors use `{ "error": { "code", "message", "requestId", "retryable" } }`. State-changing POST operations require `Idempotency-Key`; a replay returns the original response, while reuse with a different request is a `409 IDEMPOTENCY_CONFLICT`. Soft-deleting a document, confirming/rejecting an action, completing a task and publishing a notice all require an explicit confirmation body. Development login is available only outside `APP_ENV=production`.

The executable route surface is implemented in `services/api/src/server.ts`; the core proof covers login/profile, document creation/upload/read/delete, parse jobs, actions, tasks, notices and feedback.
