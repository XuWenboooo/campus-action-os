# M2 text parsing interface boundary

Status: frozen engineering interface checkpoint, `text-parse-request/v1`, `document-assessment/v1`, and `text-parse-response/v1`.

This document defines an integration contract only. It does not claim that real AI parsing,
product persistence, or a production endpoint is implemented.

## Call chain

```text
student client -> product API -> POST /internal/v1/parse-text
               -> AI parser -> Verified Action Object[]
               -> product API validates and stores raw result
               -> user reviews and explicitly confirms
               -> product API creates a task and updates reminders
```

The shared `@campus-action-os/protocol` package is the only source of request, response, VAO,
and Action Graph types. Neither owner copies those definitions.

## Responsibilities

| Boundary    | Owns                                                                                                                                               | Must not do                                                                                                                   |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Product API | document ID, original text, minimal profile, parse job, parser call, protocol validation, raw parser result, confirmation, task and reminder state | parse campus notices, invent missing AI fields, create a task before explicit confirmation                                    |
| AI parser   | relevance assessment, action extraction, Action Graph construction, evidence binding, uncertainty/conflict/rejection, parser metadata              | access product DB, persist tasks, send reminders, execute registration/payment/submission, accept model settings from product |
| Integration | schemas, shared types/validators, errors, deterministic mock, fixtures, contract tests, E2E harness, compatibility and release checks              | real model calls, prompts/extraction algorithms, formal experiments, changes to M1 VAO/Graph schemas                          |

## Endpoint and transport

`POST /internal/v1/parse-text` accepts JSON `TextParseRequest` and returns a validated
`TextParseResponse`, or the standard `ApiError` envelope. The current repository provides the
contract and development mock; `services/api` and `services/ai-parser` remain owner boundaries.

Only `text/plain` is accepted. Screenshots, PDFs, URLs, and opaque content are rejected rather
than treated as text. The request carries a UTF-8 SHA-256 content hash and an idempotency key.

## Privacy boundary

The profile is minimal and may contain only education level, grade, college, major, campus,
student categories, and organization memberships. It must not contain names, student IDs,
phone numbers, identity numbers, or precise addresses. Unknown values must be explicit when
needed. Parser metadata must not contain keys, prompts, or sensitive user data.

## State and error semantics

- `succeeded`: the assessment is relevant or explicitly irrelevant and the structural result is valid.
- `partial`: usable results exist, but warnings identify missing or unreliable fields.
- `needs_confirmation`: ambiguity or conflict is surfaced with evidence; no task is created.
- `rejected`: the input or result cannot be safely used; no executable action is returned.
- `irrelevant` is a successful document assessment, not a parser failure. It must contain no actions and a null graph.

The stable error codes are `INVALID_REQUEST`, `TEXT_TOO_LARGE`, `UNSUPPORTED_CONTENT_TYPE`,
`PROTOCOL_VERSION_UNSUPPORTED`, `PARSER_NOT_CONFIGURED`, `PARSER_TIMEOUT`, `PARSER_REJECTED`,
`PARSER_RESPONSE_INVALID`, and `INTERNAL_ERROR`. Only timeout and internal errors are retryable
by default. A retry must reuse the same idempotency key; a key reused with different content is
an invalid request.

All times are ISO 8601 date-time strings. `execution_context.deadline_ms` is the caller's
bounded request deadline. `parser_metadata` records parser/model/prompt/rule versions and
latency; text parsing uses `ocr_version: not_applicable`.
