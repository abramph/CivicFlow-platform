# Report Export Scheduler

`ops/report-export-github-scheduler` — activates the dormant, already-hardened
`/api/cron/reports` route (see `docs/report-export-queue-hardening.md`) on a
real cadence via a GitHub Actions workflow, without touching application
code, migrations, or Pine Grove's dormant reporting flag.

## What this is

`.github/workflows/report-export-scheduler.yml` — a workflow with no
checkout, no dependency install, no database access. It makes exactly one
`POST https://app.getunestra.com/api/cron/reports` with
`Authorization: Bearer ${{ secrets.REPORT_EXPORT_CRON_SECRET }}` every 5
minutes (`*/5 * * * *`) plus on manual `workflow_dispatch`. All real work
(claiming jobs, generating workbooks, uploading, cleanup) happens
server-side, inside the route, under its own atomic-claim concurrency guard
— this workflow is just the trigger.

## Why it's currently a no-op

Reporting stays fully dark platform-wide except Pine Grove's
`ptaVolunteerRequirementsEnabled` flag, and Pine Grove's own
`ptaVolunteerReportsEnabled` is **false**. No `ReportExport` row can be
created by any current code path with reporting disabled, so every
invocation of this workflow claims and processes exactly zero jobs. This is
the expected, verified steady state — see the manual and scheduled
verification runs recorded in this branch's deployment report.

## Secret

`REPORT_EXPORT_CRON_SECRET` — 32 bytes of `openssl rand -base64` randomness,
generated once and stored identically in two places:

- DigitalOcean App Platform, `civicflow-portal` app spec, `RUN_AND_BUILD_TIME`
  `SECRET`-type env var.
- GitHub Actions repository secret (`abramph/CivicFlow-platform`).

Not reused from the shared `CRON_SECRET` (see
`docs/report-export-queue-hardening.md`'s cron-secret-isolation section for
why that isolation matters — this route deliberately cannot be triggered by
whatever secret the other 11 `/api/cron/*` routes use, and vice versa).
Generated and entered into both systems via a single piped shell script that
never wrote it to disk, never passed it as a command-line argument, and
never printed it — only exit codes and the generated length were logged.
Rotate by generating a new value and repeating that same process; the route
fails closed (401) the instant the two values diverge, so a rotation is
safe to do live (a few minutes of scheduler 401s is the only blast radius,
not a security or data issue).

## Concurrency and safety

- GitHub-side: a single fixed `concurrency: group: report-export-scheduler-production`
  with `cancel-in-progress: false` — a delayed scheduled run queues behind
  an in-flight one rather than overlapping or cancelling it.
- Database-side (the real guarantee): `claimReportExportBatch`'s atomic
  conditional `updateMany` is what actually prevents double-processing, even
  if two HTTP calls somehow landed concurrently (GitHub's own concurrency
  group notwithstanding). GitHub schedule delays (a `cron:`-triggered run is
  a *best-effort*, not an exact-time, guarantee on GitHub's side) don't
  affect correctness for this reason — a late run just claims whatever's
  eligible at that later moment.
- Rate limiting: `/api/cron/reports` has its own dedicated
  `api:cron:reports` scope (30 req/60s), isolated from the other 11 cron
  routes' shared bucket — see the queue-hardening docs. A 5-minute cadence
  uses 1 of that 30-request budget per window.

## Monitoring

**Workflow health** — `gh run list --workflow report-export-scheduler.yml --repo abramph/CivicFlow-platform`
shows the last N runs, their conclusions, and timestamps.
`gh run view <run-id> --repo abramph/CivicFlow-platform --log` for a specific
run's (sanitized) log lines.

**Queue health** (read-only SQL against the `civicflow-app` production user
— see this repo's established safe-access pattern, never the raw `doadmin`
credential):

```sql
-- Stuck PROCESSING rows (lease expired, should self-heal on next sweep)
SELECT id, status, "claimedAt", "leaseExpiresAt" FROM "ReportExport"
WHERE status = 'PROCESSING' AND "leaseExpiresAt" < now();

-- FAILED rows and their sanitized error
SELECT id, "attemptCount", "errorMessage" FROM "ReportExport" WHERE status = 'FAILED';

-- Cleanup-pending rows (should trend toward zero, never grow unbounded)
SELECT id, "artifactCleanupAttempts", "artifactCleanupNextAttemptAt", "artifactCleanupError"
FROM "ReportExport" WHERE "artifactCleanupPending" = true;

-- Oldest queued-but-unclaimed job (should normally be seconds, given a
-- 5-minute cadence and an empty queue in the current dormant state)
SELECT id, "requestedAt", now() - "requestedAt" AS age FROM "ReportExport"
WHERE status = 'QUEUED' ORDER BY "requestedAt" ASC LIMIT 1;

-- Expired COMPLETED exports still awaiting artifact deletion
SELECT id, "expiresAt" FROM "ReportExport"
WHERE status = 'COMPLETED' AND "expiresAt" < now() AND "fileUrl" IS NOT NULL;
```

## Failure-notification status

**No GitHub Actions failure notification is configured for this repository
as of this pilot** — not implemented, not claimed. GitHub's own default
behavior (the actor of the triggering event gets notified for a *scheduled*
run's failure, per GitHub's standard `schedule`-trigger notification
behavior) is the only signal in place right now, and that default depends on
the individual GitHub account's own notification settings, not a
repository-level configuration this branch added. Recommended follow-up
(separate authorization): a dedicated Slack/email integration, or a required
check tied into the broader CI recommendation in
`docs/portal-build-typecheck-separation.md`.
