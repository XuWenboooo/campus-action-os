# Database

Action mutations also append immutable records to `action_change_history`; this is separate from the serialized VAO projection and the general audit log.

Run `npm.cmd run db:migrate`. The migration creates source (`documents`, `document_files`), derived (`parse_jobs`, `verified_actions`, `evidence`, `action_graphs`), user side effects (`tasks`, `task_events`), publishing (`notices`, `notification_revisions`), notice-to-task links and auditable sync events, feedback, audit and idempotency tables. Parse jobs persist an internal request hash so reusing an idempotency key with a different parse request is rejected. `document_files` stores bounded image/PDF bytes separately from the public Document projection and is deleted with its document. Foreign keys and indexes are enabled. Tests use `:memory:` and production/experiment files are intentionally separate. A published notice revision creates a pending sync proposal; it never silently mutates a Task.
