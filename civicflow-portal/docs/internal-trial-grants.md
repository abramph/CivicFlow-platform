# Internal Trial Grants

`feature/platform-admin-internal-trial-grant` — a platform-admin-only,
Stripe-free way to give an existing, non-billing-exempt, non-subscribed
organization 30 days of application access. Built for the Pine Grove PTA
volunteer-hours pilot, which needs authenticated access to exercise but is
deliberately not billing-exempt (that's a documented, separate decision —
see `docs/pta-volunteer-hours-pilot-plan.md`'s billing-exempt discussion).

## Purpose

Before this feature, the only two ways an organization could pass
`src/lib/subscription-gate.ts`'s access check were `billingExempt = true`
or an active Stripe-backed `Subscription` row. Neither fit a short-lived
internal pilot: `billingExempt` is a permanent, blanket exemption (used
today for 6 real internal/demo/reviewer orgs — see the list in
`docs/pta-volunteer-hours-pilot-plan.md`), and a `Subscription` row implies
a real Stripe relationship. An internal trial is the third option: **the
same mechanism every organization already gets for free at signup**
(`Organization.trialEndsAt`, set for 30 days in
`src/app/api/onboarding/organization/route.ts`), made available on-demand,
by a platform admin, for an organization that never went through that
signup flow (Pine Grove was created directly by the demo seed script,
`prisma/seed-pta-demo.ts`, so it has `trialEndsAt = null` — never set at
all, not merely expired).

## Fixed 30-day duration

`INTERNAL_TRIAL_DURATION_DAYS` in `src/lib/platform-operations/internal-trial.ts`.
Not configurable per-request — the grant API's request body accepts only
`reason` and `confirm`; there is no duration, start, or end field for a
client to supply. This mirrors the existing 30-day signup trial exactly, so
there is only one trial-length concept in the product, not two.

## Eligibility

All of the following must hold, or the grant is rejected (see
`InternalTrialErrorCode` for the exact machine-readable reason):

- The organization exists.
- `Organization.status === "active"` (not suspended or cancelled).
- `Organization.billingExempt === false` — an already-exempt org has no use
  for a trial.
- `Organization.trialEndsAt IS NULL` — **the one-time gate.** Both an
  active trial and an already-expired one fail this the same way (as `null`
  vs. non-`null`), which is exactly what makes the grant one-time: once
  set, `trialEndsAt` never returns to `null` (see Early Termination below).
- Zero `Subscription` rows exist for the organization, of any status. A
  canceled or past-due subscription still blocks a grant — if an org ever
  had a real billing relationship, an internal trial is not the right tool;
  that's a billing/support question instead.

None of this consults `Organization.name`. A org named
`"Unestra Demo PTA"` and a boringly-named org with identical field values
get identical eligibility outcomes — see the explicit unit test for this in
`internal-trial.test.ts`.

## Atomicity and anti-stacking

Enforced entirely inside `grantInternalOrganizationTrial()`, not the route:

1. Everything runs inside one `prisma.$transaction`.
2. Reads (`Organization`, `Subscription` count) happen first, throwing a
   precise `InternalTrialError` for any failed eligibility condition.
3. The actual grant is a conditional `updateMany`:
   ```ts
   organization.updateMany({
     where: { id, trialEndsAt: null, billingExempt: false, status: "active" },
     data: { trialEndsAt: expiresAt },
   })
   ```
   This is the real anti-stacking primitive — the same conditional-`updateMany`
   pattern already proven in this codebase for the report-export queue's
   atomic claim (`attemptClaimReportExport` in `report-export-queue.ts`).
   Two concurrent grant attempts for the same organization can both pass
   the read-time checks, but only one `UPDATE` can match `trialEndsAt: null`
   — Postgres serializes the two statements against the same row, and the
   loser's predicate no longer holds once the winner commits. `result.count
   !== 1` throws `INTERNAL_TRIAL_CONCURRENT_CONFLICT` (409).
4. A real-Postgres integration test
   (`internal-trial-concurrency.integration.test.ts`) proves this against
   an actual database, not just a mock — see that file for how to run it.

The audit event is written *after* the transaction commits (matching this
codebase's existing convention, e.g. `upsertPtaProfile`) — not inside it.

## No Stripe side effects

`src/lib/platform-operations/internal-trial.ts` imports only `@/lib/prisma`
and `@/lib/audit`. No Stripe SDK, no `stripe-connect.ts`, no Checkout
Session, no payment method, no invoice. The only database write is
`Organization.trialEndsAt` — the transaction's `updateMany` `data` clause
has exactly one key. `billingExempt`, `plan`, and every other Organization
column are untouched.

## Authorization

`requireSuperAdmin()` (`src/lib/auth-guards.ts`) — the same global,
organization-independent `PlatformAccess` guard used by every other
`/admin/platform` surface. No organization-level role (ORG_OWNER included)
grants this. The route additionally distinguishes unauthenticated (401)
from authenticated-but-not-platform-admin (403), since `requireSuperAdmin`
alone collapses both into 403 — see the route's `requireAuthenticatedSuperAdmin`
helper.

## Audit

Every successful grant: `platform.organization.internal_trial_granted`,
via `createAuditEvent`. Metadata: `actorRole`, `trialStartsAt`,
`trialExpiresAt`, `durationDays`, `reason`, `requestId` (currently always
`null` — see Idempotency below). A rejected/blocked attempt does not create
an audit event and never implies a trial was granted.

### Idempotency

The grant service accepts an optional `requestId` for traceability, but the
real correctness guarantee is the conditional `updateMany` above, not a
separate idempotency-key table (no such table exists elsewhere in this
codebase for admin writes — the report-export queue's claim and
`StripeWebhookEvent`'s unique-constraint pattern are the closest existing
precedents, and both are simpler primitives than a full idempotency-key
service). A retried request after a genuine success correctly receives
`INTERNAL_TRIAL_ALREADY_ACTIVE` (409), not a silent no-op success — which
is the right behavior for a one-time grant: there is nothing to "safely
replay" toward, since the trial must never be extended by a retry.

## API

`GET /api/admin/organizations/[organizationId]/internal-trial` — read-only
eligibility preview, powers the admin UI's pre-confirmation panel.

`POST /api/admin/organizations/[organizationId]/internal-trial` — grants
the trial. Body: `{ reason: string, confirm: true }`. Rate-limited
(`api:admin:organizations:internal-trial`, 10/60s). Responses: `201`
success, `400` invalid body, `401` unauthenticated, `403` not a platform
admin, `404` organization not found, `409` already-active/already-used/
billing-exempt/has-subscription/concurrent-conflict, `429` rate limited.

## UI

`InternalTrialManager` (`src/components/admin/InternalTrialManager.tsx`),
wired into the platform org-detail page
(`src/app/admin/platform/organizations/[organizationId]/page.tsx`), shown
only for non-billing-exempt organizations. Loads the eligibility preview on
mount and simply doesn't render a grant control when ineligible (the API
still enforces this independently — the UI check is a courtesy, not the
real gate). Two-step preview-then-confirm flow matching
`PrimaryVerticalManager`'s existing pattern: shows the organization name,
fixed 30-day duration and calculated expiration date, an explicit
no-Stripe/no-charge statement, a required reason field, and an
irreversibility warning before the confirm button is enabled.

## Expiration

No cron sweep, no scheduled job. Exactly like the existing signup trial,
`subscription-gate.ts`'s `resolveOrganizationAccess()` recomputes
`trialEndsAt > now` on every request against the authoritative server
clock — access ends the instant the 30 days elapse, and returns the
organization to `SUBSCRIPTION_REQUIRED`/`TRIAL_EXPIRED` denial unless it
separately becomes billing-exempt or gets a real subscription. Nothing new
was added to `subscription-gate.ts` for this feature — it already read
`trialEndsAt` for the signup trial case, and an internal trial uses the
exact same column, so the existing gate logic composes correctly with no
special-case/bypass code.

## Early termination

Implemented as `terminateInternalOrganizationTrialEarly()` in
`internal-trial.ts`, but **not currently wired to any route or UI control**
— deferred as documented follow-up (per the authorization: "if adding UI
materially expands scope... implement service first, document as
follow-up"). Behavior, per the minimal design the function actually
implements:

- Sets `trialEndsAt` to the current server time. Never lengthens or resets
  a trial — only shortens an already-active one.
- Never sets `trialEndsAt` back to `null` — so a terminated organization
  can never receive a second trial. This falls out of the *same*
  `trialEndsAt IS NULL` eligibility gate the normal grant path uses; no
  extra "don't re-grant after termination" code exists or is needed.
- Preserves the original grant's audit event; writes a separate
  `platform.organization.internal_trial_terminated` event with its own
  required reason.
- Rejects (`INTERNAL_TRIAL_NOT_ACTIVE`, 409) if there is no currently-active
  trial to end (already expired, or never granted).

**Manual recovery path until a UI/API is separately authorized**: invoke
the function directly via a short-lived `tsx` script against the
`civicflow-app`-scoped production credential, the same safe pattern already
used throughout this program for the Pine Grove reports-flag toggles (never
raw SQL, always the approved service function, always deleted immediately
after use, always producing a real audit event).

## Internal trial vs. the other three entitlement mechanisms

| Mechanism | Set by | Duration | Stripe involved | Reversible |
|---|---|---|---|---|
| Signup trial | Automatic, at org creation | 30 days, fixed | No | Expires naturally |
| **Internal trial (this feature)** | Platform admin, on demand | 30 days, fixed, one-time | No | Early-termination service exists (not yet wired to UI/API) |
| Billing exemption | No application code path — every current org got it via manual/seed setup | Indefinite | No | No supported "un-exempt" path exists today |
| Paid subscription | Stripe Checkout + webhook | Recurring, until canceled | Yes | Cancel via Stripe |

Reviewer/demo access (Apple's `Unestra Demo PTA`, Google's `Unestra Demo
Community`) uses billing exemption, not this feature — see the pre-existing
billing-exempt org list. This feature is deliberately not used for either
reviewer organization.

## Incident recovery

If a trial is granted to the wrong organization: use the early-termination
service function (see above) with a clear reason — this shortens access
immediately without touching `billingExempt` or fabricating a `Subscription`
row. If the grant service itself misbehaves (e.g., an unexpected
`INTERNAL_TRIAL_CONCURRENT_CONFLICT` under normal single-request use),
check `AuditEvent` rows with action `platform.organization.internal_trial_granted`
for the organization to see what was actually recorded, and the
`Organization.trialEndsAt` column directly — both are ordinary, readable
application state, not a separate ledger to reconcile.

## Pine Grove pilot — status

This document does **not** grant Pine Grove a trial. That remains a
separate, explicit action, to be taken only after this feature deploys and
is verified healthy — see the program's final report for the exact
next-authorized-action framing. `docs/pta-volunteer-hours-pilot-plan.md`
should be updated, after that grant happens, to record which mechanism
(internal trial, not billing exemption) resolved Pine Grove's access gap.
