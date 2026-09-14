# M2 text contract failure ledger

This ledger is append-only. A resolved issue receives a new `RESOLVED` entry; the first failure
record remains intact.

| Time             | Command/action                                 | Exit | Cause | Retry | Handling                        | Result |
| ---------------- | ---------------------------------------------- | ---: | ----: | ----: | ------------------------------- | ------ |
| 2026-09-14 15:05 | initial baseline fetch and worktree inspection |    0 |  none |     0 | verified M1 tag and remote main | PASS   |

No implementation failures have been observed yet. Any later failure must be recorded here before
its repair and re-tested in the fixed full-validation sequence.

## Resolved failures — M2-CONTRACT-20260914-150504

| Time             | Command/action                                  | Exit |                                                                                                         Cause | Retry | Handling                                                                                                | Result   |
| ---------------- | ----------------------------------------------- | ---: | ------------------------------------------------------------------------------------------------------------: | ----: | ------------------------------------------------------------------------------------------------------- | -------- |
| 2026-09-14 15:08 | `npm.cmd run test:m2` before dependency install |    1 |                                                         worktree had no `node_modules`; `tsx` was unavailable |     1 | ran `npm.cmd install --ignore-scripts --prefer-offline`, then `npm.cmd ci` in the fixed validation      | RESOLVED |
| 2026-09-14 15:13 | `npm.cmd run release:m2-manifest:verify`        |    1 |                              Windows URL pathname was converted into `F:\\F:` and could not open the manifest |     1 | switched the verifier to `fileURLToPath`, updated its manifest hash, and reran verification             | RESOLVED |
| 2026-09-14 15:17 | first complete `npm.cmd run check`              |    1 | historical M1 manifest compared its immutable package hash with the intentionally extended M2 protocol source |     1 | M1 verifier now reads the recorded paths from the immutable M1 tag; M2 has a separate 17-entry manifest | RESOLVED |

All three failures were engineering/environment issues. None changed the frozen research material
or any scientific conclusion. The final fixed sequence completed with exit code 0.
