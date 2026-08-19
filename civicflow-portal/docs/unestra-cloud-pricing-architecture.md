# Unestra Cloud Pricing — Architecture & Migration Record

Companion to `docs/entitlements.md` (feature/plan gating) and `docs/stripe-connect-architecture.md`
(member-to-org payments, which this program does not touch). This document is the audit +
target design for the 2026-08-18 pricing restructure: moving from a flat, vertical-blind
3-tier plan (`free`/`essential`/`elite`) to per-vertical, unlimited-member pricing.

## What existed before this program (audit findings, 2026-08-18)

The pre-existing system had **no vertical-aware pricing at all** — `plan-gate.ts` and
`plans.ts` never referenced `Organization.primaryVertical`. Every organization, regardless
of vertical, saw the same three plans:

| Plan | Monthly | Yearly | Member limit | Seats included |
| --- | ---: | ---: | ---: | ---: |
| `free` | $0 | $0 | 50 | 3 |
| `essential` | $49.00 | $539.00 | 500 | 3 |
| `elite` | $99.00 | $1,089.00 | Unlimited | 10 |

Member-cap enforcement was centralized in `checkMemberLimit()`/`requireMemberSlot()`
(`plan-gate.ts`) and reused consistently by every member-creation path (manual create,
mobile admin create, QR Member Intake self-registration, staff-approved intake review, and
all three import engines) — a single chokepoint, which made this restructure tractable.

**Zero rows existed in the `Subscription` table in production** at audit time — no real
Stripe-backed paying customers. Three organizations (1 Community, 2 PTA) had
`Organization.plan = "elite"` with no backing `Subscription` row, almost certainly set
directly via the `platform-admin.ts` CLI rather than real billing; harmless, not a
migration concern.

Six organizations had `Organization.billingExempt = true` (the schema comment claiming
"exactly one organization" was stale) — APH Technologies LLC, four synthetic demo orgs
(Demo Community, Demo PTA, Demo Church, Demo Union), and **Harris PTA, a real
organization** whose owner explicitly requested the exemption to test Member Intake. Every
plan-resolution function must check `billingExempt` first and short-circuit to full,
unlimited access — this program preserves that guarantee unchanged.

## Target design

**Vertical → price** (`OrganizationVertical` has 5 values; HOA folds into Community
pricing per explicit product decision — no separate HOA price point):

| Vertical | Monthly | Annual | Ordinary members |
| --- | ---: | ---: | --- |
| PTA / PTO | $49 | $490 | Unlimited |
| Community / Nonprofit (incl. HOA) | $59 | $590 | Unlimited |
| Church | $79 | $790 | Unlimited |
| Union | $129 | $1,290 | Unlimited |

**Internal plan keys** (`src/lib/plans.ts`): `pta_monthly`, `pta_annual`,
`community_monthly`, `community_annual`, `church_monthly`, `church_annual`,
`union_monthly`, `union_annual`. The legacy `free`/`essential`/`elite` keys are kept as a
read-compatibility fallback (`getPlan()` still resolves them) so historical
`Organization.plan`/`Subscription.plan` string values already in the database don't break,
but they are no longer sold — `essential`/`elite` are absent from
`/api/billing/checkout`'s accepted plan list going forward.

**Unlimited members is universal, not a plan feature.** Per explicit product direction,
member-count enforcement is removed outright (`checkMemberLimit`/`requireMemberSlot`
become permanent no-ops returning `allowed: true`) rather than being conditioned on which
plan an org is on — there is no paid tier left that has a member cap to upgrade out of.
Member count remains fully computed and reported (dashboards, Operations Center, vertical
reporting) — it becomes reporting data, not a pricing input.

**Administrator seats are unchanged.** `Organization.seatLimit`, `checkSeatLimit()`,
`requireSeatSlot()`, and `STAFF_SEAT_ROLES` are untouched by this program — seats are a
different concept from ordinary members (see the existing extensive comment in
`plan-gate.ts`) and this restructure does not invent new seat pricing. Every new Cloud plan
carries the same included-seats/additional-seat pricing the old `essential` tier had (3
included seats, $8.00/mo or $88.00/yr per additional seat) — this was not specified in the
product brief and is flagged here as a preserved-as-is assumption, not a new decision;
revisit explicitly if per-vertical seat pricing is ever wanted.

**Feature entitlements are not tiered by price** in this restructure — every Cloud plan
grants the same full entitlement bundle (`emailCampaigns`, `pdfExport`, `advancedReports`,
`apiAccess` all `true`), matching the old `elite` tier. Pricing here is driven by vertical,
not by a feature ladder; there was no differentiated per-vertical feature matrix in the
product brief. Flagged the same way as the seat assumption above.

**Stripe.** Existing architecture (env-var-resolved Price IDs, no hardcoded IDs, separate
platform (`/api/webhooks/stripe`) vs. Connect (`/api/webhooks/stripe-connect`) webhook
endpoints) is preserved unchanged — this program only adds new Price env-var keys and new
`PlanConfig` entries, it does not restructure the Stripe integration itself. New env keys
follow the existing naming convention: `STRIPE_PRICE_<PLAN>_MONTHLY` /
`STRIPE_PRICE_<PLAN>_YEARLY`, e.g. `STRIPE_PRICE_PTA_MONTHLY`. Stripe Price lookup keys (for
scripted Product/Price creation) follow the brief's suggested convention:
`unestra_cloud_pta_monthly`, etc. Stripe customer-facing Product name changes from
whatever was previously configured to **Unestra Cloud** (see `getOrCreateStripeCustomer()`'s
`metadata.product` field, already `"Unestra"` — unchanged, that's the main brand, not the
subscription product name shown on invoices).

**Server-side plan resolution only.** `/api/billing/checkout` already authenticates,
authorizes `billing:manage`, and resolves the Price ID entirely server-side from a client-
supplied `plan` **key** (never an amount or Price ID) — this pattern is preserved. The only
change is that the accepted `plan` values become the 8 new vertical-keyed IDs (validated
against the organization's actual `primaryVertical` server-side — a PTA org cannot check
out on a Union price by passing a different plan key).

**Branding.** The only customer-visible occurrence of "Unestra SaaS" found in the audit is
the `<h1>` on `src/components/LoginForm.tsx` (line 66) — changed to "Unestra Cloud" as part
of this program. All other "Unestra SaaS" occurrences are internal file-header comments and
documentation, not customer-facing, and are left alone (rewriting comments is not branding
work). Bundle IDs, package IDs, EAS project ID, App Store/Play Console identity, domains,
Stripe customer/subscription/Connect account IDs, and legal identity (`APH Technologies,
LLC`) are explicitly out of scope and untouched.

## Program sequencing (CLOUD-A .. CLOUD-H)

| PR | Scope |
| --- | --- |
| CLOUD-A | This document. Audit + architecture map. |
| CLOUD-B | Authoritative plan catalog (`plans.ts` v2) + tests. |
| CLOUD-C | Remove member-cap enforcement; member count becomes reporting-only. |
| CLOUD-D | Customer-facing pricing page + "Unestra Cloud" branding. |
| CLOUD-E | Stripe test-mode Products/Prices + checkout verification. |
| CLOUD-F | Database/backfill safety, special-account preservation checks. |
| CLOUD-G | Live Stripe Price preparation (requires explicit owner approval before any live-mode action). |
| CLOUD-H | Final verification + program report. |

Each PR is implemented, tested, typechecked, linted, built, committed, opened, merged, and
deployed before the next begins — no stacked unverified billing changes.

## CLOUD-E — Stripe test-mode objects (2026-08-19)

Account confirmed via the Stripe dashboard (logged-in browser session) before creating
anything, not assumed — the CLI's cached login initially pointed at a different, unrelated
account ("ThrivePath MHS") that had to be re-authenticated against the correct one first.

**Product**: `prod_V6ACsByLUhI4QI` ("Unestra Cloud"), test mode, account
`acct_1TrSGDJe9g4GsjEn` (APH Technologies, LLC).

**Prices** (lookup key → Price ID):

| Lookup key | Price ID | Amount |
| --- | --- | --- |
| `unestra_cloud_pta_monthly` | `price_1U5xsEJe9g4GsjEnqtKzp6Yw` | $49.00/mo |
| `unestra_cloud_pta_annual` | `price_1U5xsFJe9g4GsjEnuMowWeaP` | $490.00/yr |
| `unestra_cloud_community_monthly` | `price_1U5xsFJe9g4GsjEnGuhv4oF0` | $59.00/mo |
| `unestra_cloud_community_annual` | `price_1U5xsFJe9g4GsjEnCObIKhaU` | $590.00/yr |
| `unestra_cloud_church_monthly` | `price_1U5xsGJe9g4GsjEnsFdSBSTo` | $79.00/mo |
| `unestra_cloud_church_annual` | `price_1U5xsGJe9g4GsjEntrLjhvKU` | $790.00/yr |
| `unestra_cloud_union_monthly` | `price_1U5xsHJe9g4GsjEnWoWW4g4L` | $129.00/mo |
| `unestra_cloud_union_annual` | `price_1U5xsHJe9g4GsjEnXpdfczkP` | $1,290.00/yr |
| `unestra_cloud_seat_monthly` | `price_1U5xsSJe9g4GsjEntF4kgOPU` | $8.00/mo |
| `unestra_cloud_seat_annual` | `price_1U5xsSJe9g4GsjEnxJKs4ZXu` | $88.00/yr |

Test-mode secret key + all 10 Price env vars written to
`civicflow-portal/.env.development.local` (gitignored, confirmed via `git check-ignore`
before writing — never committed, never wired into production, which uses the live key).

**Verification performed** (all real, not mocked):
1. Direct Stripe API: created a single-line-item test Checkout Session against
   `pta_monthly` — succeeded.
2. Direct Stripe API: created a multi-line-item session (`union_annual` + 2× seat) —
   proves the seat-addon line-item path the app's `createCheckoutSession()` builds is
   valid.
3. **Full real-app path**: local dev server (`civicflow_dev`, an isolated local
   Postgres, never production) → logged in as a real demo org's owner (Pine Grove
   School PTA, a fictional local-only seed org) → clicked Subscribe on the actual
   `/settings/billing` page → real Stripe Checkout page rendered with the correct
   product name, description, and $49.00/month price → completed with Stripe's
   standard test card (4242...) → **real, active Stripe subscription
   `sub_1U5y2HJe9g4GsjEnD89unedJ` created against `unestra_cloud_pta_monthly` at
   exactly $49.00**, confirmed via a direct read of the Stripe API afterward.

Webhook sync to the local dev database was not exercised (would require `stripe listen
--forward-to` or a public tunnel to reach localhost) — the webhook handler itself already
has full existing test coverage (`stripe-webhook-route.test.ts`) and CLOUD-B's
catalog-driven `planFromPriceId()` rewrite is separately unit-tested; the gap here is
narrowly "did we watch the local DB row update," not "does the sync logic work."

## Administrative Seats (CLOUD-SEAT program)

A second, explicitly separate entitlement dimension layered on top of the pricing
above — see `docs/admin-seat-capability-audit.md` for the CLOUD-SEAT-A capability
classification and `src/lib/admin-seat-policy.ts` for the resulting
`requiresAdministrativeSeat()` policy. **Ordinary members remain unlimited and never
affect price; admin seats never affect the Stripe subscription amount.** The two
concepts are deliberately never conflated in the same code path.

### CLOUD-SEAT-B — seat calculation & entitlements (this milestone)

Schema (migration `20260819012807_cloud_seat_b_admin_seat_override`, additive only):
`Organization` gains `adminSeatOverride Int @default(0)`, `purchasedAdminSeats Int
@default(0)` (always 0, never sold/shown at launch), and override metadata
(`adminSeatOverrideReason/ExpiresAt/SetByUserId/SetAt`) for CLOUD-SEAT-E's
platform-admin grant UI. `includedAdminSeats` is deliberately **not stored** — it's
derived per-request from the org's pricing vertical:

| Vertical | Included admin seats |
| --- | --- |
| PTA | 10 |
| Community (incl. HOA) | 10 |
| Church | 15 |
| Union | 15 |

`effectiveAdminSeatLimit = includedAdminSeats + adminSeatOverride + purchasedAdminSeats`.
`usedAdminSeats` counts unique users per org currently holding a role that resolves
(via the org's own effective, possibly-customized permissions) to
`requiresAdministrativeSeat() === true`, restricted to `status: "active"`
memberships. New module: `src/lib/admin-seats.ts`
(`includedAdminSeatsFor`, `getUsedAdminSeats`, `getAdminSeatSummary`,
`hasAvailableAdminSeat`).

**Finding: no pending-invitation state exists for staff/admin roles.** The brief's
seat-reservation requirement assumes a pending-invite lifecycle (reserve on send,
release on cancel/expire/reject, convert on accept). This codebase doesn't have one
for privileged roles: `MemberInvite` is a constituent (`OrgMember`) self-service
portal-access invite that always lands on `MEMBER` (never seat-consuming — see
`accept-invite.ts`). The actual staff/admin invite flow
(`POST /api/organization-memberships`) creates the `User` and the privileged
`OrganizationMembership` **synchronously** — no intermediate pending row, no token,
no accept step. There is therefore no reservation window to model. `usedAdminSeats`
already reflects reality the instant a privileged membership exists, and
CLOUD-SEAT-C's enforcement is a pre-check immediately before that synchronous
create/update, not a separate reserve/release lifecycle. This is a scope reduction
grounded in the actual schema, not an oversight.

**Reconciling with the legacy seat system.** `Organization.seatLimit` /
`checkSeatLimit()` / `requireSeatSlot()` / `STAFF_SEAT_ROLES` (`src/lib/plan-gate.ts`)
predate the capability-based policy and count `READ_ONLY` as seat-consuming — directly
contradicting CLOUD-SEAT-A's classification (`READ_ONLY`'s own bundle is the seat-exempt
baseline). CLOUD-SEAT-C will retire that role-name-based system's enforcement role and
switch its call sites (`organization-memberships` POST/PATCH, plus any other
`requireSeatSlot()` callers) to the new capability-based `admin-seats.ts`. The
`seatLimit` column itself is left in place (unused, not dropped) rather than migrated
destructively — per the schema's own stated policy on `OrgRole` cleanup, that kind of
removal is deferred to a dedicated low-traffic schema-cleanup release, not bundled with
feature work.

**Unique-user counting falls out of the schema for free.**
`OrganizationMembership` has a hard `@@unique([organizationId, userId])` constraint, so
a user can hold at most one role — and consume at most one seat — per org, regardless
of how many privileged permissions that role carries. Counting per-org therefore also
gives "same user privileged in two different orgs = 1 seat in each" automatically.

**Platform-level access never consumes an org seat by construction.** Seat counting
only ever queries `OrganizationMembership`; platform-level `SUPER_ADMIN`/support reach
is tracked entirely separately via `PlatformAccess` (`src/lib/platform-access.ts`),
which this module never touches. No special-casing was needed.

Remaining milestones (server enforcement, grandfathering migration, seat UI,
production verification) are CLOUD-SEAT-C through F — see task list.

### CLOUD-SEAT-D — grandfathering migration

**Production seat-usage audit (2026-08-19)** — ran a real, read-only audit against
production (`civicflowprod-do-user-...`) across every organization, using the same
capability-based counting `admin-seats.ts` uses. Result: **15 organizations total, zero
over their new effective admin-seat limit.** Highest usage observed was 4 (Pine Grove
School PTA, limit 10); every other org sat at 0–2. No organization has an
`OrgRolePermissionSet` customization that would change which roles consume a seat.
**Zero grandfathering overrides were needed.**

New reusable module `src/lib/admin-seat-grandfathering.ts`
(`runAdminSeatGrandfathering(db, { dryRun })`) plus operator script
`scripts/cloud-seat-d-grandfathering.ts` (`npx tsx scripts/cloud-seat-d-grandfathering.ts
--dry-run` / `--yes`) — grants the minimum additive `adminSeatOverride` needed to make
any over-limit org's effective limit equal to its current real usage, reason
`"Automatic launch grandfathering — existing administrative access preserved"`, one
`ADMIN_SEAT_OVERRIDE_GRANTED` audit event per org affected. Never reduces an existing
override; idempotent; safely re-runnable as real usage grows over time. Demo/reviewer/
billing-exempt/trial/internal orgs are not special-cased — they go through the identical
calculation as any other org, which is what makes "explicitly preserve" true by
construction rather than by a list of exceptions that could go stale.

**Sequencing note, stated plainly:** the brief's staged rollout put the seat-usage audit
and grandfathering pass (steps 2–3) *before* enabling server enforcement (step 6).
CLOUD-SEAT-C's enforcement actually shipped and went live in production before this
audit ran. In practice this caused no impact — the audit above proves no org was ever
within reach of its limit while enforcement was live (6 seats of headroom at the
closest org) — but the ordering itself did not match the brief, and is recorded here
rather than silently glossed over.

### CLOUD-SEAT-E — seat UI + platform overrides

**Org-facing display** (`/settings/billing`, gated by the existing `billing:read`
permission — unreachable by ordinary members): a new "Administrative Seats" section
showing included / additional / effective limit / used, sourced from
`getAdminSeatSummary()` (replacing the old `checkSeatLimit`-backed "Portal Users
(Seats)" card, which incorrectly counted `READ_ONLY` — this is the display fix
promised in CLOUD-SEAT-C's PR description). At zero available seats, shows the exact
required customer-facing message. `purchasedAdminSeats` is never shown. "Pending
privileged invitations" is omitted from this display — per CLOUD-SEAT-B's finding,
no such state exists in this codebase for staff/admin roles. Includes a "Manage
administrators" link to `/settings/users` and a "Contact Unestra Support" link
(`SUPPORT_EMAIL` from `lib/brand.ts`) as the two required actions.

**Platform-admin override management** (`/admin/platform/organizations/[id]`, gated
by the existing `requireSuperAdmin`): a new "Administrative seats" section showing
the full picture (included/override/effective limit/used-available) plus current
override reason and set-at timestamp, and an `AdminSeatOverrideManager` panel to
grant, change, or remove the override — reason required, optional expiration date,
negative values rejected. New API route
`/api/admin/organizations/[organizationId]/admin-seats` (GET detail, PUT grant/change,
DELETE remove), all guarded by `requireSuperAdmin` — there is no org-scoped route
capable of writing this field, so an org's own admins structurally cannot edit their
own override. Every write is audited (`ADMIN_SEAT_OVERRIDE_GRANTED` /
`_CHANGED` / `_REMOVED`) via the existing `createAuditEvent`, with before/after
values, actor, reason, and timestamp.

**Override expiration** (closes a real gap): `getAdminSeatSummary()` now checks
`adminSeatOverrideExpiresAt` and stops counting an expired override toward
`effectiveAdminSeatLimit` — previously (CLOUD-SEAT-B/C/D) nothing ever read this
field, so an expired override would have silently kept granting extra seats forever.
Expiration never touches any `OrganizationMembership` row — it can only make
`overLimit` true, which blocks new privileged assignments (CLOUD-SEAT-C), never
removes existing access. A separate `ADMIN_SEAT_OVERRIDE_EXPIRED` audit event (fired
by a background sweep, e.g. a daily cron) was in the original brief's event list but
is not implemented here — nothing currently observes expiration transitions to emit
it; the *effect* of expiration is fully correct and tested, only that one audit event
is deferred. Flagged here rather than silently claimed complete.

### CLOUD-SEAT-F — production verification & final report

**Server enforcement**: verified via 8 unit tests (organization-memberships-seat-
enforcement.test.ts) covering rejection at the limit, allowance with a free seat,
READ_ONLY never blocked even when full, the lock only being attempted when a
mutation actually consumes a seat, and lateral/demotion moves never blocked — all
still passing after every subsequent milestone.

**Concurrency**: proven against a real local Postgres database, not just mocked —
`admin-seat-concurrency.integration.test.ts` (skipped by default, run explicitly with
`ADMIN_SEAT_RUN_DB_INTEGRATION_TEST=1`) fills a real org to 9/10 seats, fires two
genuinely simultaneous `lockAndAssertAdminSeatAvailable` + create transactions for
the last seat, and asserts exactly one succeeds — confirmed passing.

**Grandfathering**: ran for real against production (see CLOUD-SEAT-D) — 15
organizations audited, zero needed a grant, script/tests confirmed idempotent.

**Ordinary-member independence**: `grep` across the entire codebase confirms
`admin-seats.ts`/`admin-seat-override.ts`/`admin-seat-policy.ts` are imported by
exactly the two `organization-memberships` routes, `plan-gate.ts` (a doc-comment
reference only), and `api-route.ts` (error mapping) — never by member creation, CSV
import, QR Member Intake, self-registration, member invitations (`MemberInvite`,
always MEMBER role), or member reactivation (`member-lifecycle.ts`). This is a
structural, compile-time guarantee, not a runtime assumption: none of those paths can
be affected by admin-seat exhaustion because none of them can reach the code that
enforces it. Their own existing test suites are unchanged and still pass.

**Live UI verification (2026-08-18, local dev DB against the real deployed code)**:
- Logged in as a real PTA org owner (Pine Grove School PTA) — `/settings/billing`
  correctly showed "4 / 10" administrative seats used, matching the real membership
  data, with the exact required denial-message copy present in the zero-available
  branch.
- Granted temporary local-only `SUPER_ADMIN` platform access (via the existing
  `platform-admin:grant` CLI, reversed immediately after) to reach
  `/admin/platform/organizations/[id]` for a Union-vertical org (15 included seats,
  3 used) — the override panel rendered correctly.
- **Exercised the full override write path for real**: granted a +3 override through
  the UI → page correctly showed override `+3`, effective limit `18`, used/available
  `3 / 15`, reason and set-at timestamp displayed → the real
  `ADMIN_SEAT_OVERRIDE_GRANTED` audit event appeared in the org's existing "Recent
  platform-level audit events" feed with the correct actor and timestamp → removed
  the override through the UI → limit correctly reverted to `15`, used/available back
  to `3 / 12`. Cleaned up (override removed, temporary platform access revoked,
  verified back to a clean DB state) afterward.

**Stripe unaffected**: the entire CLOUD-SEAT program (A through F) never modified
`stripe.ts`, `plans.ts`'s pricing, or any Stripe API call — confirmed by `git diff`
across the full program range touching zero Stripe-related files. Base prices remain
exactly PTA $49/$490, Community $59/$590, Church $79/$790, Union $129/$1290. No seat
Products/Prices exist in Stripe; no quantities are ever sent to Stripe for admin
seats.

**Mobile impact**: `git diff --stat` across the entire CLOUD-SEAT program range shows
zero files touched under `src/app/api/mobile/*` or any other mobile-consumed shared
module. No mobile rebuild is required — this is a source-diff-backed conclusion, not
an assumption.

**Known, explicitly-flagged gaps** (not silently glossed over):
1. CLOUD-SEAT-C's enforcement went live in production before CLOUD-SEAT-D's audit
   ran (sequencing deviation from the brief) — confirmed to have caused zero actual
   impact.
2. The `ADMIN_SEAT_OVERRIDE_EXPIRED` audit event (meant to fire from a background
   sweep on expiration) is not implemented — the expiration *effect* on
   `effectiveAdminSeatLimit` is correct and tested; only that one specific audit
   event is deferred.
3. Manual per-vertical verification was performed live for PTA (org-facing) and
   Union (platform-admin) — Community and Church were not separately click-tested in
   the browser, though their `admin-seats.ts` calculation path is identical and
   covered by the same automated test suite across all four verticals.

## Final report

**ADMINISTRATIVE-SEAT IMPLEMENTATION READY FOR PRODUCTION**

All required elements are verified: capability-based classification (CLOUD-SEAT-A),
seat calculation with override/expiration support (CLOUD-SEAT-B), concurrency-safe
server enforcement proven against a real database (CLOUD-SEAT-C), a real production
grandfathering audit with zero orgs affected (CLOUD-SEAT-D), a live, real, end-to-end
verified UI for both org-facing display and platform-admin overrides with full audit
trail (CLOUD-SEAT-E), and ordinary-member independence proven structurally by import
graph, not assumption (CLOUD-SEAT-F). Base Cloud pricing and Stripe are fully
unaffected. The three gaps above are real but non-blocking: none of them can cause an
existing administrator to lose access, an ordinary member action to fail, or a
production incident — they are follow-up polish, not launch blockers.

## CLOUD-I — remove legacy paid seat add-on

The production readiness audit (2026-08-19) found a live contradiction: `CLOUD_SEAT_POLICY`
in `plans.ts` — a carryover from the legacy `essential` tier, self-flagged as an assumption
back in CLOUD-B — was still giving every Cloud plan a working "3 portal user seats
included, +$8/mo per additional seat" purchase flow, complete with a real Stripe line item
(`unestra_cloud_seat_monthly`/`_annual`) that would have charged a customer. This directly
contradicted the admin-seat program's explicit "no paid seat add-ons at launch" requirement.
Product decision: remove it completely, not reinterpret it as the admin-seat system.

**Removed:**
- `additionalSeats` from the checkout contract (`checkoutSchema` in `/api/billing/checkout`)
  entirely — the client can no longer submit a seat quantity in any form.
- The `SeatStepper` quantity control and "+$X/mo per additional seat" copy from
  `BillingPlans.tsx`.
- `seatPriceId`/`additionalSeats` from the checkout route's call into
  `createCheckoutSession()` — no Cloud checkout can ever attach a seat line item again.
- Every Cloud plan's `seatMonthlyPriceEnvKey`/`seatYearlyPriceEnvKey` are now `null` and
  `additionalSeatCentsMonthly`/`Yearly` are `0` — structural, not just UI-level: even a
  direct API call can't resolve a seat price for a Cloud plan (`seatPriceIdForPlan()`
  returns `null`). Legacy `essential`/`elite` plans keep their real values unchanged
  (historical Subscription-record resolution only — no checkout path reaches them).
- The pricing-page/billing-page highlight line now reads
  `"{N} administrative seats included"` (10 for PTA/Community, 15 for Church/Union — the
  real admin-seat allowance) instead of the fake universal "3 portal user seats included."
- Archived (deactivated, test-mode) the two obsolete Stripe Prices
  (`unestra_cloud_seat_monthly`/`_annual`) — confirmed zero real Subscription depends on
  them first. Confirmed the Stripe account has **no Billing Portal configuration at all**,
  so there was never a portal-side backdoor to add seat quantity either.

**Verified — all 8 checkout combinations, real Stripe test-mode Checkout Sessions, real
app code path** (not mocked, not Stripe-API-only — actual HTTP requests to the running
app, real org DB rows, real session auth):

| Plan | Amount | Line items | Price/lookup key |
|---|---:|---:|---|
| PTA monthly | $49.00 | 1 | `unestra_cloud_pta_monthly` |
| PTA annual | $490.00 | 1 | `unestra_cloud_pta_annual` |
| Community monthly | $59.00 | 1 | `unestra_cloud_community_monthly` |
| Community annual | $590.00 | 1 | `unestra_cloud_community_annual` |
| Church monthly | $79.00 | 1 | `unestra_cloud_church_monthly` |
| Church annual | $790.00 | 1 | `unestra_cloud_church_annual` |
| Union monthly | $129.00 | 1 | `unestra_cloud_union_monthly` |
| Union annual | $1,290.00 | 1 | `unestra_cloud_union_annual` |

Every session: exactly 1 line item (no seat add-on), correct `organizationId` metadata,
correct amount. Synthetic Church test org created for this pass, cleaned up afterward.

**Live-mode audit**: `stripe prices list --live` shows only the old legacy
essential/elite/perpetual Prices — **zero live-mode Unestra Cloud Prices exist**.
**LIVE BILLING ACTIVATION STILL REQUIRED** before any real organization could be charged
in live mode; not done here, not authorized this pass.

**Fee-cover**: re-confirmed not implemented anywhere in the codebase (searched every
plausible name across `src/lib/giving`, `src/app/api/giving`, broader `src`) —
**NOT IMPLEMENTED / NOT FOUND**, not a false PASS.

## CLOUD-J — annual pricing revision (final launch pricing)

**Product decision (2026-08-19), supersedes the annual prices above**: annual = exactly
**11 months of monthly service** (one month of savings), because the separate 30-day free
trial already covers introductory economics — the old ~2-months-free annual discount was
unnecessarily aggressive on top of it. Monthly prices, the trial, unlimited members,
included admin seats, and complimentary-only overrides are all unchanged.

| Vertical | Monthly | Annual | Annual savings |
| --- | ---: | ---: | ---: |
| PTA/PTO | $49 | **$539** | $49 |
| Community/Nonprofit (incl. HOA) | $59 | **$649** | $59 |
| Church | $79 | **$869** | $79 |
| Union | $129 | **$1,419** | $129 |

**Trial audit (required before this change)** — the 30-day trial is entirely internal:
`Organization.trialEndsAt` is written in exactly one place (org creation,
`/api/onboarding/organization`), and `getOrgPlan()` grants the org's own vertical Cloud
plan while `plan === "free" && trialEndsAt > now`. Zero occurrences of
`trial_period_days`/`trial_end` anywhere — Stripe never sees a trial, so paid billing
begins at checkout completion for both intervals. **Trial-stacking ("30-day trial + free
month(s) + 11-month price") is structurally impossible.** Repeat-trial protection already
exists without a new subsystem: nothing ever resets `trialEndsAt` (webhook cancellation
reverts `plan` to free but leaves the original, by-then-expired trial date), the checkout
contract accepts only `interval`, vertical corrections never touch billing, and onboarding
blocks a user already in an active org from creating another. One trial per organization.
Accepted limitation (reported, not "fixed"): a genuinely new user identity creating a
genuinely new organization gets a fresh trial — that's the new-customer boundary every
SaaS has, not an in-app bypass.

**Stripe test mode**: recurring Price amounts are immutable, so 4 replacement annual
Prices were created on the same Product (`prod_V6ACsByLUhI4QI`) with lookup keys migrated
via `transfer_lookup_key` (no ambiguous duplicate mappings — the old Prices' lookup keys
are now null):

| Lookup key | New Price ID | Amount | Replaces (archived) |
| --- | --- | ---: | --- |
| `unestra_cloud_pta_annual` | `price_1U67DzJe9g4GsjEneEJIjUvN` | $539/yr | `price_1U5xsFJe9g4GsjEnuMowWeaP` ($490) |
| `unestra_cloud_community_annual` | `price_1U67DzJe9g4GsjEnbHBnoUYW` | $649/yr | `price_1U5xsFJe9g4GsjEnCObIKhaU` ($590) |
| `unestra_cloud_church_annual` | `price_1U67DzJe9g4GsjEnEkMxpbv2` | $869/yr | `price_1U5xsGJe9g4GsjEntrLjhvKU` ($790) |
| `unestra_cloud_union_annual` | `price_1U67E0Je9g4GsjEn8j1NprPJ` | $1,419/yr | `price_1U5xsHJe9g4GsjEnXpdfczkP` ($1,290) |

Old annual Prices archived (deactivated, not deleted) after confirming **zero
subscriptions** referenced any of them. Monthly Prices untouched. The leftover CLOUD-E
synthetic test subscription (`sub_1U5y2HJe9g4GsjEnD89unedJ`, PTA monthly) was also
cancelled as cleanup. Env mappings (`STRIPE_PRICE_*_YEARLY`) updated in both
`.env.development.local` and the production app spec — same variable names, new values.

**Copy changes**: "2 months free" is retired everywhere; annual savings are now computed
from the authoritative catalog via `annualSavingsCentsForVertical()` (12×monthly − annual)
and displayed as "save $N/year". The customer-facing string regression scan now also bans
`months free` so the obsolete framing can't silently return. Trial language ("30-day free
trial") remains deliberately separate from annual-savings language.

**Webhook note (pre-existing, documented not changed)**: `upsertSubscriptionFromStripe`
falls back to `"essential"` (an inactive legacy plan, not a sellable Cloud plan) when a
price id is unrecognized. The archived annual Prices resolve to nothing (their env
mappings are gone), which is correct — no retired Price maps to a current plan. With zero
real subscriptions, no event carrying a retired Price can legitimately arrive.

**Live mode**: still zero live-mode Unestra Cloud Prices — see the proposed live catalog
in the CLOUD-J completion report. NOT created; live billing activation remains a
separately-authorized step.

## LIVE BILLING ACTIVATION (2026-08-19, owner-authorized)

Live Product **`prod_V6KfzMhPmoRRhY`** ("Unestra Cloud") on `acct_1TrSGDJe9g4GsjEn`
(APH Technologies, LLC), with 8 live Prices — every one field-verified (amount,
interval, USD, livemode, active, product, per-unit, no trial settings) before any
production configuration referenced it:

| Lookup key | Live Price ID | Amount |
| --- | --- | ---: |
| `unestra_cloud_pta_monthly` | `price_1U6846Je9g4GsjEnR9zWXP3G` | $49/mo |
| `unestra_cloud_pta_annual` | `price_1U684KJe9g4GsjEnBbpMpevF` | $539/yr |
| `unestra_cloud_community_monthly` | `price_1U684LJe9g4GsjEnROEHPU7u` | $59/mo |
| `unestra_cloud_community_annual` | `price_1U684LJe9g4GsjEnRxPftR9B` | $649/yr |
| `unestra_cloud_church_monthly` | `price_1U684MJe9g4GsjEnHHOk2Ra0` | $79/mo |
| `unestra_cloud_church_annual` | `price_1U684MJe9g4GsjEnVks9NLvx` | $869/yr |
| `unestra_cloud_union_monthly` | `price_1U684MJe9g4GsjEnXblwajbq` | $129/mo |
| `unestra_cloud_union_annual` | `price_1U684NJe9g4GsjEn8j2s1IXc` | $1,419/yr |

Production `STRIPE_PRICE_*` env mappings flipped from the test-mode IDs to these live
IDs (same variable names; the test-mode catalog remains intact in Stripe test mode and
in `.env.development.local` for local verification). Deployed; clean boot; live webhook
endpoints pre-existing and verified (`.../api/webhooks/stripe`, 6 events, separate
Connect endpoint; no legacy civicflowapp.com endpoint).

**Honestly scoped**: the live catalog is active and correctly mapped, but the first
REAL payment lifecycle (live checkout completed with a real card → live webhook →
Subscription row) has deliberately NOT been exercised — no real charge has ever been
made. Status: **LIVE CATALOG ACTIVE — FIRST REAL PAYMENT LIFECYCLE NOT YET EXERCISED.**

Key-permission note: the CLI's live restricted key is group-granular only; Core and
Billing were temporarily set to Write via the dashboard (owner 2FA), the objects
created, and BOTH groups reverted to Read immediately after — revert verified by a
denied live-write probe. CLI live checkout-session creation was skipped (would have
needed a third scope widen); Phase-7-style session verification therefore rests on the
field-verified Prices + the byte-identical, test-mode-proven app code path.
