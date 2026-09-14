# Handoff: M2 AI parser owner

## Baseline and scope

- Baseline: `m2-text-contract-v0.1.0` after it is released; current implementation branch is `integration/m2-text-contract-foundation`.
- Shared package: `@campus-action-os/protocol@1.1.0`, preserving M1 `verified-action-object/v1` and `action-graph/v1`.
- You may modify `services/ai-parser/` and its own tests after integration; do not modify `apps/`, `services/api/`, `benchmark/`, `schemas/v1/`, or `docs/frozen/`.
- Do not implement model-quality claims, formal experiments, or use frozen test data.

## Endpoint

Implement `POST /internal/v1/parse-text`. Consume a `TextParseRequest` and return a
`TextParseResponse` or standard `ApiError`. The product caller controls neither model name,
prompt, temperature, nor rule thresholds.

The request contains pure text, its SHA-256, a minimal optional profile, an idempotency key,
and a bounded deadline. Preserve `request_id` and `document_id` exactly. A request with an
unsupported content type, bad hash, oversized text, or unsupported protocol version must be
rejected without an action.

## Response requirements

Return a document assessment before any action list. For `irrelevant`, return an empty
`verified_actions` array and `action_graph: null`, with a reason and evidence. For `partial`,
include warnings naming missing or unreliable fields. For `needs_confirmation`, include a
conflict or uncertainty basis and never silently resolve it. For `rejected`, do not fabricate an
action or graph. Every VAO field must bind to the existing M1 schema; use the package validator.

`parser_metadata` must include parser, model, prompt, rule, OCR, start/end, and latency fields.
Never return API keys, internal prompts, or sensitive profile fields. Text parsing must set
`ocr_version` to `not_applicable`.

## Fixtures and tests

The fixed synthetic catalog is `tests/fixtures/m2-text/catalog.ts`. It covers 12 scenarios,
including ambiguity, conflicts, rejection, timeout, unconfigured parsing, partial success, and
idempotency. The development mock is under `tools/integration/mock-ai-parser/`; it is not a
model and must not be used for quality measurements.

Run:

```text
npm ci
npm run test:m2
npm run test
npm run typecheck
```

Use `npm run dev:mock` only for local wiring. A successful handoff supplies the implementation,
owner tests, and evidence that the endpoint can be swapped behind this contract without changing
the product-facing request/response types.
