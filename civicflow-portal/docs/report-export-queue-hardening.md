# Report Export Queue Hardening

`fix/report-export-queue-hardening` — fixes real gaps found while preparing the Pine Grove PTA volunteer-hours reporting pilot: no atomic claim, no crash recovery, no cleanup lifecycle. See the Stage B / scheduler-review conversation history for the original findings.

## What changed

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
