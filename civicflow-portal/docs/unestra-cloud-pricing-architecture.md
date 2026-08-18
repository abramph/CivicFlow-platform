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
