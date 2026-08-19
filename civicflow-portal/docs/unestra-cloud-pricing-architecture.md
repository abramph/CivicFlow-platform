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
