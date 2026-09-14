# Handoff: M2 product owner

## Baseline and scope

- Baseline: `m2-text-contract-v0.1.0` after release; current implementation branch is `integration/m2-text-contract-foundation`.
- Shared package: `@campus-action-os/protocol@1.1.0`.
- You may modify `services/api/`, `apps/`, and their tests; do not copy protocol types or schemas.
- Keep `services/ai-parser/`, `benchmark/`, `schemas/v1/`, and `docs/frozen/` within their owner boundaries.

## Product flow

1. Generate a `document_id`, save the original text, and send a `TextParseRequest` to `POST /internal/v1/parse-text`.
2. Use `validateTextParseExchange` or the request/response validators before displaying or saving parser output.
3. Show the document assessment, evidence, warnings, and actions to the user.
4. `irrelevant`: show the reason and evidence; do not create a task.
5. `partial`: show the reliable subset and every warning; do not imply missing fields are known.
6. `needs_confirmation`: show the ambiguity/conflict and require an explicit user decision.
7. `rejected`: show a safe failure state; do not create an action from free text.
8. Only after explicit confirmation may the product API save a task or schedule a reminder.

## Local mock and fixtures

Start the deterministic development-only parser:

```text
npm run dev:mock
```

It listens on `http://localhost:3101`, exposes `GET /health`, and accepts
`POST /internal/v1/parse-text`. It uses only `tests/fixtures/m2-text/catalog.ts`, performs no
network or model call, stores no user data, and marks all responses as synthetic development
data. Do not present its output as AI output or use it for accuracy, CER, recall, or model
selection.

Run contract and harness checks with:

```text
npm run test:m2
npm run test
```

## Idempotency and errors

Reuse the same `idempotency_key` for a retry of the same content. Do not retry a non-idempotent
operation blindly. A timeout or internal error may be retried; a rejected, invalid, unsupported,
or unconfigured result is not made successful by retrying. The server must reject a key reused
with a different content hash, and duplicate retries must not create duplicate tasks.

## Completion definition

The product implementation is complete when it can submit text, validate every response state,
render evidence/warnings, preserve raw results, require explicit confirmation, and save exactly
one task after confirmation. It must work against the fixed mock first and then the AI owner
endpoint without changing this interface. The current E2E harness intentionally reports product
steps as `pending_adapter`; it is a contract skeleton, not a claim that product persistence is
implemented.
