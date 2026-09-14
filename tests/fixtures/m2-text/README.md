# M2 text interface fixtures

These fixtures are deterministic, synthetic development inputs only. Every fixture is marked:

```text
development_only: true
synthetic: true
not_model_output: true
```

They contain no real student, staff, or institutional data and must not be used for accuracy,
CER, Action Recall, model selection, formal experiments, or defense examples.

The catalog in `catalog.ts` contains a request and an expected response or `ApiError` for each
scenario. The mock parser uses the catalog by exact `content_sha256`; it never calls a model or
the network.

| Fixture                  | Purpose                                                   |
| ------------------------ | --------------------------------------------------------- |
| `single-action`          | One action with an explicit deadline                      |
| `multi-action-materials` | Multiple actions and required materials                   |
| `irrelevant-profile`     | Document is unrelated to the supplied profile             |
| `uncertain-audience`     | Audience cannot be safely resolved                        |
| `ambiguous-date`         | Date wording requires confirmation                        |
| `conflicting-dates`      | Source contains conflicting dates                         |
| `invalid-response`       | Missing evidence in a would-be parser response            |
| `timeout`                | Parser timeout error                                      |
| `not-configured`         | Parser is not configured error                            |
| `partial-success`        | Action is returned with an unknown deadline and warning   |
| `idempotent-replay`      | Same request and idempotency key return the same response |
| `idempotency-key-reuse`  | Same key with different content is rejected               |

Run the fixture checks with:

```text
npm run test:m2
npm run dev:mock
```
