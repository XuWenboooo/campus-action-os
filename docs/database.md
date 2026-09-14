# Database

Action mutations also append immutable records to `action_change_history`; this is separate from the serialized VAO projection and the general audit log.

Run `npm.cmd run db:migrate`. The migration creates source (`documents`), derived (`parse_jobs`, `verified_actions`, `evidence`, `action_graphs`), user side effects (`tasks`, `task_events`), publishing (`notices`, `notification_revisions`), feedback, audit and idempotency tables. Foreign keys and indexes are enabled. Tests use `:memory:` and production/experiment files are intentionally separate.
