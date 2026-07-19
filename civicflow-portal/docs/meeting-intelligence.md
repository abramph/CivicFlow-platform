# Meeting Intelligence — Internal APH Pilot (MVP)

**This is a production-capable MVP, not a customer-facing feature.** Meeting Intelligence is an internal Unestra Labs pilot, restricted to APH Technologies, LLC. It is not exposed to any customer organization, has no self-service enrollment, no customer pricing, and no Stripe integration anywhere in its code path.

For the earlier architecture-validation spike this MVP builds on top of, see `docs/meeting-intelligence-spike.md` and the general Labs framework in `docs/unestra-labs.md`.

## MVP scope

An authorized APH user can: create/select a meeting → upload an existing recording → submit it for transcription → have it processed into structured draft minutes → review and edit the draft → manually approve it → export the approved minutes → view processing status, errors, usage, and audit history throughout.

**Explicitly out of scope** (per the task that produced this PR): browser/mobile microphone recording, live transcription/captions, Zoom/Teams/Google Meet integration, voice biometrics, automatic speaker identification, customer self-enrollment or pricing, Stripe metering, automatic customer billing, AI chat over transcripts, automatic publication/approval/email distribution, calendar task creation, and full "meeting package" generation. None of these exist in this codebase.

## Architecture

```
Create Meeting (existing Meeting model)
    ↓
Upload recording (multipart, server-validated)
    ↓
Storage (DigitalOcean Spaces — existing infrastructure, private objects, signed URLs)
    ↓
Background Queue (cron-driven, existing worker convention)
    ↓
Speech-to-Text (AssemblyAI, via a generic provider interface)
    ↓
Speaker Segmentation (anonymous labels; renaming is a separate, human-driven step)
    ↓
AI Processing (transcript → structured draft minutes; separate generator abstraction)
    ↓
Draft Minutes (status: draft, always, until a human approves)
    ↓
Secretary Review (edit every section, search transcript, rename speakers)
    ↓
Approval (explicit, permissioned, immutable snapshot)
    ↓
Export (DOCX / PDF)
```

Every module lives under `src/lib/labs/meeting-intelligence/`. Every route lives under `src/app/api/labs/meeting-intelligence/`. Every page lives under `src/app/labs/meeting-intelligence/`.

## Provider abstraction

`src/lib/labs/meeting-intelligence/providers/async-types.ts` defines the production interface:

```ts
interface MeetingTranscriptionProvider {
  readonly id: string;
  submit(request: TranscriptionRequest): Promise<TranscriptionSubmission>;
  getStatus(externalJobId: string): Promise<TranscriptionStatus>;
  cancel?(externalJobId: string): Promise<void>;
}
```

No route, worker, or UI component imports `assemblyai-adapter.ts` directly or references an AssemblyAI-specific type — everything goes through `getMeetingTranscriptionProvider()` / `resolveMeetingIntelligenceProviderId()` (`providers/async-index.ts`), which selects the adapter via the `MEETING_INTELLIGENCE_PROVIDER` env var (defaulting to `assemblyai`). This is distinct from the technical spike's synchronous mock interface (`providers/types.ts`, unchanged) — the MVP submits a job and polls for status, matching how AssemblyAI actually works.

### AssemblyAI adapter

`providers/assemblyai-adapter.ts` — real, uses `fetch` directly (no vendor SDK dependency), reads `ASSEMBLYAI_API_KEY` from `process.env` only at call time (never hardcoded, never validated at app boot — see "Environment variables" below). Submits with `speaker_labels: true` for native diarization. Normalizes AssemblyAI's response into `TranscriptSegment[]` (`speakerLabel`, `startMs`, `endMs`, `text`, `confidence`). Every HTTP failure mode maps to a stable `MeetingIntelligenceError` code (429 → rate limited, 400/422 → unsupported media, network failure → provider unavailable, timeout via `AbortController` → provider timeout, malformed/missing response body → invalid provider response). No credentials, signed URLs, or raw provider payloads ever appear in a thrown error message (verified by test). `cancel` is intentionally unimplemented — AssemblyAI's `DELETE /v2/transcript/{id}` only removes data for an *already-completed* job, it does not stop in-flight processing; a cancelled job in our own workflow simply stops being polled rather than actually halting vendor-side work.

Tested entirely against a mocked `global.fetch` — zero real network calls in the test suite.

## Minutes-generation provider

Deliberately a **separate abstraction** (`src/lib/labs/meeting-intelligence/minutes/`), not coupled to the transcription provider — `MeetingMinutesGenerator.generate(input): Promise<StructuredMeetingMinutes>`.

- **`openai-generator.ts`** — real adapter, reads `OPENAI_API_KEY` from `process.env` at call time. Uses `gpt-4o-mini` with `response_format: json_object`. The system prompt explicitly forbids fabricating names, motions, vote counts, owners, due dates, decisions, attendance, or legal conclusions, and requires omitting unsupported fields. The model's JSON response is validated against a strict Zod schema before being trusted at all — malformed output is rejected as `MEETING_INTELLIGENCE_GENERATION_FAILED`, never passed through. **`status` and the AI disclaimer are always set server-side, never taken from the model's own output** — a prompt-injection attempt embedded in transcript text can never cause generated minutes to claim any status other than `"draft"`.
- **`deterministic-generator.ts`** — the local-development fallback when `OPENAI_API_KEY` is unset. Pure keyword/pattern extraction, zero inference — every field is either genuinely found in the transcript or left null/empty. Not "a worse AI," a generator that makes zero guesses at all.
- **`index.ts`**'s `resolveMeetingMinutesGenerator()` picks between them based on whether `OPENAI_API_KEY` is configured.

### Structured output contract

```ts
interface StructuredMeetingMinutes {
  meetingTitle, meetingDate, locationOrFormat,
  attendance: { speakerLabel, attendeeName }[],
  agendaItems: string[],
  discussionSummaries: { topic, summary, evidence }[],
  motions: { text, proposedBy, secondedBy, voteResult, evidence }[],
  decisions: string[],
  actionItems: { description, owner, dueDate, evidence }[],
  unresolvedIssues: string[],
  nextMeetingDetails, adjournmentTime, executiveSummary,
  status: "draft",   // hard-coded — no path to anything else
  aiDisclaimer,
}
```

Every field except the skeleton (`meetingTitle`, `status`, `aiDisclaimer`) is nullable/optional. `evidence` (`{segmentIndex, startMs, endMs}`) lets a reviewer jump to the exact transcript segment a motion/action item/summary was drawn from.

## Workflow state machine

`src/lib/labs/meeting-intelligence/state-machine.ts` supersedes the spike's stage list (PR #14) with the production set:

```
CREATED → UPLOAD_PENDING → UPLOADED → QUEUED → SUBMITTED_TO_PROVIDER →
TRANSCRIBING → TRANSCRIBED → GENERATING_MINUTES → DRAFT_READY → IN_REVIEW →
APPROVED
                                                        ↘ DRAFT_READY (regenerate)
FAILED ⇄ QUEUED (retry)          any non-CREATED stage → DELETED (recording cleanup)
CANCELLED → DELETED
```

`DELETED` is the only true dead end (`isTerminalStage`); `FAILED` is explicitly *not* terminal since it can retry back to `QUEUED`. `transitionJob()` is the **sole write path** for `MeetingIntelligenceJob.status` — no route or worker function writes the status column directly. It: looks up the job scoped by `organizationId` (tenant isolation), validates the transition against the allowed table (`InvalidTransitionError` otherwise), writes the stage-appropriate timestamp column, writes an audit event, and is idempotent (re-transitioning to the job's current state is a safe no-op — no duplicate writes, no duplicate audit events — important for a worker retry that re-observes a stage it already reached).

`FAILURE_HANDLING` documents, per stage, whether a failure is retryable, whether a platform operator is notified, and the organization-facing message — used by both the worker and the status UI.

## Storage architecture

Reuses the **existing** DigitalOcean Spaces integration (`src/lib/storage.ts` — `uploadBufferToSpaces`, `deleteObjectFromSpaces`, `getSignedObjectUrl`) — no new bucket, credential set, or storage primitive. `src/lib/labs/meeting-intelligence/storage.ts` adds the naming scheme:

- Recordings: `organizations/{organizationId}/meeting-intelligence/{meetingId}/{jobId}/source/{randomUUID}.{ext}` — exactly the path shape specified for this MVP. No filename, meeting title, or attendee text anywhere in the key (the original filename is stored separately in Postgres as `originalFilename`, sanitized of path separators, never used to build the storage key).
- Transcript artifacts: `organizations/{organizationId}/meeting-intelligence/{meetingId}/{jobId}/transcript/{randomUUID}.json` — a separate prefix from the recording, since it has a different retention window and far lower risk.
- Private objects only (`ACL: "private"`, inherited from `uploadBufferToSpaces`). Signed read URLs only, 1-hour TTL, generated server-side inside the worker — **no route ever returns a signed URL to a client**. No client-supplied storage key is ever accepted anywhere; every key is generated server-side with `randomUUID()`.

## RBAC

Five new permissions in `src/lib/rbac.ts`, following the existing `<resource>:<action>` convention:

```
meetingIntelligence:read
meetingIntelligence:create
meetingIntelligence:review
meetingIntelligence:approve
meetingIntelligence:delete
```

**Assignment**: `ORG_OWNER` and `ORG_ADMIN` get all five (mirroring `labs:read`'s existing distribution — this codebase has no dedicated "secretary" role, and meeting recordings are sensitive enough that a broader default felt wrong for a pilot). `FINANCE`, `STAFF`, `READ_ONLY`, and `MEMBER` get none. This is a purely additive change to the hardcoded default permission map (`ROLE_PERMISSIONS` in `rbac.ts`) — no `OrgRolePermissionSet` row (per-organization custom role overrides) is touched, so no organization's existing role customization is altered. `ORG_OWNER` cannot be customized at all (a hardcoded safety rail in `role-permissions.ts`), so APH's actual usage is unaffected by the override nuance regardless.

Every route requires its specific permission *and* Labs access — see `guard.ts`'s `requireMeetingIntelligenceAccess()`, which composes `requirePermission()` (tenant RBAC) with `requireOrganizationLabFeature()` (Labs entitlement + enrollment). `approve` is a distinct permission from `review` at the code level — a user with only `:review` cannot call the approve route, even though both happen to map to the same two roles in this MVP's default assignment.

## Labs entitlement and enrollment behavior

`meetingIntelligence` was already registered in the Labs foundation PR (#13): `lifecycle: "INTERNAL"`, `internalOnly: true`, `requiresEntitlement: true`, `requiresEnrollment: true`, `metered: true`. **This PR makes zero registry changes.** Every Meeting Intelligence route and page calls `requireOrganizationLabFeature(organizationId, "meetingIntelligence")` (or the composed `guard.ts`/`page-gate.ts` helpers) — internal-only status blocks any non-billing-exempt organization at both the read layer (the resolver) and the write layer (enrollment), inherited unchanged from the Labs foundation.

Billing exemption alone does **not** enable the feature — APH still needs an explicit `OrganizationLabFeature` enrollment row with `status: ENABLED`, created the same way `labsFrameworkPreview`'s was: via the Operations Center (`/admin/platform/labs`), not by billing-exempt status alone. `PlatformAccess` grants nothing here either — inherited from the Labs framework's own decoupling guarantee (verified by a dedicated test in the Labs foundation, unchanged).

### Enrollment-disabled-mid-flight policy (Phase 5)

- A `QUEUED` job whose organization is no longer Labs-entitled/enrolled is **never submitted** to the provider — it fails immediately with `MEETING_INTELLIGENCE_ENROLLMENT_DISABLED`.
- A job already `SUBMITTED_TO_PROVIDER`/`TRANSCRIBING` is allowed to **finish retrieving its transcript** — the vendor is already processing it, and retrieval is completing already-committed work, not starting something new.
- Minutes generation (a genuinely new AI-processing step) is **re-gated**: if enrollment was disabled by the time the transcript is ready, the job stops at `TRANSCRIBED` (marked `FAILED` with `MEETING_INTELLIGENCE_ENROLLMENT_DISABLED`) rather than generating a new draft. The transcript itself is preserved for audit/deletion — nothing is silently lost.

## APH pilot enrollment

**No new migration auto-enrolls APH in `meetingIntelligence`.** Unlike `labsFrameworkPreview` (seeded `ENABLED` by the Labs foundation migration), `meetingIntelligence` requires an explicit action in the existing Operations Center (`/admin/platform/labs`) — the same `setOrganizationLabEnrollment()` write path already built and tested in PR #13. This was a deliberate choice, not an oversight: automatic enrollment risks silently activating a much higher-risk capability (real audio processing, real third-party AI calls) the moment this PR deploys, whereas the existing Ops Center flow requires a human to explicitly click "Enable" for `meetingIntelligence` against APH's specific organization id, with the same audit trail and internal-only safety check already built. See "Pilot launch checklist" below for the exact steps.

## Human review and approval

- **Transcript Review** (`/labs/meeting-intelligence/jobs/[jobId]/transcript`): full transcript with search, per-segment speaker label + confidence, and a speaker-rename form. Renaming writes only a display-overlay (`MeetingTranscript.speakerLabelMapJson`) — the original vendor segments (`segmentsJson`) are never modified, preserving an audit-safe original record. No biometric identification exists anywhere in this feature; a rename is never presented as verified identity.
- **Draft Minutes** (`/labs/meeting-intelligence/jobs/[jobId]/minutes`): every section editable while the draft is `DRAFT`/`IN_REVIEW`/`REJECTED`. "Mark Ready for Review" (`DRAFT → IN_REVIEW`), "Approve" (`meetingIntelligence:approve` only), "Reject" (with an optional reason, keeps the draft editable), "Regenerate" (creates a new version, marks the previous `SUPERSEDED`, never deletes it).
- **Approval is immutable by construction**: `editMeetingMinutesDraft()` refuses to write to a draft whose status is `APPROVED` or `SUPERSEDED` — there is no code path anywhere that mutates an approved row's content. Requesting changes after approval means regenerating a *new* version (`version + 1`), not editing the approved one.
- **No automatic approval path exists anywhere** — `approveMeetingMinutesDraft()` is only ever reachable via an explicit authenticated call with a real `actorUserId`, and always records the approving user, timestamp, and an audit event.
- Version history is a plain list of `MeetingMinutesDraft` rows ordered by `version` — nothing is ever deleted, only marked `SUPERSEDED`.

## Error contract

Every Meeting Intelligence error is a `MeetingIntelligenceError` (`src/lib/labs/meeting-intelligence/errors.ts`) with a stable code, a fixed HTTP status, and a `retryable` flag — caught centrally in the existing `withApiErrorHandling` (`src/lib/api-route.ts`, extended with one new branch) and serialized as:

```json
{ "ok": false, "error": "Transcription failed. This has been automatically retried once...", "code": "MEETING_INTELLIGENCE_TRANSCRIPTION_FAILED", "retryable": true }
```

Codes: `MEETING_INTELLIGENCE_NOT_ENABLED`, `_FILE_UNSUPPORTED`, `_FILE_TOO_LARGE`, `_UPLOAD_NOT_FOUND`, `_UPLOAD_EXPIRED`, `_STORAGE_OBJECT_MISSING`, `_PROVIDER_UNAVAILABLE`, `_PROVIDER_RATE_LIMITED`, `_PROVIDER_TIMEOUT`, `_INVALID_PROVIDER_RESPONSE`, `_TRANSCRIPTION_FAILED`, `_GENERATION_FAILED`, `_JOB_NOT_FOUND`, `_JOB_CANCELLED`, `_INVALID_TRANSITION`, `_ENROLLMENT_DISABLED`, `_PERMISSION_DENIED`, `_ORGANIZATION_ARCHIVED`, `_CONSENT_REQUIRED`, `_DRAFT_NOT_EDITABLE`, `_EXPORT_NOT_APPROVED`. No route returns a generic 500 for an expected denial.

## Usage metering

`src/lib/labs/meeting-intelligence/usage.ts` composes the generic `recordLabUsage()` (Labs foundation), which required extending `LAB_USAGE_UNITS` (`src/lib/labs/usage.ts`) with six new reserved units: `audio_minutes_uploaded`, `audio_minutes_transcribed`, `transcription_jobs`, `minutes_generation_jobs`, `transcription_provider_cost_estimate`, `generation_cost_estimate`. Cost-estimate units record a dollar-cents quantity, not a duration.

`audio_minutes_uploaded` is recorded **once the real duration is known** (when the provider reports it, during transcript retrieval) rather than at literal upload time — no bytes-to-minutes estimate is ever fabricated from file size alone.

All vendor-pricing constants live in one isolated, clearly labeled file — `cost-constants.ts` — explicitly documented as illustrative approximations requiring periodic review, not a live quote. **Not connected to Stripe anywhere; no charge, no invoice, no Stripe product/price created.**

## Audit logging

Every lifecycle action is audited via the existing `createAuditEvent()`: job created, upload confirmed, transcription submitted/completed/failed, draft generated/edited, speaker labels changed, review requested, draft approved/rejected, export generated, job cancelled, recording deleted, transcript deleted. **Metadata never contains transcript content, draft content, meeting titles, attendee names, or recording filenames** — only ids, counts, and status strings (verified by dedicated tests, e.g. the speaker-rename audit event contains only the renamed label keys, never the renamed-to value).

## Retention and deletion

- **Source recordings**: deleted automatically 30 days after creation (`RECORDING_RETENTION_DAYS`), via a scheduled cron job (`/api/cron/meeting-intelligence-retention`, `worker:meeting-intelligence-retention`) that only touches settled-stage jobs (`DRAFT_READY`/`IN_REVIEW`/`APPROVED`/`FAILED`/`CANCELLED`) with a storage object still present. This job has **no code path that references `MeetingMinutesDraft` at all** — it can never silently delete official minutes, by construction, not just by convention.
- **Transcripts**: retained until the organization's own data-deletion policy removes them (no automatic expiry in this MVP); manually deletable via `DELETE /api/labs/meeting-intelligence/jobs/[jobId]/transcript`, which requires an explicit `acknowledgeRegenerationImpossible: true` confirmation in the request body and preserves every `MeetingMinutesDraft` row regardless of status.
- **Draft/approved minutes**: never automatically deleted by any job in this codebase — retained as meeting records.
- **Manual recording deletion**: `DELETE /api/labs/meeting-intelligence/jobs/[jobId]/recording` (requires `meetingIntelligence:delete`) — moves the job to `DELETED`, removes the storage object, and is audited. `MeetingMinutesDraft.status` is an entirely separate axis from `MeetingIntelligenceJob.status` — deleting a recording after its minutes were approved never touches the approved draft's own status.

## Privacy and consent

Before any upload, the uploader must explicitly confirm all five statements (`src/lib/labs/meeting-intelligence/consent.ts`, `requireMeetingIntelligenceConsent()` — fails closed, none default to true):

1. Participants were notified of recording, or consented, as required.
2. The uploader is authorized to process this recording.
3. The recording may contain sensitive information, processed by third-party AI services.
4. AI-generated minutes are a draft only, requiring human verification.
5. The organization is responsible for retention and legal obligations.

The confirmation timestamp and acting user are stored on the job (`consentConfirmedAt`, `consentConfirmedByUserId`).

### Privacy limitations — explicit, no compliance claim

**This is an internal technical pilot, not a compliance-certified system.** No HIPAA, FERPA, GDPR, or other regulatory-framework compliance is claimed or implied anywhere in this feature. For the APH pilot specifically: **do not upload recordings containing** protected health information, psychotherapy content, patient identifiers, highly sensitive personnel matters, confidential legal advice, payment card information, or passwords/security credentials. This warning is shown directly in the upload UI (`InternalPilotBanner`) and documented in `consent.ts`'s `SENSITIVE_CONTENT_WARNING`.

## Failure handling and retry

See the workflow state machine's `FAILURE_HANDLING` table above. Retries are **explicit** (a "Retry" button calling `POST /api/labs/meeting-intelligence/jobs/[jobId]/retry`, only shown when `status === "FAILED"` and the stage's `retryable` flag is true), **bounded** (only `FAILED → QUEUED` is a valid transition — a job cannot be retried indefinitely from an already-terminal state like `CANCELLED`/`DELETED`), and **idempotent** (the worker's transcript-creation step checks for an existing `MeetingTranscript` row before creating one, so a repeated poll of an already-transcribed job never creates a duplicate; provider submission only happens once since a job leaves `QUEUED` the moment it's picked up).

## Export behavior

`src/lib/labs/meeting-intelligence/export/` — DOCX (via the new `docx` npm dependency) and PDF (via the existing `pdf-lib`, matching `src/lib/reports/exporters.ts`'s pattern). Both formats:

- Include: organization name, meeting title, date, attendance, agenda, discussion summary, motions/votes, decisions, action items, next meeting, and (for an approved export) the approving user's name and timestamp.
- **Never include raw transcript content** — the export input type (`MinutesExportInput`) only carries the structured minutes, not the transcript, so this is true by construction rather than a filter step that could be forgotten.
- A non-approved (`DRAFT`/`IN_REVIEW`/`REJECTED`) export renders a visible **"DRAFT — NOT OFFICIAL"** watermark plus the AI disclaimer, in both DOCX and PDF. Only an `APPROVED` draft's export omits the watermark and shows approval metadata instead.

### Labs entitlement vs. `pdfExport` entitlement — how they interact

The export route (`GET /api/labs/meeting-intelligence/jobs/[jobId]/export`) is gated by **two independent systems, deliberately not merged into one check**:

1. `requireMeetingIntelligenceAccess` (Labs + tenant RBAC) — the primary gate for this entire internal-pilot feature.
2. For `format=pdf` specifically, `requirePlanFeature(organizationId, "pdfExport")` — the **same** plan-entitlement system already used for report/member PDF exports (`docs/entitlements.md`), applied here for consistency.

APH Technologies is billing-exempt, which already resolves to the elite plan (`pdfExport: true`) — so check #2 never actually blocks the pilot today. It exists so the two entitlement systems don't silently diverge if Meeting Intelligence is ever extended to a non-billing-exempt organization in the future — a customer org enrolled in Meeting Intelligence but on a plan without `pdfExport` would correctly be blocked from the PDF format (though not DOCX, which carries no such check, matching how CSV/XLSX report exports are never `pdfExport`-gated either — only the PDF *format* is). This is documented here explicitly per the task's instruction not to create contradictory or duplicative access logic.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `ASSEMBLYAI_API_KEY` | For real transcription | Read directly from `process.env` at call time (not via `getServerEnv()` — same convention as `CRON_SECRET`). Missing → `MEETING_INTELLIGENCE_PROVIDER_UNAVAILABLE` when the feature is actually used, never blocks app boot. |
| `MEETING_INTELLIGENCE_PROVIDER` | No | Overrides the default transcription provider selection (`assemblyai`). |
| `OPENAI_API_KEY` | For AI-generated minutes | Missing → falls back to the deterministic (non-AI) generator automatically; never blocks app boot. |
| `CRON_SECRET` | Yes (already required) | Existing bearer-auth secret, reused for the two new cron routes. |
| `DO_SPACES_*` | Yes (already required) | Existing Spaces credentials, reused as-is — no new storage credentials. |

**No new required environment variable was added to the strict production schema** (`src/lib/env.ts`) — all three new variables are optional, read directly, matching the existing `CRON_SECRET` convention, so a missing credential degrades this one internal-pilot feature rather than breaking the whole application.

## Operational runbook

- **Enable for APH**: Operations Center → Unestra Labs (`/admin/platform/labs`) → find/create the `meetingIntelligence` enrollment row for APH Technologies' organization id → set status `ENABLED`.
- **Disable**: same page, set status `DISABLED` or `SUSPENDED`. In-flight jobs already past `SUBMITTED_TO_PROVIDER` will still complete their transcript retrieval (see "enrollment-disabled-mid-flight policy" above) but won't proceed to minutes generation.
- **Run the worker manually** (until a scheduled cron is wired up in the hosting platform): `npm run worker:meeting-intelligence` (submission + polling) and `npm run worker:meeting-intelligence-retention` (30-day recording cleanup).
- **Delete all pilot data for an organization**: (1) `DELETE .../recording` for every job to remove storage objects, (2) `DELETE .../transcript` for every job (with acknowledgement) to remove transcript rows, (3) `MeetingMinutesDraft` rows are retained as meeting records by design — no code path deletes them; a manual database operation would be required if full deletion is ever needed, which is intentionally not automated given they're meeting records.
- **Monitor**: `AuditEvent` rows with `resource: "meeting_intelligence_job"` or `"meeting_minutes_draft"`; job `status`/`failureCode`/`failureMessage` columns for stuck/failed jobs.

## Known limitations

- Upload is a **server-relay** (client → our API route → Spaces), not a presigned direct-to-Spaces upload — simpler for this MVP, but large files (hundreds of MB) may be constrained by the hosting platform's own request-body limits. A future iteration should consider a presigned-upload flow for large recordings.
- `cancel()` is not implemented on the AssemblyAI adapter (vendor limitation, documented above) — our own `CANCELLED` status only stops us from polling further, it does not stop vendor-side processing already in flight.
- No access-logging (who viewed a transcript/recording) beyond the general audit trail of state changes — deferred, not needed to validate this MVP.
- The minutes editor UI is functional but intentionally simple (plain text areas for list fields) — no rich-text editing, no drag-and-drop reordering.
- No automated migration enrolls APH — see "APH pilot enrollment" above; this is deliberate, not an oversight.

## Deferred roadmap

- A dedicated `meetingIntelligence:review`-vs-`:approve` role distinction beyond ORG_OWNER/ORG_ADMIN (e.g. a "Secretary" role) if the pilot shows a need for it.
- Presigned direct-to-Spaces upload for large recordings.
- Access logging for transcript/recording views.
- Provider webhook support (currently polling-only) once a stable public webhook endpoint strategy is decided.
- A second transcription provider (OpenAI Whisper, prototyped in the spike) if AssemblyAI's diarization/pricing/contract terms change.
- A real entitlement policy decision (and, separately, pricing) before any customer-facing rollout — see `docs/unestra-labs.md`'s general rollout process.

## Pilot launch checklist

1. Confirm this PR is merged and deployed, and the `20260719001436_add_meeting_intelligence_mvp` migration has applied to production (`prisma migrate status` shows no pending migrations).
2. Configure `ASSEMBLYAI_API_KEY` in the production environment (DigitalOcean App Platform secrets).
3. Optionally configure `OPENAI_API_KEY` for AI-generated minutes; without it, the deterministic fallback is used automatically.
4. Confirm `CRON_SECRET` is set (already required — reused, not new).
5. Wire the two new cron endpoints (`/api/cron/meeting-intelligence`, `/api/cron/meeting-intelligence-retention`) into the platform's scheduled-job configuration, or run the two worker scripts on a schedule manually during the pilot.
6. In the Operations Center (`/admin/platform/labs`), enroll APH Technologies' organization in `meetingIntelligence` with status `ENABLED`.
7. As an APH `ORG_OWNER`/`ORG_ADMIN`, confirm `/settings/labs` and the Meeting Intelligence action on a meeting detail page both appear.
8. Run one real end-to-end pilot meeting: upload a real (internal, non-sensitive) recording, confirm transcription completes, review/edit the draft, approve it, export both DOCX and PDF, and confirm the audit trail shows the full lifecycle.
9. Confirm the retention worker correctly identifies (in a dry run, or after 30 days) that only the source recording is deleted, never the transcript or minutes.
10. Review known limitations and deferred roadmap above with the pilot's stakeholders before wider internal use.
