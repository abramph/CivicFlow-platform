# SMS Compliance & Billing Audit — 2026-09 (fix/sms-addon-compliance-and-entitlement)

Read-only audit of production SMS (code at `origin/main` = the deployed Build 27
commit) performed 2026-09-08, and the correction set implemented on this branch.
No telephone numbers, credentials, Twilio SIDs, or Stripe IDs appear in this
document by design.

## Findings

| # | Finding | Where (pre-fix) | Triage |
|---|---------|-----------------|--------|
| 1 | **Retry/cron consent defect.** `attemptSmsMessageResend` called `sendSms()` directly, so admin Retry and the cron sweep re-sent to recipients who had texted STOP after the original attempt failed. | `src/lib/sms-queue.ts` | **Release blocker** (TCPA) — fixed here |
| 2 | **Missing entitlement re-check on retries.** The retry path checked only the base subscription gate, not `getSmsEntitlement` — an org whose add-on was deactivated or suspended could still push queued messages out. | `src/lib/sms-queue.ts` | **Release blocker** — fixed here |
| 3 | **Billing-exempt enrollment defect.** `getSmsEntitlement` required a live `Subscription` row and never consulted `Organization.billingExempt`, so a billing-exempt org (all demo orgs) could never send SMS even after an explicit super-admin enrollment — the admin toggle produced a grant the send path then denied. | `src/lib/sms-entitlement.ts` | **Release blocker** for the demo-org enrollment plan — fixed here |
| 4 | **`STRIPE_PRICE_SMS_ADDON_MONTHLY` missing in production.** The paid purchase flow throws at runtime (fail-safe: before any DB write). The live Stripe product/price exist; only the env binding is absent. | production app spec (verified 2026-09-08); `src/lib/stripe.ts` | **Release blocker** for paid activation — env-var change documented below, deliberately **not** applied |
| 5 | **Uninvoiced $0.02 overage.** Usage above `smsMonthlyLimit` was metered (`smsUsedThisPeriod`) but never billed, while the UI advertised $0.02/message overage — a silent unbilled soft cap. | `src/lib/sms-entitlement.ts`, `src/components/app/SmsAddOnCard.tsx` | **Release blocker** (pricing integrity) — RESOLVED: owner selected Option A (hard stop) 2026-09-08; concurrency-safe enforcement + all overage copy removed on this branch (`docs/sms-overage-policy-options.md`) |
| 6 | **Stale internal toll-free verification tracker.** `PlatformSmsSettings.tollFreeVerificationStatus` says NOT_SUBMITTED with a null verification SID, while Twilio's authoritative status is approved — the super-admin SMS dashboard shows a false "unverified" banner. | DB singleton (verified read-only 2026-09-08) | **Cosmetic/operational** — refresh procedure below; no mutation in this branch |
| 7 | **Mobile composer capability gap.** The mobile campaign composer hardcodes SMS/EMAIL_AND_SMS as selectable and never fetches entitlement; a non-entitled org's admin discovers the block only via the server's ValidationError. Server enforcement is intact. | `civicflow-mobile/src/app/admin-campaigns/new.tsx` | **Deferred UX** — next mobile release only (see below); no mobile change in this branch |

Additional non-blocking observations from the audit, out of scope here: the web
campaign-create POST is unrate-limited while its mobile twin is throttled; no
claim step on the PENDING recipient batch (concurrent campaign sends can
double-dispatch); rate limits are IP-keyed rather than org-keyed; the
`mfaSmsEnabled` platform toggle is displayed but unenforced; `docs/sms-setup.md`
documents an `SMS_PROVIDER` variable that does not exist in code; OTP/MFA send
paths skip E.164 normalization.

## What this branch changes

1. **One canonical send-time decision** — `src/lib/sms-send-authorization.ts`
   (`authorizeSmsSend`). Applied immediately before every
   **organization-message** Twilio call:
   - initial campaign sends via `sendMemberSms` (`src/lib/sms-service.ts`);
   - manual admin Retry and the cron queue sweep via
     `attemptSmsMessageResend` (`src/lib/sms-queue.ts`), which both routes
     already funnel through.
   Every send attempt re-resolves fresh: platform configuration, org
   entitlement (platform switch, add-on, suspension, subscription or
   billing-exempt eligibility, quota pre-check), E.164 normalization,
   tenant-scoped recipient identity, and consent (opt-in hard, STOP hard —
   including for `required` sends and all retries; the preference toggle
   alone is bypassable by `required`). **A member is mandatory:**
   `SendMemberSmsParams.memberId` is a required field, a null memberId (or a
   removed/cross-tenant member, or a retry row whose `memberId` was nulled by
   member deletion) is always a denial — organization messaging without a
   verifiable roster member never reaches Twilio, on either path.
   Denials are recorded through the existing FAILED-row/`errorMessage`
   convention; Twilio is never called for a blocked row; the retry route's
   atomic FAILED→RETRYING claim (concurrency guard) is untouched; no phone
   numbers or bodies are logged.
   *Scope note:* MFA sign-in codes, login verification, and user-requested
   phone-verification texts intentionally use the lower-level transactional
   `sendSms()` (platform-wide switches only) — they are outside the
   organization add-on entitlement and this member-consent model, since
   their recipient is the authenticating user's own just-provided number.
2. **Billing-exempt semantics + Stripe-bypass guard**
   (`src/lib/sms-entitlement.ts`,
   `src/app/api/admin/sms/organizations/[id]/route.ts`): `billingExempt`
   satisfies only the base-subscription prerequisite; explicit
   `smsAddOnActive` enrollment is still required; exemption alone never
   grants SMS, and removing an org's exemption reconciles immediately
   because entitlement is recomputed live (tested). The super-admin endpoint
   is now **enforced** (not just documented) as the exempt-orgs-only
   enrollment path: it 404s on a nonexistent organization, refuses to newly
   activate a non-exempt organization (those must purchase via the Stripe
   subscription-item flow at `/api/billing/sms-addon`), keeps already-active
   re-sends idempotent without opening a bypass, and requires a trimmed
   non-empty reason (≤500 chars) for every activation/deactivation. Distinct
   `sms_admin.addon_activated` / `sms_admin.addon_deactivated` audit events
   carry actor, organization, reason, quota, and before/after state. The
   route never touches Stripe (no fake customer, subscription, invoice, or
   line item). Every genuine inactive→active enrollment (including
   reactivation) initializes a clean monthly billing window —
   `smsBillingPeriodStart` = now (UTC), `End` = one month later, usage and
   threshold-notification state zeroed — and is rejected unless the
   resulting monthly quota is positive; idempotent re-sends of
   `smsAddOnActive: true` never reset a live period, and deactivation
   preserves historical counters.
3. **Hard-stop quota, concurrency-safe** (owner-selected Option A,
   `SMS_OVERAGE_POLICY = "hard_stop"`): the quota is enforced by a
   **database-atomic reservation** — `reserveSmsAllowance()` issues one
   conditional `UPDATE ... WHERE smsUsedThisPeriod < smsMonthlyLimit`
   (row-locked by Postgres) immediately before each Twilio call on both send
   paths, so with N concurrent workers and R remaining allowance exactly R
   sends can reach Twilio (integration-tested at the exact 999/1,000
   boundary with 20 racers). A successful reservation returns a
   **period-bound token** (`SmsAllowanceReservation`: the organization plus
   the exact post-update `smsBillingPeriodStart`/`End` the unit was charged
   into, straight from the UPDATE's `RETURNING`); a synchronous Twilio
   failure releases against that token only — `releaseSmsAllowance()`
   decrements solely where the organization AND both period columns still
   match (`IS NOT DISTINCT FROM`, so NULL periods compare), so a stale
   release from before a rollover or webhook reconciliation affects zero
   rows and can never erase a newer period's successful send or reopen
   capacity (integration-tested: reserve in period A → roll into period B →
   send in B → release A → B still shows its one used unit). Floor-guarded
   at zero as before. A crash between reservation and send conservatively
   consumes the unit — we accept losing capacity over any risk of an
   over-quota send, and avoiding that would need a per-message reservation
   ledger (schema change, not authorized). The same statement atomically
   rolls an elapsed billing period (reset-and-claim) and defensively
   initializes a legacy NULL-period row as a fresh month (claimed as unit
   #1, zero-limit rows still refused); `getSmsEntitlement`'s lazy rollover
   is conditioned on the exact period it read, and a check that LOSES that
   CAS refetches the winner's fresh counter instead of keeping the stale
   at-limit value — concurrent entitlement checks during rollover cannot
   falsely strand available capacity (integration-tested), and the atomic
   reservation remains the sole final quota authority immediately before
   Twilio. Retried sends consume quota like first sends (the original
   failure released its unit). All
   customer-facing $0.02/message overage promises were removed (billing
   card, 100%-threshold email, billing API response, docs); approved
   wording: "$10/month includes up to 1,000 messages. Sending pauses when
   the monthly allowance is reached; contact support to increase your
   limit." The `smsOverageRateCents` column remains internal-only.
4. **Single-owner retries and exactly-once finalization** (Round 4):
   every retry attempt — manual admin Retry and the cron sweep alike — must
   first win an atomic database lease (`claimSmsRetryAttempt` in
   `lib/sms-queue.ts`, one CAS over existing columns: eligible `RETRYING`
   or lease-expired `SENDING` rows transition to `SENDING` with the lease
   expiry stored in `nextRetryAt`, +2 minutes). Exactly one concurrent
   worker wins; `retryCount` increments inside that CAS, once per claimed
   attempt; the manual route only makes a FAILED row eligible
   (`nextRetryAt = now`, no increment) and then calls the same centralized
   executor, auditing once per claim it actually won. A crashed worker's
   row is recoverable only after its lease expires, through the same CAS.
   The lease value doubles as a fencing token: terminal commits go through
   `lib/sms-attempt-finalization.ts`, whose conditional transition requires
   the in-flight state (`QUEUED` for initial sends; `SENDING` + the
   worker's exact lease value for retries) — a stale worker matches zero
   rows and can neither overwrite a recovered attempt's result nor release
   quota, and the request path can never overwrite a webhook-written
   terminal status (DELIVERED/FAILED). Allowance release happens ONLY
   inside the single winning FAILED transition, in the same transaction —
   one failed attempt returns at most one unit, replays release nothing,
   and a release can never erase a different successful attempt's unit
   (real-database-proven, incl. N concurrent duplicate finalizers). The
   Twilio HTTP request now has an explicit 30s timeout
   (`TWILIO_REQUEST_TIMEOUT_MS`, `AbortSignal.timeout`) — Node fetch's
   undici defaults (~300s) would have outlived the lease — giving a 4×
   margin under the 120s lease, asserted in tests; a timeout flows through
   the same one-time failure finalizer. Ordering on both paths: ownership →
   billing gate → canonical authorization → reservation immediately before
   Twilio → one fenced commit. No schema change: the `SENDING` enum value
   and `nextRetryAt` already existed.
5. **Campaign idempotency, truthful cancel, and ambiguous provider
   outcomes** (Round 5, owner-authorized migration):
   - **Database-enforced campaign idempotency**: partial unique index
     `SmsMessage_org_campaign_member_attempt_key` (migration
     `20260910120000_sms_campaign_member_unique_attempt`) allows at most ONE
     campaign SMS attempt per (organization, campaign, member). A
     unique-violation loser is treated as "already claimed/processed" — it
     resolves the existing canonical row and performs no claim, no
     reservation, and no Twilio call; delivery problems are handled by
     retrying that one row through the leased retry system.
     *Honest scope:* this protects the SMS boundary only — the shared
     `CommunicationRecipient` pipeline can still double-process a PENDING
     recipient's EMAIL/PUSH legs and its per-recipient bookkeeping under
     concurrent campaign invocations; that is a known, separate follow-up.
   - **Initial sends claim ownership**: `claimInitialSmsAttempt` moves the
     canonical row QUEUED → SENDING with the same lease/fence retries use
     (`retryCount` stays 0 for the original attempt; only recovery/retry
     claims increment). Losing the claim means the atomic admin Cancel won:
     nothing is reserved and Twilio is never called. There is no unfenced
     finalizer of any kind; a crashed initial attempt is recovered by the
     same lease-expiry sweep as retries.
   - **Atomic truthful cancel**: the Cancel route is one CAS over
     QUEUED/RETRYING. A row a worker already claimed returns "Message is
     already being sent … can no longer be cancelled"; only the single CAS
     winner writes the audit event; losers change nothing.
   - **Ambiguous provider outcomes**: `sendSms` now returns a discriminated
     outcome — `sent`, `definitive_failure` (platform gate or a definite
     Twilio non-success response), or `unknown` (timeout/abort, connection
     reset, any thrown transport error; never described as a provider
     rejection — Twilio publishes no verifiable idempotency key for message
     creation, so a blind retry could duplicate the text). Unknown outcomes
     do NOT release quota and are parked exactly once under the fence as
     `SENDING` with `nextRetryAt: null` and the honest error "Delivery
     outcome is unknown; verify in Twilio before retrying." — invisible to
     the cron sweep, unclaimable, un-retryable by the ordinary Retry
     button, un-cancellable, and displayed as-is in the admin queue table.
     *Reconciliation is a human step*: verify the SID-less attempt in the
     Twilio Console; resolving the parked row (to FAILED-for-retry or
     SENT) is a controlled platform-operator follow-up — deliberately not
     an endpoint yet.
   - **Webhook ordering**: a late non-terminal provider event (`queued`/
     `sending`/`sent`) can no longer regress an already-DELIVERED row;
     request-side finalization was already fenced away from webhook
     terminal states.
6. **Stripe config readiness**: `STRIPE_PRICE_SMS_ADDON_MONTHLY` added to the
   env schema (`src/lib/env.ts`, optional — required only by the paid flow)
   and `.env.example`; fail-closed behavior of `smsAddOnPriceId()` /
   `isSmsAddOnPriceId()` is tested; the GET billing endpoint is tested to
   never expose Stripe identifiers (or the legacy overage rate) to clients;
   audited billing-exempt enrollment is verified to work with no Stripe
   configuration at all.

One database migration exists, explicitly owner-authorized in Round 5:
`20260910120000_sms_campaign_member_unique_attempt` — a single additive
partial `CREATE UNIQUE INDEX` on `SmsMessage(organizationId, campaignId,
memberId) WHERE campaignId IS NOT NULL AND memberId IS NOT NULL`. It never
deletes or rewrites data; on conflicting duplicates it fails loudly and
applies nothing (real-database-tested). Pre-deployment duplicate check ran
read-only against production on 2026-09-10: 0 SmsMessage rows total, 0
campaign/member rows, 0 conflicting groups (no portal staging database
exists — `.env.staging` is an unfilled placeholder). Leaving the index in
place under a code rollback is safe: pre-Round-5 code never relied on it,
and a duplicate insert failing is the protective behavior. Everything else
uses existing fields (`Organization.billingExempt`,
`OrganizationSmsSettings.*`, `SmsMessage.memberId/status/nextRetryAt`).

## Deliberately NOT done in this branch

- No production data, environment, Twilio, or Stripe mutation of any kind.
- No organization enrollment or SMS entitlement grant.
- No live SMS.
- No mobile code change (would invalidate the shipped 1.1.0 artifacts).
- No schema migration beyond the single owner-authorized Round-5 additive
  index above (the reservation's crash-consumes-capacity tradeoff is still
  accepted precisely to avoid a reservation-ledger table, and production
  migration execution remains gated on the separate merge/deploy
  authorization).

(Two earlier bullets — "no customer-facing pricing copy change" and "no
decision on the overage policy" — described the pre-decision state and no
longer apply: the owner explicitly selected Option A on 2026-09-08, and the
approved hard-stop wording replaced the $0.02 overage copy on this branch.
See `docs/sms-overage-policy-options.md`.)

## Later production sequence (owner-authorized, in order — none performed here)

1. ~~Owner decides the overage policy~~ **DONE 2026-09-08: Option A
   (hard stop) selected and implemented on this branch**
   (`docs/sms-overage-policy-options.md`).
2. **Merge this PR** and deploy the portal normally.
3. **Env change (only if/when paid self-serve purchase should open):** in the
   DigitalOcean app spec for the portal, add env var
   `STRIPE_PRICE_SMS_ADDON_MONTHLY` (scope RUN_AND_BUILD_TIME) set to the
   live recurring monthly Stripe price of the "Unestra SMS Add-On" product
   (verified 2026-09-08: exists, active, $10.00/month, licensed). This
   triggers a redeploy. Verification: `POST /api/billing/sms-addon` for a
   subscribed test org no longer errors with the price-configuration message.
   Rollback: remove the env var (flow reverts to failing closed).
   NOT required for the demo-org enrollment path.
4. **Demo enrollment (separate authorization):** super-admin →
   SMS Administration → organizations → enable the chosen demo org with a
   plan/quota and a reason string (audited `sms_admin.addon_activated`).
5. **Live test (separate authorization):** one message to an owner-approved
   recipient number; verify the SmsMessage row and the delivery webhook.
- **Rollback of this branch:** revert the merge commit; no migration or data
  backfill to unwind.

## Toll-free verification tracker refresh (operational, do later)

The app has a supported refresh path: the super-admin SMS Administration page's
toll-free verification card calls
`POST /api/admin/sms/toll-free-verification/refresh`, which reads
`tollFreeVerificationSid` from the platform settings row and syncs status from
Twilio. That SID is currently null, so the supported procedure is: super-admin
opens Twilio Console → Regulatory Compliance → toll-free verification, copies
the verification SID into the SMS Administration credentials/verification
panel, then presses Refresh. Display-only; no Twilio-side change. Until then
the dashboard's "unverified" banner is cosmetic and wrong.

## Mobile follow-up (next mobile release, not this branch)

Add an entitlement-aware capability signal for the campaign composer — either
extend `GET /api/mobile/admin/campaigns/targeting-options` with an
`smsAvailable` boolean (server already knows via `getSmsEntitlement`) or a
dedicated capability endpoint — and disable the SMS/EMAIL_AND_SMS channel
options in `civicflow-mobile/src/app/admin-campaigns/new.tsx` when absent,
mirroring the web composer. Server-side enforcement already exists; this is
UX-only and must ride a normal mobile release (do not invalidate 1.1.0 (26)/vc15 artifacts).
