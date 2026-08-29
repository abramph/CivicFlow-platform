# Report Export Queue Hardening

`fix/report-export-queue-hardening` — fixes real gaps found while preparing the Pine Grove PTA volunteer-hours reporting pilot: no atomic claim, no crash recovery, no cleanup lifecycle. See the Stage B / scheduler-review conversation history for the original findings.

## Follow-up commit: ownership renewal, claim-ID-conditioned transitions, durable cleanup, rate-limit isolation

A design review of the initial commit found two remaining real gaps, addressed in a second commit on this same branch (not an amend — `86bdd59` is preserved as-is):

1. **The 5-minute lease could expire while a legitimate export was still processing**, letting a second worker reclaim and process the same export concurrently.
2. **A failed object deletion for a permanently-FAILED export was never retried**, risking a permanent orphan in Spaces.

### Lease-ownership solution

Researched DigitalOcean App Platform's actual HTTP request timeout rather than assuming: **100 seconds, hard and non-configurable**, for `web` services (this app's current deployment type) — confirmed via multiple independent DigitalOcean community support threads; the current published Limits page documents the related 600s file-upload timeout without separately restating this one, so this is disclosed as well-corroborated-but-not-explicitly-published rather than presented as unambiguous official documentation.

Workbook generation (`exceljs`'s `workbook.xlsx.writeBuffer()`) is CPU-bound XML/zip construction that does the bulk of its work synchronously on the event loop, even though it returns a Promise — a `setInterval`-based heartbeat cannot reliably fire mid-generation. This ruled out "renewable lease as the sole defense" (the design review's preferred model requires reliable mid-work heartbeats) in favor of a **hybrid**:

- `REPORT_EXPORT_LEASE_MS = 3 × PLATFORM_HTTP_REQUEST_TIMEOUT_MS` (5 minutes) — sized so a legitimately-still-processing invocation's entire HTTP request is *guaranteed* to have already been killed by the platform before any other invocation could treat its claim as stale. This is the structural, primary safety property for the current web-service-request architecture.
- **`renewReportExportLease(exportId, claimId)`** — a claim-ID-conditioned lease extension, called at every real async boundary this code has: immediately after workbook generation completes (the only point after the un-renewable synchronous phase), after upload, and before the CSV branch's completion write. Defense in depth now, and the mechanism a **future dedicated long-running worker** (no 100s ceiling at all) would rely on as its *primary* defense instead.

### Claim-ID-conditioned transitions

Every state-changing function in `report-export-queue.ts` now requires the caller's `claimId` and conditions its `updateMany` on `status='PROCESSING' AND claimId=<value>`:

- `renewReportExportLease` — returns `boolean`, never throws.
- `resolveReportExportFailure` — returns `{ ownershipRetained, terminal, sanitizedMessage }`.
- `completeReportExport` — returns `boolean`.
- The generic CSV branch's own completion write (kept inline in `reports.ts` since it doesn't use `completeReportExport`) is conditioned the same way.

`processQueuedReportExport` checks the result of every one of these calls. The instant any of them reports lost ownership, it **stops immediately**: no completion, no failure/retry write, no artifact deletion (the object at the deterministic key may be exactly what the current owner's own upload produced), and no audit event misattributing an outcome this invocation didn't actually cause — only a sanitized `console.warn` naming the boundary where ownership was lost, via `logOwnershipLost()`.

**Proof**: `report-export-queue.concurrency.test.ts` grew from 9 to 20 real-Postgres tests, adding: renewal by the true owner extends the lease; renewal by the wrong `claimId` is rejected and leaves the real lease untouched; renewal after `COMPLETED` is rejected (can never revive a terminal row); a second worker is denied during a freshly-renewed lease; reclaim after genuine expiration succeeds and the original stale worker's `completeReportExport` call then fails harmlessly; the same for `resolveReportExportFailure` (can't mark FAILED) and retry/backoff state (can't alter `nextAttemptAt`); a simulated long-running export that renews mid-flight keeps its claim past what the original lease alone would have covered.

### Durable failed-artifact cleanup

New `ReportExport` columns (additive migration `20260829120609_report_export_queue_hardening_ownership_and_cleanup`): `artifactCleanupPending`, `artifactCleanupAttempts`, `artifactCleanupNextAttemptAt`, `artifactCleanupCompletedAt`, `artifactCleanupError`.

The immediate best-effort delete on a terminal `FAILED` PTA volunteer export remains the first attempt (`bestEffortCleanupFailedVolunteerReportUpload`, unchanged). If *that* throws, `markReportExportArtifactCleanupPending` persists a durable record, and the new `runFailedArtifactCleanup` sweep (called every cron invocation alongside the existing expired-`COMPLETED` sweep) retries at a fixed 10-minute backoff — **indefinitely, not bounded to a fixed attempt count**, since "a permanently failed export cannot be forgotten merely because its initial deletion failed." Operational visibility is `artifactCleanupAttempts` + `artifactCleanupError` (sanitized), not a give-up ceiling. Same exact-key-only, idempotent-if-absent, never-touches-another-export's-object guarantees as the existing expiration sweep, reusing the identical deterministic-key derivation.

### Download-route fix

Reordered the download route's checks: expiration is now checked **before** the `fileUrl`-null check. Previously, an expired `COMPLETED` row whose object the cleanup sweep had already removed (`fileUrl` cleared to `null`) would incorrectly return 409 "not ready yet" (implying it might become available later) instead of 410 "expired" (the true, permanent state) — because the old `fileUrl`-null check ran first and short-circuited before the expiry check was ever reached.

### Deterministic-key and Content-Disposition safety

The storage object **key** (`pta-volunteer-reports/{organizationId}/{exportId}.xlsx`) is built only from server-generated opaque cuids — there is no filename/title input to it at all, so path-traversal/CRLF/unicode/long-filename concerns don't apply to the key by construction (proven by test, not just asserted).

The actual user-influenceable surface is the **`Content-Disposition` download filename** (already passed through the existing `sanitizeFilenameSegment`/`buildReportFilename`, which strips everything outside `\w`/hyphen/space). Added a second, defense-in-depth sanitizer directly in `storage.ts` — `sanitizeContentDispositionFilename` — so the safety guarantee doesn't depend entirely on every current and future caller having sanitized correctly upstream. Testing it directly caught a real gap: the initial version didn't strip `/`/`\`, allowing a value like `../../../etc/passwd` through unchanged (harmless in practice, since this is only ever a browser's advisory save-dialog suggestion, never a server-side filesystem path — but fixed anyway as defense in depth once the test surfaced it). Now also strips path separators, replacing them with `-`.

### Rate-limit review and fix

Found: **all 12 `/api/cron/*` routes shared the literal scope string `"api:cron"`**, and the rate-limiter keys state as `rl:${scope}:${clientIp}` — meaning traffic to *any* of the other 11 endpoints from the same apparent client IP shared one 10-request/60-second bucket with `/api/cron/reports`. An attacker (or even unrelated legitimate traffic) hitting a different cron route could exhaust the shared bucket and 429 the real scheduler's call to `/api/cron/reports`.

Fixed: `/api/cron/reports` now uses its own dedicated scope (`api:cron:reports`), with a more generous limit (30/60s — a 5-minute-cadence scheduler needs 1). Order unchanged (cheap IP-based check, then the real secret-based gate, per the preferred design) — the fix was the scope string and limit value, not the ordering, which was already correct. Proven with the real (unmocked) rate-limit module: exhausting the shared `"api:cron"` scope from an IP has zero effect on the dedicated scope from the same IP.

### Follow-up test summary

- `report-export-queue.test.ts`: 28 → 39 (renewal, claim-ID-conditioned failure/completion, durable-cleanup functions).
- `report-export-queue.concurrency.test.ts` (real Postgres, opt-in only): 9 → 20.
- `storage-report-export-safety.test.ts`: new, 14 tests (deterministic-key namespacing + Content-Disposition sanitization).
- `rate-limit-cron-isolation.test.ts`: new, 3 tests (real, unmocked rate-limit module).
- `reports-volunteer-hours-allowlist.test.ts`, `reports-csv-export-regression.test.ts`, `route.test.ts` (cron): updated for the `updateMany`/claim-ID call shape, plus new tests for claim-ID threading and lost-ownership behavior.

## Pre-merge verification fixes (third commit, on the same branch, `86bdd59`/follow-up both preserved unamended)

Final merge-readiness review found two further real gaps before the branch was considered ready:

### 1. Unbounded Spaces upload/request timeout

`createS3Client()` never configured `requestHandler` — the AWS SDK v3 `NodeHttpHandler` default is `requestTimeout: 0` (disabled), and even a configured timeout only *warns* rather than throws unless `throwOnRequestTimeout` is set. A stuck `PutObject` could hang indefinitely: it would never reach the post-upload `renewReportExportLease` call, so the row's lease would keep counting toward reclaim with no way to distinguish "merely stuck" from "crashed."

Fixed: `SPACES_REQUEST_TIMEOUT_MS = 120_000` (120s) + `connectionTimeout: 10_000` + `throwOnRequestTimeout: true`, applied to the shared `createS3Client()` (so it also covers `getObjectBuffer`/`getSignedObjectUrl`/`deleteObjectFromSpaces`, not just uploads). 120s is comfortably below `REPORT_EXPORT_LEASE_MS` (300s, leaving ~180s for failure handling to run after a timeout) and comfortably above what the largest upload anywhere in this app (150MB meeting-intelligence recordings, `MAX_FILE_SIZE_BYTES`) needs on a DO-to-Spaces transfer. A timeout throws a plain `Error` (not a `PtaError`), which `isPermanentReportExportError`'s default-transient design already classifies as retryable — no further code change needed for that integration. Proven by a new test asserting `SPACES_REQUEST_TIMEOUT_MS < REPORT_EXPORT_LEASE_MS` with margin, plus a test confirming a timeout-shaped error is classified transient.

### 2. Expired-COMPLETED cleanup didn't use the same durable mechanism as FAILED-artifact cleanup

`runReportExportCleanup` (the expired-`COMPLETED`-export sweep) previously handled a delete failure by just `continue`-ing — leaving `fileUrl` set so the *next* sweep's query would happen to re-match the row, but with no attempt count, no backoff, and no persisted error. That contradicts "expired completed exports use the same durable cleanup mechanism" as the FAILED-artifact path, and made a persistently-failing expired-export deletion operationally invisible (indistinguishable from "not yet due").

Fixed: `runReportExportCleanup`'s catch block now calls `markReportExportArtifactCleanupPending`, which was broadened from `status: "FAILED"` to `status: { in: ["FAILED", "COMPLETED"] }` (still explicitly excluding `PROCESSING`, so it can never touch an actively-claimed row). `runFailedArtifactCleanup`'s sweep already had no `status` filter, so it now drains both cases through one shared retry/backoff/visibility mechanism without any change to its eligibility query. The one real correctness wrinkle: a FAILED PTA row never had `fileUrl` persisted (completion never ran), so its object is only findable via the deterministic key — but a COMPLETED row (including the generic CSV branch's non-deterministic, random-suffixed key) always has `fileUrl` reliably set by `completeReportExport`. `runFailedArtifactCleanup` now resolves the key as `row.fileUrl ?? buildDeterministicVolunteerReportObjectKey(...)`, so it uses the stored value when present rather than reconstructing — reconstruction would silently target the wrong key for a CSV export. Also clears `fileUrl` on successful cleanup so `runReportExportCleanup`'s own query can never re-match the same row.

Proven by 4 new/updated tests: the old "leaves fileUrl set, calls nothing" assertion was replaced with one proving a delete failure now creates a durable pending record; a new test proves the CSV/random-key case resolves via stored `fileUrl` rather than a reconstructed PTA-shaped key; a new test proves `fileUrl` is cleared on success; a new test proves the deterministic-key fallback still fires when `fileUrl` is absent (the FAILED-PTA case). `markReportExportArtifactCleanupPending`'s own test now asserts the broadened `status: { in: [...] }` where-clause and that `PROCESSING` is never included.

Both fixes: `report-export-queue.test.ts` 39 → 42, `storage-report-export-safety.test.ts` 14 → 16. Real-Postgres concurrency suite unaffected (still 20/20 — these two fixes don't change any claim/lease/ownership behavior the concurrency suite exercises).

## What changed (original commit)

- **New shared module**: `src/lib/report-export-queue.ts` — atomic claim, lease/stale recovery, bounded retry with permanent-error classification, deterministic object keys (PTA volunteer branch only), sanitized error storage, and a bounded cleanup sweep. Used by `processQueuedReportExport`/`processQueuedReportExports` in `src/lib/reports.ts`, for **both** report-export branches (PTA volunteer `.xlsx` and generic CSV) — the race condition is type-agnostic, so claim/lease/retry mechanics apply uniformly.
- **Schema**: `ReportExport` gains six nullable/defaulted columns (`claimedAt`, `leaseExpiresAt`, `claimId`, `attemptCount`, `nextAttemptAt`, `expiresAt`) and three supporting indexes. Purely additive — see `prisma/migrations/20260829114251_report_export_queue_hardening/migration.sql`.
- **Dedicated secret**: `/api/cron/reports` now authenticates with `REPORT_EXPORT_CRON_SECRET` only (`src/lib/cron-auth.ts`'s `validateReportExportCronSecret`), never the shared `CRON_SECRET` the other 11 `/api/cron/*` routes use.
- **Download route**: `.../reports/exports/[exportId]/download/route.ts` now also denies access once `expiresAt` has passed (410), on top of the pre-existing tenant/permission/status checks.

## Queue lifecycle

```
QUEUED ──(claim)──> PROCESSING ──(success)──> COMPLETED ──(expiresAt passes + cleanup sweep)──> COMPLETED, fileUrl=null
   ▲                     │
   │                     ├──(transient failure, attempts remain)──> QUEUED (nextAttemptAt set)
   │                     │
   └─────────────────────┴──(permanent error OR attempts exhausted)──> FAILED
```

A `ReportExport` row is never deleted by this program — `COMPLETED`/`FAILED` are permanent audit history. Only the Spaces *object* a `COMPLETED` row points to is ever removed (by the cleanup sweep, after `expiresAt`), and only for the PTA volunteer branch — the generic CSV branch never sets `expiresAt`, so its objects are retained indefinitely, unchanged from pre-hardening behavior.

## Atomic claim

`attemptClaimReportExport(id)` (used directly, and by `claimReportExportBatch` in a loop over candidate ids) is a single conditional `updateMany`:

```ts
updateMany({
  where: { id, OR: [
    { status: "QUEUED", nextAttemptAt: null },
    { status: "QUEUED", nextAttemptAt: { lte: now } },
    { status: "PROCESSING", leaseExpiresAt: { lt: now } },
  ]},
  data: { status: "PROCESSING", claimedAt: now, leaseExpiresAt: now + LEASE_MS, claimId, attemptCount: { increment: 1 } },
})
```

Postgres serializes concurrent `UPDATE`s on the same row — of any number of simultaneous callers, exactly one sees `count === 1`. This is the same idiom already proven elsewhere in this codebase (`src/lib/imports/engine.ts`'s `claimBatchForProcessing`), chosen for consistency over introducing a second, different atomic-claim pattern (`SELECT ... FOR UPDATE SKIP LOCKED`) that would also have worked but wouldn't match anything else in the repo.

**Proof**: `src/lib/__tests__/report-export-queue.concurrency.test.ts` — real, unmocked Postgres tests (see "Running the concurrency tests" below) covering two/ten simultaneous claims on one row, two simultaneous batch claims across six rows (zero overlap, none lost, none duplicated), lease-not-expired-not-reclaimed, lease-expired-reclaimed, backoff-honored, backoff-passed-claimed, COMPLETED-never-reclaimed, and batch-size-limit-respected-under-contention.

## Lease and stale recovery

- Lease duration: `REPORT_EXPORT_LEASE_MS` (5 minutes), a centralized constant in `report-export-queue.ts` — not an env var, so every deploy gets the same reviewed value rather than risking a misconfigured override silently changing queue behavior.
- A `PROCESSING` row whose `leaseExpiresAt` has passed is treated exactly like a fresh `QUEUED` row by the claim query — reclaimable, and `attemptCount` increments again on reclaim.
- Deliberately **not** based on `updatedAt` — that field changes on any update to the row (including e.g. an error-message rewrite), so it can't distinguish "still being actively processed" from "just had unrelated metadata touched."

## Retry

- `REPORT_EXPORT_MAX_ATTEMPTS = 3`, `REPORT_EXPORT_RETRY_BACKOFF_MS = 2 minutes` — both centralized constants in `report-export-queue.ts`.
- `isPermanentReportExportError(error)` classifies a thrown `PtaError` with one of `PTA_VOLUNTEER_HOURS_PLATFORM_DISABLED`, `PTA_VOLUNTEER_HOURS_ORG_NOT_ALLOWLISTED`, `PTA_VOLUNTEER_REQUIREMENTS_DISABLED`, `PTA_VOLUNTEER_REPORTS_DISABLED`, `PTA_VOLUNTEER_PERIOD_NOT_FOUND`, or `PTA_HOUSEHOLD_NOT_FOUND` as permanent — these never succeed on retry, so they skip straight to `FAILED` regardless of remaining attempts. Everything else (network blips, unexpected exceptions, transient Spaces errors) is treated as transient and gets bounded retry.
- This is also what guarantees a disabled/unallowlisted organization's queued export can never complete: `requireVolunteerHoursFlag` is re-checked fresh on every processing attempt (not only at enqueue time), and its failure is always classified permanent.
- `sanitizeReportExportErrorMessage` strips connection strings, signed-URL query parameters, AWS-style access key patterns, and bearer tokens before anything is written to `errorMessage`, and truncates to 500 characters.
- Manual re-queue of a `FAILED` export isn't implemented as a distinct "retry" action in this phase — no existing UI/API surface for it was found to extend safely within this branch's scope. Re-queuing today means creating a new export request through the normal authenticated route.

## Deterministic object keys (PTA volunteer branch only)

`buildDeterministicVolunteerReportObjectKey(organizationId, exportId)` → `pta-volunteer-reports/{organizationId}/{exportId}.xlsx`. No random component, no PII (both ids are opaque cuids), and never persisted ahead of time in its own column — it's always recomputable from the row's own id, satisfying "deterministically reconstructible" without a schema field. This makes retries and reclaim self-healing without any extra reconciliation logic: an S3-compatible `PutObject` to the same key twice is just an overwrite (never a duplicate/orphan), and `PutObject` is atomic per-object (a reader never observes a partially-written file). The human-readable filename a browser sees on download comes from `Content-Disposition`, set at upload time via `uploadBufferToSpaces`'s new `downloadFilename` parameter — independent of the storage key.

The generic CSV branch is unchanged: still uses the pre-existing random-suffixed `buildSafeObjectKey`, still creates an `Attachment` row, still has unbounded retention. Extending deterministic keys/expiration to that branch was out of scope for this program (it's shared by every other vertical, not just PTA).

## Upload/completion reconciliation

No distributed-transaction claim is made between PostgreSQL and Spaces — that boundary is real and unavoidable with two separate systems. Instead, the workflow is idempotent and self-correcting:

- Build fails before upload → no object was ever written, nothing to clean up.
- Upload fails or times out with an uncertain outcome → the next retry (bounded, see above) re-runs the identical deterministic-key upload, which resolves to either "the object is now definitely complete" or another clean failure — never a partial/corrupt object, since S3 `PutObject` is atomic.
- Upload succeeds but the DB completion `update` fails → the row is still `PROCESSING` (with a lease), so it's reclaimed by a later sweep, which re-runs the build+upload (safe overwrite) and retries completion.
- A **permanently** `FAILED` PTA volunteer export triggers `bestEffortCleanupFailedVolunteerReportUpload`, which attempts to delete the deterministic key regardless of whether an object was ever actually written there — safe unconditionally, since deleting a nonexistent key is a normal no-op under S3-compatible semantics. **Known residual gap**: if that best-effort delete itself fails (e.g. a transient Spaces outage exactly when the job terminally fails), there's no further automatic retry for that specific object — it isn't covered by the `expiresAt`-based cleanup sweep (which only ever looks at `COMPLETED` rows). Documented here rather than silently claimed as fully handled.

## Expiration and cleanup

- `getReportExportRetentionDays()` reads `REPORT_EXPORT_RETENTION_DAYS`, clamped to `[1, 30]`, defaulting (and failing closed on any invalid/out-of-range value) to **7 days**.
- `completeReportExport` sets `expiresAt = completedAt + retentionDays` — PTA volunteer branch only; the CSV branch's own completion path never sets it, so `runReportExportCleanup`'s query (`WHERE status = 'COMPLETED' AND expiresAt < now() AND fileUrl IS NOT NULL`) never matches a CSV row (`NULL < now()` is never true in SQL) — no explicit type check needed.
- Cleanup deletes the **exact** stored key via `deleteObjectFromSpaces` — never a prefix or bucket-wide operation — then clears `fileUrl` to `null` (never deletes the row). A subsequent sweep's query no longer matches that row (its `fileUrl` is no longer non-null), which is what makes the sweep idempotent under concurrent/overlapping calls without needing its own claim mechanism.
- The download route denies access (410) once `expiresAt` has passed, even in the brief window before the next cleanup sweep physically removes the object.
- Disabling an organization's `reports` flag **immediately** blocks downloading an already-completed export — `requireVolunteerHoursAccess` re-checks the flag on every download request (pre-existing behavior, confirmed still true, not something this phase needed to add), fail-closed, as required for the pilot.

## Dedicated cron secret

`REPORT_EXPORT_CRON_SECRET`, checked by `validateReportExportCronSecret` in `src/lib/cron-auth.ts` — same timing-safe comparison as the shared `validateCronSecret`, but reads a completely separate env var with **no fallback** to `CRON_SECRET`. Fails closed (rejects every request) when unset, which is the deliberate state immediately after this branch deploys — `/api/cron/reports` stays unreachable until the secret is configured in a separate authorized step. The other 11 `/api/cron/*` routes are untouched and continue using the shared `CRON_SECRET` exactly as before.

## `/api/cron/reports` behavior

- Batch size 10, cleanup sweep limit 25 per invocation (both centralized constants in the route file) — bounds total work so one call can't run indefinitely or approach the platform request timeout.
- Each claimed job is processed independently; one job's failure (caught internally by `processQueuedReportExport`, plus an outer safety-net catch in `processQueuedReportExports`) never stops the rest of the batch.
- Response is a sanitized, count-only JSON summary (`processed`, `cleanupChecked`, `cleanupDeleted`) — never organization data, object keys, or error text.
- Safe under concurrent/overlapping calls (the atomic claim is what makes this true) and safe with zero eligible jobs (returns all-zero counts, no error).

## Known distributed-system boundary (explicitly not claimed as solved)

PostgreSQL and DigitalOcean Spaces are two separate systems with no shared transaction. This program does not claim true cross-system atomicity — it claims (and tests) that the workflow is **idempotent and reconcilable**: every retry/reclaim path converges to a correct final state (object matches what the row's `fileUrl` says, or the row is cleanly `FAILED` with a best-effort-cleaned object) without ever producing a corrupted file or a duplicate charge-equivalent side effect. The one documented residual gap is the best-effort-delete-on-terminal-failure not itself being retried (see above).

## Stage B pilot procedure (once separately authorized)

1. Deploy this hardening with `REPORT_EXPORT_CRON_SECRET` still unset — `/api/cron/reports` remains unreachable, reports stay disabled.
2. Generate `REPORT_EXPORT_CRON_SECRET` and configure it as a DigitalOcean app-spec secret.
3. Configure the chosen scheduler (see the scheduler-comparison writeup in this program's conversation history) with that secret only.
4. Health-test the scheduler firing with zero queued exports.
5. Re-enable Pine Grove's `ptaVolunteerReportsEnabled` flag.
6. Create the seven controlled pilot exports through the real authenticated route.
7. Let the scheduler-triggered worker process the queue.
8. Validate the resulting workbooks.
9. Clean up the exact pilot artifacts (the cleanup sweep handles this automatically after `expiresAt`, or delete by exact key manually if immediate removal is wanted).
10. Decide whether to retain or tear down the pilot scheduler configuration.

## Rollback / forward recovery

This migration is purely additive — rolling back application code (reverting the merge) leaves the new columns unused but harmless; no destructive down-migration is provided or needed. If the hardening itself needs to be backed out after deploy, disabling `ptaVolunteerReportsEnabled` (as already done) plus leaving `REPORT_EXPORT_CRON_SECRET` unset returns the system to "queue exists, nothing processes it" — the same dormant state as before any of this work began. No data is lost in either direction.

## Running the concurrency tests

Skipped by default — `npx vitest run` never touches a real database. To run them explicitly against the isolated local dev database (never production):

```
REPORT_EXPORT_QUEUE_TEST_DATABASE_URL="postgresql://postgres@localhost:5433/civicflow_dev?schema=public" \
DATABASE_URL="postgresql://postgres@localhost:5433/civicflow_dev?schema=public" \
npx vitest run src/lib/__tests__/report-export-queue.concurrency.test.ts
```

Both variables must be set: the first gates whether the suite runs at all (explicit opt-in), the second is what the app's shared Prisma client actually connects with.

## Other cron-queue weaknesses (explicitly not fixed on this branch — separate follow-up work)

Found during the scheduler review that preceded this program, not touched here per this branch's scope:

- All 12 `/api/cron/*` routes previously shared one `CRON_SECRET` — now 11 still do; only `reports` has been split out. A compromised external scheduler holding `CRON_SECRET` can still trigger SMS sends, campaign blasts, import processing, HOA/Union reminders, and Meeting Intelligence submission/retention-deletion.
- `/api/cron/reminders` (email reminders) has the same missing-atomic-claim gap this program just fixed for reports — not addressed here.
- No confirmed evidence any external scheduler is actually configured for `reminders`, `sms-queue`, or (pre-this-branch) `reports` — only `campaigns` shows real historical send activity, and even that doesn't prove a scheduler is the cause.
- `/api/cron/sms-queue` and `/api/cron/sms-usage-notifications` idempotency behavior wasn't independently verified during the review.
