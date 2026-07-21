# Meeting Intelligence — Internal APH Pilot Readiness Runbook

This is the operational runbook for running the Meeting Intelligence MVP (see
`docs/meeting-intelligence.md` for architecture) as a real, limited internal
pilot with APH Technologies, LLC. It assumes the MVP itself (PR #15) is
already merged and deployed — this document covers what's needed to actually
*run* the pilot safely, not the feature's implementation.

## 0. Current state (as of this writing)

- PR #15 (Meeting Intelligence MVP) is **merged into `main`** (commit `c3cb936`) and **deployed to production** — the live DigitalOcean App Platform deployment is exactly that commit.
- The `20260719001436_add_meeting_intelligence_mvp` migration has applied to production (`prisma migrate status` confirms no pending migrations from that PR).
- **No organization is enrolled** in `meetingIntelligence` (zero `OrganizationLabFeature` rows for the key) and **zero jobs exist** — the feature is deployed but completely inert.
- `ASSEMBLYAI_API_KEY` and `OPENAI_API_KEY` are **not set** in the production app spec — transcription cannot run until an operator configures at least the AssemblyAI key.
- The two Meeting Intelligence cron endpoints are very likely **not yet registered** with an external scheduler (no evidence of any job ever having been processed).

Confirm this is still accurate before proceeding — see step 1 below.

## 1. Prerequisites

- [ ] Confirm PR #15 is merged and deployed: `git log origin/main` should show a merge commit for `agent/meeting-intelligence-mvp`, and the active DigitalOcean deployment's cause should reference that same commit hash (`doctl apps list-deployments <app-id>`).
- [ ] Confirm the migration has applied: `npx prisma migrate status` (with `DATABASE_URL` pointed at production) should report no pending migrations.
- [ ] Read `docs/meeting-intelligence.md` in full, especially "Known limitations" and "Deferred roadmap".

## 2. Secrets

Set in DigitalOcean App Platform → Settings → Environment Variables (encrypted):

| Variable | Required | Notes |
|---|---|---|
| `ASSEMBLYAI_API_KEY` | Yes, to run any real transcription | Missing → every submission fails immediately with the non-retryable `MEETING_INTELLIGENCE_PROVIDER_MISCONFIGURED`. |
| `OPENAI_API_KEY` | No | Missing → the deterministic (non-AI) fallback generator is used automatically. This is a legitimate pilot mode, not a degraded one — decide deliberately whether the pilot should exercise the AI generator or the fallback. |
| `MEETING_INTELLIGENCE_PROVIDER` | No | Leave unset (defaults to `assemblyai`) unless testing a different provider. |
| `CRON_SECRET` | Yes (already required for other cron jobs) | Reused as-is for the two Meeting Intelligence cron endpoints. |

Verify presence (never the value) on the **Operations Center pilot dashboard** at `/admin/platform/meeting-intelligence` — "Provider diagnostics" section — before proceeding further.

## 3. Enrollment

Meeting Intelligence requires an explicit enrollment row, separate from APH's billing-exempt status:

1. Go to `/admin/platform/labs`.
2. Find or create an enrollment row for feature `meetingIntelligence` and APH Technologies' organization id.
3. Set status to `ENABLED`. This is audit-logged automatically.
4. Confirm on `/admin/platform/meeting-intelligence` ("Enrollment" section) that APH now shows `ENABLED`.

Do **not** enroll any other organization during the pilot.

## 4. Permissions

As an APH `ORG_OWNER` or `ORG_ADMIN`, confirm `/settings/labs` and the Meeting Intelligence entry point on a meeting's detail page both appear. `FINANCE`/`STAFF`/`READ_ONLY`/`MEMBER` roles have no Meeting Intelligence permissions by default (see `docs/meeting-intelligence.md`'s RBAC section) — this is expected, not a bug.

## 5. Cron configuration

Register both endpoints with an external scheduler (cron-job.org recommended, free tier) — see `DEPLOYMENT.md`'s "Scheduled workers" table for exact URLs:

- `POST /api/cron/meeting-intelligence` — every 5 minutes
- `POST /api/cron/meeting-intelligence-retention` — once daily

Both require `Authorization: Bearer <CRON_SECRET>`. Confirm `CRON_SECRET` is set — visible (presence only) on the pilot dashboard's "Provider diagnostics" section.

Until a scheduler is wired up, the worker can be run manually for testing:
```bash
cd civicflow-portal
npm run worker:meeting-intelligence
npm run worker:meeting-intelligence-retention
```

## 6. Provider diagnostics

Before running a real pilot meeting, visit `/admin/platform/meeting-intelligence` and:

1. Review the static "Provider diagnostics" panel (config-presence only, always safe).
2. Click **"Run live diagnostics"** to explicitly verify:
   - AssemblyAI's metadata endpoint is reachable and the key authenticates (a non-billable `GET` — no audio is submitted).
   - The configured Spaces bucket is reachable (`HeadBucket` — no object is read or written).

This check is never run automatically — only on explicit admin action — and never prints a credential value.

## 7. Smoke test (guided, non-bypass)

Use a short (under 2 minutes), genuinely non-sensitive internal recording (e.g. someone reading a public document aloud) — never a real APH meeting for the first run. Walk through the real product flow end to end and confirm each step, using the Operations Center dashboard and the job's own detail page to verify:

1. **Labs enrollment** — `/admin/platform/meeting-intelligence` shows APH `ENABLED`.
2. **Pilot user permission** — log in as an APH `ORG_OWNER`/`ORG_ADMIN`.
3. **Consent gate** — attempting to create a job without confirming all five consent statements is rejected (`MEETING_INTELLIGENCE_CONSENT_REQUIRED`).
4. **Upload** — the recording uploads successfully (under the 150 MB limit) and the job moves to `UPLOADED`.
5. **Object storage** — confirm the object exists under `organizations/{orgId}/meeting-intelligence/{meetingId}/{jobId}/source/...` in Spaces (no filename/title in the key).
6. **Transcription submission** — the job moves to `QUEUED` then `SUBMITTED_TO_PROVIDER` after the next cron/worker tick, visible in "Job status" on the dashboard.
7. **Worker processing** — the dashboard's job-status counts reflect the transition; no entry appears in "Stuck / stale claims".
8. **Transcript creation** — the job reaches `TRANSCRIBED`; view the transcript at `/labs/meeting-intelligence/jobs/[jobId]/transcript`.
9. **Draft generation** — the job reaches `DRAFT_READY`; confirm the generator badge (AI vs. fallback) matches what you configured in step 2.
10. **Human review** — edit a section of the draft at `/labs/meeting-intelligence/jobs/[jobId]/minutes`.
11. **Approval** — approve the draft; confirm it becomes immutable (attempting a further edit is rejected).
12. **DOCX export** — export and open the DOCX; confirm no `DRAFT — NOT OFFICIAL` watermark on an approved export.
13. **PDF entitlement** — export as PDF; confirm it succeeds (APH is billing-exempt → elite-equivalent `pdfExport` entitlement).
14. **Audit events** — `/admin/platform/meeting-intelligence`'s "Recent audit activity" shows the full lifecycle (job created → upload confirmed → transitions → approved → exported), with **no transcript or draft content** in any event.
15. **Usage events** — "Estimated pilot usage & cost" reflects at least one transcription job and one minutes-generation job.
16. **Recording deletion** — manually delete the recording (`DELETE .../recording`) or wait for the 30-day retention cron; confirm the transcript and approved minutes are **not** affected, and "Retention" on the dashboard reflects the deletion.

Use only recordings created specifically for this test. Never commit a recording file to the repository.

## 8. Pilot feedback

After each real pilot meeting, the reviewing user should submit feedback from the job's detail page (`/labs/meeting-intelligence/jobs/[jobId]`, "Pilot feedback" panel) — overall rating, per-area ratings, time saved, corrections required, issue category, and free-text comments about the tool's output. This is internal tooling feedback, not part of the meeting record. Aggregate results are visible to platform admins on `/admin/platform/meeting-intelligence`.

Use accumulated feedback to decide the next enhancement — prioritize whichever of transcription quality, speaker-label accuracy, minutes accuracy, review UX, export, performance, or reliability shows up most in the "issue category" breakdown.

## 9. Troubleshooting / failure recovery

| Symptom | Likely cause | Action |
|---|---|---|
| Job stuck in `QUEUED` indefinitely | Cron not registered, or `CRON_SECRET` misconfigured | Check "Provider diagnostics" (cron auth) and confirm the scheduler is actually calling the endpoint (check the scheduler's own delivery logs). |
| Job `FAILED` with `MEETING_INTELLIGENCE_PROVIDER_MISCONFIGURED` | `ASSEMBLYAI_API_KEY` missing/invalid | Not retryable by design — fix the env var, then use the dashboard's manual retry (only shown for retryable codes; a misconfiguration requires a redeploy/env fix first, then a normal retry once the config is confirmed via diagnostics). |
| Job `FAILED` with a retryable code (`..._PROVIDER_UNAVAILABLE`, `..._PROVIDER_RATE_LIMITED`, `..._PROVIDER_TIMEOUT`, `..._TRANSCRIPTION_FAILED`, `..._GENERATION_FAILED`) | Transient vendor issue | Use the "Retry" control on `/admin/platform/meeting-intelligence` (platform-admin scope) or the tenant's own job page. Retry is bounded (`FAILED → QUEUED` only) and cannot duplicate a provider submission — see `worker.ts`'s claim mechanism. |
| Job appears in "Stuck / stale claims" | A worker invocation crashed or a deploy restarted mid-processing | No action needed — the next scheduled tick reclaims the job automatically once the claim exceeds 10 minutes old. |
| Draft minutes look wrong / speaker labels wrong | Vendor/model quality | Submit pilot feedback with the relevant issue category — this is expected input for deciding the next improvement, not a bug in this codebase. |

### Retry rules (do not bypass)

- Only a `FAILED` job can be retried (`MEETING_INTELLIGENCE_INVALID_TRANSITION` otherwise).
- Only a failure code marked `retryable` should be retried — the dashboard hides the control otherwise, but this is also enforced by the state machine, not just the UI.
- A platform-admin retry (from the Operations Center) and a tenant self-service retry both route through the exact same `retryMeetingIntelligenceJob()` function — there is no separate, less-guarded admin code path.
- Retrying never re-submits to the vendor twice for the same attempt — the job re-enters `QUEUED` and the worker's atomic claim mechanism governs the next submission exactly as it would for any other `QUEUED` job.

## 10. Cost monitoring

`/admin/platform/meeting-intelligence`'s "Estimated pilot usage & cost" section shows audio minutes uploaded/transcribed, job counts, and illustrative cost estimates (see `cost-constants.ts` — approximations, not a live vendor quote, not connected to Stripe). Review periodically during the pilot; update the pricing constants if AssemblyAI's or OpenAI's published rates change materially.

## 11. Privacy restrictions (pilot-specific, not a compliance claim)

This is an internal technical pilot, not a compliance-certified system. Every upload page shows the pilot safety notice (`InternalPilotBanner`) covering:

- Internal-pilot-only scope.
- AI-generated minutes are always a draft requiring human review and approval.
- Participant notification/consent is required before uploading.
- Audio/transcript content is sent to third-party AI providers (AssemblyAI, and OpenAI if configured).
- Recordings are retained temporarily (30 days after a settled stage) and deleted automatically.
- Do not upload: protected health information, psychotherapy content, patient identifiers, highly sensitive personnel matters, confidential legal advice, payment card information, or passwords/credentials.

The five-statement consent gate (`consent.ts`) is enforced server-side before any job can be created — it fails closed.

## 12. Retention and deletion

- Source recordings are deleted automatically 30 days after a job reaches a settled stage (`DRAFT_READY`/`IN_REVIEW`/`APPROVED`/`FAILED`/`CANCELLED`) — never the transcript, never a minutes draft.
- To delete all pilot data for an organization ahead of schedule: delete each job's recording (`DELETE .../recording`), then each transcript (`DELETE .../transcript`, requires `acknowledgeRegenerationImpossible: true`). Approved minutes drafts are retained as meeting records by design and are not deleted by any automated path.
- Verify via the "Retention" section of the Operations Center dashboard.

## 13. Disabling the feature

Set APH's `meetingIntelligence` enrollment to `DISABLED` or `SUSPENDED` on `/admin/platform/labs`. In-flight jobs already `SUBMITTED_TO_PROVIDER`/`TRANSCRIBING` still complete transcript retrieval (the vendor is already processing them) but will not proceed to minutes generation — see `docs/meeting-intelligence.md`'s "Enrollment-disabled-mid-flight policy".

## 14. Rollback

The migration is purely additive — reverting the application code (redeploying an earlier commit) is safe without a down-migration. Disabling enrollment (step 13) is the fast, no-deploy way to stop the pilot immediately without any rollback at all.

## 15. Pilot success criteria

Do not claim pilot success until each of these has real evidence (screenshots, dashboard state, or exported minutes are sufficient):

- [ ] At least 5 non-sensitive meetings processed end to end (upload → approved minutes).
- [ ] No cross-tenant access finding (only APH ever saw APH's own jobs/transcripts/minutes).
- [ ] No duplicate provider (AssemblyAI/OpenAI) submission observed for any single job.
- [ ] No duplicate `MeetingMinutesDraft` version created for any single job.
- [ ] At least 90% of processed jobs completed without manual intervention (retry).
- [ ] Average draft-generation time recorded (from `TRANSCRIBED` to `DRAFT_READY` timestamps).
- [ ] Corrections-required rate measured (from submitted pilot feedback).
- [ ] User-reported time saved measured (from submitted pilot feedback).
- [ ] Provider cost per meeting measured (from the usage/cost estimate panel).
- [ ] Every approved minutes record was manually reviewed by a human before approval (true by construction — no automatic-approval path exists — but confirm via audit trail spot-check).
- [ ] Recording deletion verified for at least one job (manual or automatic).
- [ ] Audit and usage records spot-checked for completeness.

## 16. Pilot review checkpoint

Once the criteria above are met (or a deliberate decision is made to stop early), review with stakeholders:

- Aggregate pilot feedback (`/admin/platform/meeting-intelligence`, "Pilot feedback").
- `docs/meeting-intelligence.md`'s "Known limitations" and "Deferred roadmap".
- Whether the next investment should be a reliability/quality fix (informed by feedback issue categories) or a new capability (e.g. direct-to-Spaces upload, an operational dashboard enhancement, a "Meeting Package" export) — see this PR's description for the full evaluated candidate list.

Do not expand to any customer organization, enable live/real-time recording, add Zoom/Teams/Meet integration, or add customer billing as a result of this pilot without a separate, explicit product decision.
