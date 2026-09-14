# API contract

Every response includes `x-request-id`. Errors use `{ "error": { "code", "message", "requestId", "retryable" } }`. POST operations that create or parse state require `Idempotency-Key`; reuse with a different request is a `409 IDEMPOTENCY_CONFLICT`. Development login is available only outside `APP_ENV=production`.

The executable route surface is implemented in `services/api/src/server.ts`; the core proof covers login/profile, document creation/upload/read/delete, parse jobs, actions, tasks, notices and feedback.
