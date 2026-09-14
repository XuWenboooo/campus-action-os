# Architecture

The local foundation has four explicit boundaries: the API owns authentication, persistence and side effects; the AI parser accepts a versioned text-parse request and returns only protocol-validated candidate actions; `packages/protocol` is the single TypeScript/runtime schema boundary; SQLite stores source, derived results and audit records separately.

The normal path is `Document -> ParseJob -> parser HTTP -> TextParseResponse -> VerifiedActionObject/Evidence/ActionGraph -> explicit user confirmation -> Task`. Parser output never directly sends reminders or completes tasks. The rule-based parser is deterministic development infrastructure, not a claim of real model performance.
