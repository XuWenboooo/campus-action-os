# Domain model

`Document` is immutable source text and ownership metadata. `ParseJob` records one idempotent parse attempt. `VerifiedActionObject` is the evidence-bearing derived object; `ActionGraph` expresses execution dependencies. `Task` is a side-effect-bearing user-owned projection and can only be created after explicit confirmation. `NotificationRevision` is append-only so later postponement, replacement or revocation can be audited.
