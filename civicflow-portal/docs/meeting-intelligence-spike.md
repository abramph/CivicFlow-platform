# Meeting Intelligence — Technical Spike

**This is not the production Meeting Intelligence feature.** It is an internal technical spike — working prototypes, not a customer-facing feature — built to validate architecture, provider choice, privacy posture, cost, workflow, and operational feasibility *before* committing to a real implementation. Every module here is internal-only (`meetingIntelligence`, lifecycle `INTERNAL`, gated by the Unestra Labs framework — see `docs/unestra-labs.md`), visible only to APH Technologies, and uses zero real customer data, zero real recordings, zero production AI provider credentials, and zero Stripe/billing integration.

## Architecture

```
Create Meeting
    ↓
Start Recording  ──────┐
    ↓                  │ (or upload a pre-recorded file directly)
Recording Upload  ←────┘
    ↓
Storage (DigitalOcean Spaces, temporary — see Storage below)
    ↓
Background Queue
    ↓
Speech-to-Text (provider abstraction — see Provider Comparison)
    ↓
Speaker Segmentation (anonymous labels; mapping is a separate, human-confirmed step)
    ↓
AI Processing (transcript → structured draft minutes JSON)
    ↓
Draft Minutes (status: draft, always — no code path produces anything else)
    ↓
Secretary Review (edit, regenerate, or approve)
    ↓
Approval
    ↓
Official Minutes
    ↓
Archive
```

Implemented as a typed, testable state machine (`src/lib/labs/meeting-intelligence/workflow.ts`): 14 stages (`CREATED`, `RECORDING`, `UPLOADING`, `STORED`, `QUEUED`, `TRANSCRIBING`, `DIARIZING`, `AI_PROCESSING`, `DRAFT_READY`, `IN_REVIEW`, `APPROVED`, `ARCHIVED`, `FAILED`, `CANCELLED`), an explicit allowed-transition table, and a `validateJobHistory()` function a production job-tracking table can be checked against. `CREATED` can go straight to `UPLOADING` (a pre-recorded file) without live `RECORDING`. `IN_REVIEW` can loop back to `DRAFT_READY` (secretary requests regeneration). `FAILED` is **not** a terminal stage — it can return to `QUEUED` for a retry; only `ARCHIVED` and `CANCELLED` are true dead ends.

### Failure handling (per stage)

| Stage | Retryable | Operator notified | Organization sees |
|---|---|---|---|
| RECORDING | Yes | No (routine, self-service) | "Start a new recording or upload a file instead." |
| UPLOADING | Yes | No | "Please try uploading again — partial uploads aren't billed or processed." |
| QUEUED | Yes | Yes | "Processing hasn't started due to a system issue — we're on it." |
| TRANSCRIBING | Yes | Yes | "Transcription failed, auto-retried once." |
| DIARIZING | Yes | Yes | "Speaker separation failed — transcript still available without speaker labels." |
| AI_PROCESSING | Yes | Yes | "Draft minutes couldn't be generated — the raw transcript remains available, retry anytime." |

Modeled as data (`FAILURE_HANDLING`), not just prose, so it's directly testable and a production job processor can look up the right message/notification behavior per stage rather than re-deriving it.

## Provider comparison

Abstracted behind one interface (`MeetingTranscriptionProvider` in `src/lib/labs/meeting-intelligence/providers/types.ts`) — no calling code anywhere imports a provider SDK directly. Two prototype adapters exist, both **local mocks with zero network calls and zero API keys** (`providers/openai-provider.ts`, `providers/assemblyai-provider.ts`), generating deterministic synthetic transcripts from a request hash (`providers/mock-fixtures.ts`) so tests and the UI mock screens are stable and repeatable.

| | OpenAI (Whisper / gpt-4o-transcribe) | AssemblyAI (Speech-to-Text) |
|---|---|---|
| Speaker diarization | **No** — requires a separate pass (e.g. pyannote) layered on top | **Yes**, native |
| Webhook / async job support | No — synchronous request/response API | **Yes** — async job + webhook-on-completion |
| Supported formats | mp3, mp4, m4a, wav, webm | mp3, mp4, m4a, wav, webm |
| Max file size | 25 MB (per-request API limit) | 2 GB |
| Illustrative cost / 60 min | ~$0.36 | ~$0.27 |
| Enterprise readiness | High | High |
| Privacy controls (publicly documented) | Zero data retention option on eligible tiers, SOC 2 Type II, no training on API I/O by default | SOC 2 Type II, HIPAA-eligible tier (BAA available), EU data residency option |

**All pricing figures are illustrative approximations based on each provider's publicly documented rate cards at the time of writing — not a live quote. Confirm current pricing directly with each vendor before any production budget commitment.**

### Recommendation: AssemblyAI

Native diarization removes an entire architectural component (a separate speaker-separation pass and its own failure mode) that OpenAI's transcription API would otherwise require. Native webhook support fits a background-queue architecture (submit → queue → webhook-driven completion) far more naturally than a synchronous request that would need to hold a connection open for the length of a meeting. The larger file-size ceiling (2 GB vs. 25 MB) comfortably covers even multi-hour board meetings without needing to chunk uploads. The provider is selected via `resolveDefaultProviderId()` (an env var, defaulting to this recommendation) — never hard-coded — so this choice can change without a code change, and both adapters can run side by side for an ongoing quality comparison if desired.

## Recording architecture

**Not implemented in this spike — documentation only, per the task's explicit scope.**

- **Browser**: the MediaRecorder API (already broadly supported, no plugin) is the recommended capture path — records directly to a compressed format (webm/opus) the browser can produce without server-side transcoding.
- **Mobile**: Expo's `expo-av`/`expo-audio` recording APIs are the recommended capture path, producing m4a on iOS and either m4a or 3gp-equivalent on Android depending on configuration — normalize to m4a at upload time for consistency.
- **Uploads**: mp3, wav, m4a, mp4, webm all supported (matches both prototyped providers' format lists).
  - **Maximum file size**: recommend capping client-side uploads at 500 MB (comfortably covers a multi-hour meeting at a reasonable bitrate) even though AssemblyAI's own ceiling is higher — a smaller platform-side cap keeps upload duration and storage cost predictable.
  - **Recommended bitrate**: 32–64 kbps mono for speech (far lower than music-quality audio) — keeps file size and upload time low without meaningfully hurting transcription accuracy, since transcription models are trained on compressed speech audio, not high-fidelity music.
  - **Expected upload duration**: at 48 kbps mono, a 60-minute meeting is roughly 22 MB — a few seconds to low tens of seconds on a typical broadband/cellular connection, not a multi-minute wait.
  - **Retry behavior**: uploads should use a resumable/chunked strategy where the client platform supports it; on failure, the workflow's `UPLOADING` failure handling applies (retryable, no operator notification needed — routine and self-service, matching the failure-handling table above).

## Storage architecture

Reuses the platform's **existing** DigitalOcean Spaces integration (`src/lib/storage.ts` — `buildSafeObjectKey`, `uploadBufferToSpaces`, `getSignedObjectUrl`, already used for attachments, receipts, and report exports) — no new bucket, credential set, or storage primitive is needed for a production implementation. `src/lib/labs/meeting-intelligence/storage-design.ts` prototypes the naming/retention scheme by calling the real (pure, no-network) `buildSafeObjectKey()` helper:

- **Naming**: `meeting-recordings/{organizationId}/{meetingId}/{date}/{uuid}-{filename}` for raw audio; `meeting-artifacts/{organizationId}/{meetingId}/{transcript|draft-minutes}/{date}/{uuid}-{filename}` for generated artifacts — kept under a **separate prefix** from raw audio since artifacts have a much longer retention window and far lower storage cost/risk. The organization id as the top-level segment keeps a future bulk-deletion-by-organization operation to a single prefix scan.
- **Encryption**: at rest via Spaces' server-side encryption (matching the platform's existing Postgres-at-rest posture); in transit via TLS for every upload, download, and provider API call.
- **Lifecycle / retention**: raw audio deleted 30 days after processing completes (`DEFAULT_RECORDING_RETENTION_DAYS`); transcripts/generated minutes retained up to 365 days (`DEFAULT_TRANSCRIPT_RETENTION_DAYS`), organization-configurable in a production implementation.
- **Deletion**: `computeRecordingDeletionDate()`/`computeArtifactDeletionDate()` compute the exact deletion timestamp at upload/generation time and persist it alongside the job record, so a scheduled cleanup job never has to re-derive the retention window from (possibly since-changed) organization settings at delete time.
- **Signed URLs**: recordings are never accessed via a durable public link — `planRecordingStorage()` specifies a 1-hour signed-URL TTL, just long enough for the transcription provider to fetch the file once.
- **Temporary processing only**: recordings are **not stored permanently by default** — this is the core storage principle the whole design is built around; only the generated transcript/minutes (far smaller, far lower-risk) get the longer retention window.

## AI pipeline

`src/lib/labs/meeting-intelligence/minutes-generator.ts` prototypes the transcript → structured-minutes pipeline using **deterministic keyword/pattern extraction, not a real LLM call** — proving the *output contract* a production implementation must fill (a real implementation replaces the extraction functions with a single structured-output LLM call using the same `DraftMinutes` shape as its JSON schema) without needing AI provider credentials in this spike or making any external call from tests.

```ts
interface DraftMinutes {
  meetingTitle: string;
  generatedAt: string;
  status: "draft";              // hard-coded — no path to anything else in this module
  attendance: { speakerLabel: string; attendeeName: string | null }[];
  agenda: string[];
  discussionSummaries: { topic: string; summary: string }[];
  motions: { text: string; movedBy: string | null; secondedBy: string | null }[];
  votes: { motionText: string; result: "passed" | "failed" | "unrecorded" }[];
  actionItems: { description: string; owner: string | null; dueDate: string | null }[];
  decisions: string[];
  unresolvedIssues: string[];
  followUpTasks: string[];
  adjournment: { mentioned: boolean };
  aiDisclaimer: string;
}
```

`status` is always `"draft"` — there is no function anywhere in this spike that changes it. Promotion to official minutes is a human action (Secretary Review → Approval) entirely outside this module's scope.

## Speaker handling

Transcription providers only ever produce anonymous labels (`Speaker A`, `Speaker B`, ...). `src/lib/labs/meeting-intelligence/speaker-labeling.ts` prototypes two mapping methods:

1. **Attendee-list-order heuristic** (`proposeSpeakerMappingFromAttendeeList`) — assumes speakers roughly match attendee-list order (e.g. roll-call order). Deliberately low confidence (0.35 max) — a starting suggestion for a human to confirm, never auto-applied.
2. **Manual assignment** (`applyManualSpeakerMapping`) — the only path that ever produces `confidence: 1`, since it represents an explicit secretary confirmation.
3. **Future voice identification** — **documented, not implemented.** Biometric voice-print identification (matching a voice signature across meetings without per-meeting human confirmation) raises meaningfully different consent and retention requirements than the per-meeting manual-confirmation model above; this spike takes no position on whether to build it, only flags it as out of scope (`VOICE_IDENTIFICATION_STATUS = "not_implemented"`).

## Cost model

`src/lib/labs/meeting-intelligence/cost-model.ts`. **All rates are illustrative approximations — confirm current vendor and DigitalOcean pricing before treating any figure as a production budget. No billing, invoicing, or Stripe integration exists anywhere in this spike or is implied by these numbers.**

### Per-meeting cost (AssemblyAI, recommended provider)

| Duration | Transcription | Summarization | Storage + bandwidth | **Total** |
|---|---|---|---|---|
| 15 min | ~$0.07 | ~$0.04 | ~$0.00 | **~$0.11** |
| 30 min | ~$0.14 | ~$0.08 | ~$0.00 | **~$0.22** |
| 60 min | ~$0.27 | ~$0.15 | ~$0.01 | **~$0.43** |
| 90 min | ~$0.41 | ~$0.23 | ~$0.01 | **~$0.64** |

### Monthly operating cost (AssemblyAI, 45-minute average meeting)

| Meetings/month | Estimated total |
|---|---|
| 100 | ~$32 |
| 500 | ~$160 |
| 1,000 | ~$320 |
| 5,000 | ~$1,600 |

Cost scales linearly with volume (no tiered-discount modeling in this spike) — see `estimateMonthlyCostCents()` for the exact computation, and the live Cost Estimates mock page for both providers side by side.

## Privacy review

`src/lib/labs/meeting-intelligence/privacy.ts`. **No customer recordings and no real PHI have been used anywhere in this spike** — every meeting referenced in tests and the mock UI is synthetic fixture data.

| Topic | Status | Detail |
|---|---|---|
| Consent | Prototyped | `validateMeetingIntelligenceSubmission()` requires explicit trigger + notice acknowledgement before any processing — fails closed (nothing defaults to true). |
| Recording notices | Prototyped | `RECORDING_NOTICE_TEXT` — must be shown to participants before recording starts. |
| Retention | Documented | Raw audio: 30 days. Transcripts/minutes: 365 days, org-configurable in production. |
| Deletion | Documented | Automatic deletion job after the retention window; manual delete-on-request must be supported before production launch. |
| Encryption | Documented | TLS in transit; at rest via Spaces' server-side encryption, matching the platform's existing posture. |
| Audit trail | Prototyped | Enrollment changes already audited via the Labs framework; per-job processing audit events are a production task, not built here. |
| Access logging | Not built | Who viewed a transcript/recording — deferred to production. |
| Transcript editing | Documented | Secretary Review must support editing the draft before approval — the workflow models this stage; no editor UI is built in this spike. |
| Human approval | Prototyped | `DraftMinutes.status` is hard-coded `"draft"` with no code path to change it. |
| AI disclaimer | Prototyped | `AI_OUTPUT_DISCLAIMER`/`AI_MINUTES_DISCLAIMER` attached to every generated result. |
| Organization ownership | Prototyped | `validateMeetingIntelligenceSubmission()` requires explicit ownership confirmation. |
| Data portability | Documented | Export as JSON/PDF via the same exporters already built for reports (`docs/entitlements.md`'s `pdfExport` enforcement) — no new export mechanism needed. |

## Security review

- **Tenant isolation**: every Labs check resolves `organizationId` from `requirePermission()` (session-resolved), never client input — the API route test confirms this explicitly.
- **Labs gating**: `requireOrganizationLabFeature(organizationId, "meetingIntelligence")` gates the spike's one API route (`POST /api/labs/meeting-intelligence-spike/run`) and every mock UI page — `meetingIntelligence` is `internalOnly: true` in the registry (registered in the Labs foundation PR, unchanged here), so it can never be enabled for a non-billing-exempt organization, at both the read layer (resolver) and the write layer (`setOrganizationLabEnrollment`, from the Labs foundation).
- **`PlatformAccess` does not grant this spike's access** — inherited directly from the Labs framework's own decoupling guarantee (`docs/unestra-labs.md`); this spike adds no new platform-authorization surface.
- **No production API keys, no production billing, no external network calls** — verified by code review (both provider adapters are local mocks) and by test suite policy (zero real HTTP calls in any spike test).
- **No secrets, transcripts, or recordings in usage-metering metadata** — `recordMeetingIntelligenceUsage()`'s metadata is limited by `LabUsageMetadata`'s type (a flat record of primitives) to `provider`, `processingMs`, `estimatedCostCents` — a dedicated test asserts the metadata object contains exactly those three keys and nothing else.

## Performance expectations

Illustrative, based on each provider's publicly documented processing-speed ratios (not measured against a real workload in this spike): AssemblyAI processes at roughly 15% of real-time (a 60-minute meeting finishes in ~9 minutes), OpenAI's API at roughly 12% (~7 minutes) — but OpenAI's result would still need a separate diarization pass afterward, which is not included in that estimate and would add meaningfully to total latency.

## Failure scenarios

Covered exhaustively by the workflow state machine's `FAILURE_HANDLING` table (see Architecture above) — every stage that can fail has a defined retry policy, operator-notification decision, and organization-facing message, checked by tests (`workflow.test.ts`).

## Labs integration

`meetingIntelligence` was already registered in the Labs foundation PR (`src/lib/labs/registry.ts`): `lifecycle: "INTERNAL"`, `internalOnly: true`, `requiresEntitlement: true`, `requiresEnrollment: true`, `metered: true`. This spike makes no registry changes — it proves the registration is actually usable end to end: `requireOrganizationLabFeature(organizationId, "meetingIntelligence")` gates every mock page and the one API route; nothing is exposed to customers; **only APH Technologies can enable the prototype**, and only by an explicit Operations Center action (no migration auto-enrolls `meetingIntelligence` — unlike `labsFrameworkPreview`, which is seeded on by default, `meetingIntelligence` requires a deliberate enable click, matching its higher risk classification).

## Usage metering

`src/lib/labs/meeting-intelligence/usage.ts`'s `recordMeetingIntelligenceUsage()` composes the generic `recordLabUsage()` from the Labs foundation — proving a real capability builds on the generic interface rather than inventing its own tracking. Records `unit: "audio_minutes"`, `quantity` (from transcript duration), and `metadata: { provider, processingMs, estimatedCostCents }` per run. **Not connected to Stripe — no charge, no invoice, no Stripe product/price created anywhere in this spike.**

## UI prototype

Seven mock pages under `/labs/meeting-intelligence-spike/*`, every one gated by the same `requireOrganizationLabFeature` check and carrying a `PrototypeBanner` component ("Prototype — Technical Spike... no production functionality... every meeting shown here is synthetic fixture data"):

- **Overview** — what the spike proves, workflow stage list, "run a synthetic job" action.
- **Recent Jobs** — four fixed fixture entries (not database-backed).
- **Transcript Review** (`jobs/[jobId]`) — full transcript + speaker mapping for one fixture job.
- **Draft Minutes** (`jobs/[jobId]/draft-minutes`) — structured minutes rendering with the AI disclaimer prominently shown.
- **Provider Diagnostics** — capability + cost comparison table, recommended provider highlighted.
- **Cost Estimates** — the per-meeting and monthly tables above, computed live from the cost model (not hard-coded into the page).
- **Privacy Information** — the full privacy checklist, retention windows, recording notice text.

## Tests added

74 new tests across 11 files: provider abstraction (12), workflow state machine + failure handling (13), speaker labeling (6), minutes generator (11), cost model (6), privacy validation + checklist (7), storage naming/retention (6), usage-metering composition (2), end-to-end pipeline (6), and the API route's Labs-gating/tenant-isolation behavior (5). Every test runs with zero external network calls — provider adapters are local mocks, `buildSafeObjectKey` is a pure function.

## Total tests passing

**746 total, up from 672** before this spike.

## Build / typecheck / lint results

- **Typecheck**: clean — the 5 remaining `tsc` errors are the same pre-existing, unrelated `migration-import.test.ts` errors noted in prior PRs.
- **Lint**: clean on every new/changed file; full-repo baseline unchanged at 11 pre-existing errors.
- **Production build**: clean — all 8 new routes (7 pages + 1 API route) built with no errors.
- **Prisma**: no schema changes in this PR (confirmed via `git status` on `prisma/`) — `meetingIntelligence` and the `OrganizationLabFeature`/`LabUsageEvent` tables already existed from the Labs foundation PR.
- **Secret scan**: manual pattern scan of the full diff, clean.

## Future roadmap / production implementation recommendations

1. Confirm AssemblyAI pricing and contract terms directly (current rate card, BAA availability if handling any sensitive organizational content, data-residency options for organizations that need them).
2. Replace the rule-based `minutes-generator.ts` with a real structured-output LLM call (Claude or GPT), using `DraftMinutes` as the target JSON schema — the schema and every consumer of it (UI, tests) stay unchanged.
3. Build the real recording capture (MediaRecorder for browser, Expo audio for mobile) and a real upload endpoint using the existing `src/lib/storage.ts` primitives with the naming/retention scheme this spike already validated.
4. Build a real `MeetingIntelligenceJob` Prisma model whose `stage` column is validated against `workflow.ts`'s `MEETING_JOB_STAGES`/`canTransition()` — this spike's state machine was designed to be that validation layer from day one.
5. Wire a real background queue (the platform already has a worker pattern — see `src/workers/campaigns.ts` — for reference) that calls the provider abstraction, re-checking `requireOrganizationLabFeature` at execution time, not just at enqueue time (same pattern established for email campaigns in `docs/entitlements.md`).
6. Build the Transcript Review / Secretary Review editing UI (this spike renders read-only mock data; production needs real editing before approval).
7. Add a real `meetings:transcribe` (or similar) tenant RBAC permission, checked alongside `requireOrganizationLabFeature` — the same two-axis pattern documented in `docs/unestra-labs.md`.
8. Run an internal APH pilot on real (APH's own) meetings before considering any customer-facing rollout, per the rollout process in `docs/unestra-labs.md`.
9. Only after a successful internal pilot: define the real entitlement policy (is elite-only actually right for this feature specifically?) and get explicit product/pricing sign-off before promoting `meetingIntelligence`'s lifecycle out of `INTERNAL`.
