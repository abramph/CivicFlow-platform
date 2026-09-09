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
| 5 | **Uninvoiced $0.02 overage.** Usage above `smsMonthlyLimit` was metered (`smsUsedThisPeriod`) but never billed, while the UI advertises $0.02/message overage — a silent unbilled soft cap. | `src/lib/sms-entitlement.ts`, `src/components/app/SmsAddOnCard.tsx` | **Release blocker** (pricing integrity) — fail-closed decision gate here; final policy is an owner decision (`docs/sms-overage-policy-options.md`) |
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
   (`authorizeSmsSend`). Applied immediately before every Twilio call:
   - initial campaign sends via `sendMemberSms` (`src/lib/sms-service.ts`);
   - manual admin Retry and the cron queue sweep via
     `attemptSmsMessageResend` (`src/lib/sms-queue.ts`), which both routes
     already funnel through.
   Every send attempt re-resolves fresh: platform configuration, org
   entitlement (platform switch, add-on, suspension, subscription or
   billing-exempt eligibility, quota policy), E.164 normalization,
   tenant-scoped recipient identity (`findFirst({ id, organizationId })` — a
   removed or cross-tenant member is a denial, and a retry row whose
   `memberId` was nulled by member deletion is blocked as unverifiable), and
   consent (opt-in hard, STOP hard — including for `required` sends and all
   retries; the preference toggle alone is bypassable by `required`).
   Denials are recorded through the existing FAILED-row/`errorMessage`
   convention; Twilio is never called for a blocked row; the retry route's
   atomic FAILED→RETRYING claim (concurrency guard) is untouched; no phone
   numbers or bodies are logged.
2. **Billing-exempt semantics** (`src/lib/sms-entitlement.ts`):
   `billingExempt` now satisfies only the base-subscription prerequisite.
   Explicit `smsAddOnActive` enrollment through the super-admin endpoint is
   still required; exemption alone never grants SMS. Because entitlement is
   recomputed live per send, removing an org's exemption reconciles
   immediately (tested). The super-admin endpoint
   (`src/app/api/admin/sms/organizations/[id]/route.ts`) now records
   distinct `sms_admin.addon_activated` / `sms_admin.addon_deactivated`
   audit events carrying actor, organization, reason, quota, and before/after
   state — and it still never touches Stripe (no fake customer, subscription,
   invoice, or line item for exempt orgs).
3. **Overage decision gate** (`src/lib/sms-pricing.ts`
   `SMS_OVERAGE_POLICY = "unresolved"`): new activations are refused on both
   the paid self-serve route and the super-admin route, and send-time quota
   hard-stops at `smsMonthlyLimit`, until the owner picks Option A or B in
   `docs/sms-overage-policy-options.md`. Customer-facing price copy is
   unchanged.
4. **Stripe config readiness**: `STRIPE_PRICE_SMS_ADDON_MONTHLY` added to the
   env schema (`src/lib/env.ts`, optional — required only by the paid flow)
   and `.env.example`; fail-closed behavior of `smsAddOnPriceId()` /
   `isSmsAddOnPriceId()` is tested; the GET billing endpoint is tested to
   never expose Stripe identifiers to clients; audited billing-exempt
   enrollment is verified to work with no Stripe configuration at all.

No database migration is required: every field used already exists
(`Organization.billingExempt`, `OrganizationSmsSettings.*`, `SmsMessage.memberId`).

## Deliberately NOT done in this branch

- No production data, environment, Twilio, or Stripe mutation of any kind.
- No organization enrollment or SMS entitlement grant.
- No live SMS.
- No mobile code change (would invalidate the shipped 1.1.0 artifacts).
- No customer-facing pricing copy change.
- No decision on the overage policy — that is the owner's.

## Later production sequence (owner-authorized, in order — none performed here)

1. **Owner decides the overage policy** (see `docs/sms-overage-policy-options.md`)
   and the chosen `SMS_OVERAGE_POLICY` value ships in a follow-up commit.
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
