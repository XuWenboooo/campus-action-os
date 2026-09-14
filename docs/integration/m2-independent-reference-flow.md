# M2 independent integration reference flow

Status: development-only reference closure for `CAOS-M2-INDEPENDENT-INTEGRATION-FLOW-v1.0`.

This package proves the integration invariants around the frozen M2 text protocol. It does not
claim that a product API, production persistence, a real model, or a user interface exists.
The parser is the deterministic synthetic mock from `tools/integration/mock-ai-parser/`.

## Flow

```text
TextParseRequest
      |
      v
deterministic parser -> shared request/response validation
      |
      +-- error or invalid response -> quarantine; no review; no task
      |
      v
review bundle: assessment + evidence + warnings + actions
      |
      +-- irrelevant -> no executable action; no task
      |
      v
explicit action confirmation
      |
      v
deterministic task projection (idempotent)
```

The reference flow is implemented in `tests/e2e/m2-reference-flow.ts`. It deliberately keeps
parser state, review state, and task projection in memory so a run is deterministic and leaves no
user data behind.

## Acceptance invariants

- Every successful parser response is revalidated with `validateTextParseExchange` before review.
- `irrelevant` has no actions and cannot enter task creation.
- `partial` keeps every parser warning visible.
- `needs_confirmation` cannot create a task until an explicit action selection is supplied.
- Repeating the same request returns the same parser result.
- Repeating confirmation returns the same task set and never duplicates a task.
- A reused idempotency key with different content is rejected.
- Timeout is retryable; rejection and protocol-invalid output are not converted into success.
- Invalid, rejected, or infrastructure-error results never create tasks.
- All demo, fixture, review, and task records carry `development_only`, `synthetic`, and
  `not_model_output` provenance markers.

## Reproduction

From the repository root:

```text
npm ci
npm run demo:m2
npm run acceptance:m2
npm run test:m2
```

`demo:m2` prints one normal related notice through submit → review → confirmation → task. The
review stage must report zero tasks before confirmation. `acceptance:m2` prints a stable JSON report
with nine scenarios and exits non-zero if any gate fails.

The committed evidence snapshot is
`docs/audit/m2-independent-integration-evidence.json`. Re-run the acceptance command and compare
the scenario IDs, status, assertion counts, and provenance markers before relying on the snapshot.

## Ownership boundary

This package consumes the M2 protocol and mock but does not modify `services/api/`,
`services/ai-parser/`, `apps/`, `schemas/v1/`, `benchmark/`, or `docs/frozen/`. Product and AI
owners can replace the in-memory adapter with their services while preserving the request,
response, review, confirmation, and idempotency invariants.
