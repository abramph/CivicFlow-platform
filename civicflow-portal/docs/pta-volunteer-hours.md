# Unestra PTA/PTO Volunteer Hour Requirements, Buyouts & Reporting — Program Plan

Started 2026-08-27, branch `feature/pta-volunteer-hours`. Builds on the completed
"PTA Vertical 2.0" program (`docs/pta-vertical-2.md`, PTA-A..L). This program is
staged **VH-A..VH-L** to avoid collision with that lettering.

## Release model

**Phase 1 (this program)**: backend + database + PTA-admin web + responsive
family web only. All six feature flags default OFF. No production organization
is enabled without explicit owner approval. **No `civicflow-mobile/` source is
touched** — the current iOS build is awaiting Apple review and must not require
a new binary or behave any differently; the existing Android build must also
keep working unmodified. Every new route lives under
`/api/labs/pta/volunteer-hours/*`; none of the existing `/api/mobile/pta/*`
contracts the submitted app depends on are read or changed.

**Phase 2 (after this program, owner-directed)**: staging verification, then a
production dark launch limited to specific owner-approved organization IDs
(never Apple/Google reviewer orgs, never by name alone, always test/demo data).

**Phase 3 (later, separate program, after Apple approves the current
submission)**: native iOS/Android screens, built from the mobile spec VH-L
documents. No mobile code exists from this program to carry forward — Phase 3
starts clean from the spec.

## Feature flags

- **Platform kill-switch**: `PTA_VOLUNTEER_HOURS_PLATFORM_ENABLED` env var
  (`src/lib/env.ts`), helper `isPtaVolunteerHoursPlatformEnabled()` — mirrors
  the existing `ENABLE_EMAIL_SEND`/`isEmailSendEnabled()` pattern. Checked
  first, before any org-level flag, in every guard.
- **Six org-level booleans on `PtaProfile`** (all default `false`, mirroring
  `electionsEnabled`'s "dark until admin enables" pattern):
  - `ptaVolunteerRequirementsEnabled` — master org toggle: requirement
    periods, assignments, family dashboard visibility.
  - `ptaVolunteerBuyoutEnabled` — pricing windows + buyout election/checkout.
  - `ptaVolunteerAssessmentsEnabled` — assessment preview/posting.
  - `ptaVolunteerReportsEnabled` — Reporting Center + exports.
  - `ptaVolunteerNotificationsEnabled` — automated sends only (admin
    preview/test-send to approved test recipients bypasses this flag).
  - `ptaVolunteerNativeMobileEnabled` — reserved for Phase 3; not read by any
    code in this program.
- Each capability's guard checks the platform flag + its own specific org
  flag(s) — never inferred from another flag (reports-on ≠ payments-on;
  buyout-config ≠ assessment-posting authority). Cron/worker sweeps filter to
  flag-enabled orgs, so a disabled org gets zero new jobs/messages/ledger
  entries — this is also the rollback mechanism.

## Capability matrix (existing infrastructure reused)

| Capability | Existing | Action |
| --- | --- | --- |
| Volunteer hour ledger (raw) | ✅ `PtaVolunteerHourEntry`/`Adjustment`, PENDING→APPROVED/REJECTED, `getPtaVolunteerHourTotalsForHousehold` | Keep untouched; **VH-D** adds a complementary unified ledger for money+hours |
| Requirement (minimal) | ✅ `PtaVolunteerRequirement` (org+schoolYear+requiredMinutes) | Keep untouched for flag-off orgs; **VH-A/B** add period+assignment layer alongside it |
| Feature-toggle pattern | ✅ `PtaProfile.electionsEnabled`/`concernsEnabled` | Reuse pattern for 6 new flags (**VH-A**) |
| Stripe Connect checkout + PendingPayment + webhook idempotency | ✅ `giving/checkout/route.ts`, `StripeWebhookEvent` unique constraint | Mirror for buyout checkout (**VH-F**) |
| Offline payment recording | ✅ `resolveAndRecordDuesPayment` | Mirror for buyout/assessment offline payments (**VH-F**) |
| Refunds | ✅ `giving/refunds.ts`, `ContributionRefundEvent` idempotency | Mirror for purchased-hour refunds (**VH-H**) |
| RBAC / `pta:*` permissions | ✅ 20 existing PTA perms, `OrgRolePermissionSet` | Add 11 new perms (**VH-I**) |
| Audit logging | ✅ `createAuditEvent` | Reuse throughout |
| Household self-service | ✅ `requirePtaHouseholdSelfAccess` (linkage-based) | Reuse for family dashboard (**VH-E**) |
| Async report export | ✅ `ReportExport` + `processQueuedReportExport(s)` | Reuse for large-org background Excel generation (**VH-K**) |
| Excel generation | ⚠ `xlsx` (SheetJS community) — no bold/font styling | Add `exceljs` for this feature only (**VH-J**) |
| Notification dedup | ✅ nullable-timestamp gate pattern (`volunteer-reminders.ts`) | Reuse (**VH-L**) |
| Time-windowed pricing | ❌ nothing in codebase | Net-new (**VH-C**) |
| Mobile buyout UI | ❌ nothing | Out of scope this program — spec only (**VH-L**) |

## Stage status

- VH-A: ✅ built + tested locally (not merged/deployed) — flags + requirement periods
- VH-B: ✅ built + tested locally (not merged/deployed) — assignment/scoping/exemptions
- VH-C: ✅ built + tested locally (not merged/deployed) — pricing window engine
- VH-D: ✅ built + tested locally (not merged/deployed) — unified ledger
- VH-E: ✅ built + tested locally (not merged/deployed) — family dashboard + buyout election + dispute reporting
- VH-F: ✅ built + tested locally (not merged/deployed) — checkout & payment
- VH-G: 🔲 not started — assessment batch & posting
- VH-H: 🔲 not started — corrections/reversals/refunds
- VH-I: 🔲 not started — permissions rollout
- VH-J: 🔲 not started — reporting foundation + Reports A-D
- VH-K: 🔲 not started — Reports E-G + background export + family self-service
- VH-L: 🔲 not started — notifications, audit UI, compatibility tests, mobile spec doc, final verification

Each stage's design is appended below as it lands.

## VH-A — Foundation (flags + requirement periods)

Migration `20260828021826_vh_a_flags_and_requirement_periods` — purely
additive (2 new enums, 6 `NOT NULL DEFAULT false` booleans on `PtaProfile`,
1 new table with an FK to `Organization`). No existing table altered
destructively; every existing volunteer/dues/payment row is untouched.

**Flags**: `PTA_VOLUNTEER_HOURS_PLATFORM_ENABLED` (env, `src/lib/env.ts`,
`isPtaVolunteerHoursPlatformEnabled()`) + six `PtaProfile` booleans
(`ptaVolunteerRequirementsEnabled/BuyoutEnabled/AssessmentsEnabled/
ReportsEnabled/NotificationsEnabled/NativeMobileEnabled`), all default
false. Guard `requireVolunteerHoursFlag(organizationId, capability)` in
`src/lib/labs/pta/volunteer-hours/guard.ts` checks the platform switch
first, then `ptaVolunteerRequirementsEnabled` (master — every downstream
capability needs it), then the specific capability's own flag. Composed
guards `requireVolunteerHoursAccess(permission, capability)` (RBAC + PTA
vertical + flags) and `requireVolunteerHoursHouseholdAccess(capability)`
(household-linkage + flags, for the family dashboard in VH-E). 9 new
`PtaError` codes in `src/lib/labs/pta/errors.ts`.

**Requirement periods**: `PtaVolunteerRequirementPeriod`
(`src/lib/labs/pta/volunteer-hours/periods.ts`) — name, type (school
year/term/calendar year/membership year/contract period/custom), dates,
timezone (snapshotted from `OrgSettings.timezone` at creation, not a live
join), required-hours default, deadlines, buyout/assessment windows,
status (Draft/Active/Closed/Archived), admin notes, family policy text,
and a free-text `scopeLabel` for running concurrent ACTIVE periods across
separate programs/campuses/membership types (this codebase has no formal
campus/program entity to key off instead — documented as a deliberate
simplification). Conflict validation (`assertNoConflictingActivePeriod`)
only fires between ACTIVE periods sharing a scope with overlapping date
ranges; DRAFT/CLOSED/ARCHIVED periods never conflict. Legacy
`PtaVolunteerRequirement` (org+schoolYear+requiredMinutes) is completely
untouched and stays authoritative for every org that never enables the
new flags.

**Permissions**: added all 11 `pta:volunteer-*` permissions to
`src/lib/rbac.ts` now (not deferred to VH-I) since the full role-split
design was already finalized in the approved plan — VH-I becomes a
permission-matrix audit/test pass rather than permission definition.
Split mirrors the existing "hours aren't a Treasurer's job" rule:
requirements/assessments authority → STAFF; pricing/payments/financial
reports → FINANCE; ORG_OWNER/ORG_ADMIN get everything; READ_ONLY gets
requirements:view + reports:view only; MEMBER gets none.

**API**: `/api/labs/pta/volunteer-hours/periods` (GET list, POST create)
and `/api/labs/pta/volunteer-hours/periods/[periodId]` (GET, PATCH).
`/api/labs/pta/profile` PUT extended with the six flag fields, each
gated by its own most-relevant manage permission (not one catch-all) so
a Treasurer holding buyout-pricing:manage can turn buyout on without
touching the requirements/assessments switches.

**UI**: new "Volunteer Requirements & Buyout" section on
`/labs/pta/settings` — `PtaVolunteerHoursSettings` (flag toggles, shown
whenever the signed-in officer holds ANY relevant manage permission,
independent of current flag state so there's no chicken-and-egg
bootstrap problem) and `PtaVolunteerPeriodsManager` (period CRUD, shown
only once `ptaVolunteerRequirementsEnabled` is actually on). No nav
changes — same "settings-page-only, no placeholder nav" discipline as
PTA-A.

**Tests**: 33 new (env flag helper, guard flag-independence matrix incl.
explicit "buyout-on doesn't imply assessments-on" / "reports-on doesn't
imply buyout-on" cases, period date validation, conflict detection,
timezone snapshot, audit events, not-found/cross-org isolation). Full
existing suite green (329 PTA tests, 29 rbac/role-permission tests, no
regressions). Typecheck + lint clean on every touched/new file.

**Not yet built** (later stages): assessment posting (VH-G) and
everything downstream. Families can now actually pay for a buyout via
Stripe (or an admin can record an offline payment), and purchased hours
are credited to the ledger on confirmed payment.

## VH-B — Assignment, scoping & exemptions

Migration `20260828023144_vh_b_requirement_assignments` — purely
additive (2 enums, 1 new table with FKs to `Organization`,
`PtaVolunteerRequirementPeriod`, and nullable `PtaHousehold`).

**Model**: `PtaVolunteerRequirementAssignment`
(`src/lib/labs/pta/volunteer-hours/assignments.ts`) — `scopeType`
(ALL/MEMBERSHIP_PLAN/GRADE/CLASSROOM/PROGRAM/HOUSEHOLD) ×
`assignmentType` (STANDARD/PER_CHILD/PER_ADULT/CUSTOM/REDUCED/
EXEMPT_FULL/EXEMPT_TEMPORARY/WAIVER). GRADE/CLASSROOM resolve against
the household's CURRENT-school-year enrollment; MEMBERSHIP_PLAN
resolves against the household's billing OrgMember's active
`DuesAccount.categoryId` (type=MEMBERSHIP) — the closest existing "plan"
concept, since no dedicated membership-plan entity exists. PROGRAM has
no backing entity at all (no `PtaProgram` model anywhere in the schema)
and is deliberately NOT auto-resolved — it's only ever populated by
explicit household-tagged rows sharing a free-text label, i.e. an
admin-curated named group functionally identical to "individually
selected families" with a shared tag. Documented as a deliberate
simplification, same posture as the period-level `scopeLabel` gap noted
in VH-A.

**Resolution** (`computeHouseholdRequirement`, pure function + a
DB-fetching wrapper `resolveHouseholdRequirement`): precedence is
HOUSEHOLD override → PROGRAM group → CLASSROOM → GRADE →
MEMBERSHIP_PLAN → org-wide ALL row → implicit period default (no row at
all). PER_CHILD/PER_ADULT multiply the period default by live headcount
— confirmed NEVER happens implicitly (dedicated regression test). An
EXEMPT_TEMPORARY row whose `exemptUntil` has passed is treated as if it
doesn't exist (falls through to the next precedence tier), not as a
zero result — "reverts to normal resolution" per spec. WAIVER without
an override amount is a full waiver (zero, exempt); with an amount, a
partial waiver. Every non-STANDARD assignment requires a `reason`
(validated in code) and produces an audit event on both create and
delete.

**Preview**: `previewPeriodAssignments` batch-fetches every ACTIVE
household + its scope context once (no N+1), then reuses the same pure
`computeHouseholdRequirement` function per household — spec §4's
"show administrators a preview... before activation."

**Permissions**: scope-wide rules (ALL/GRADE/CLASSROOM/MEMBERSHIP_PLAN)
need `pta:volunteer-requirements:manage`; family-specific rules
(HOUSEHOLD/PROGRAM) need the dedicated `pta:volunteer-requirements:adjust-family`
— checked per-request against the actual `scopeType` in the payload,
not assumed from the route.

**API**: `/api/labs/pta/volunteer-hours/periods/[periodId]/assignments`
(GET, POST), `.../assignments/[assignmentId]` (DELETE),
`.../preview` (GET).

**UI**: new page `/labs/pta/settings/volunteer-hours/periods/[periodId]`
(linked from each period row) — assignment-rule list/create/delete +
the live preview table. Scope references (grade/classroom/category/
household ids) are entered as raw ids for now; a searchable picker is a
noted follow-up UX improvement, not a correctness gap (the server
validates every id against the org).

**Tests**: 23 new (full precedence-order matrix incl. every pairwise
scope-priority comparison, PER_CHILD/PER_ADULT multiplication +
explicit no-implicit-multiplication regression test, WAIVER
full-vs-partial, EXEMPT_TEMPORARY expiry fallthrough, cross-household
isolation, validation rules, audit events). Full existing suite green
(352 PTA tests). Typecheck + lint clean.

## VH-C — Pricing window engine

Migration `20260828023915_vh_c_pricing_windows` — purely additive (2
enums, 1 new table with FKs to `Organization` and
`PtaVolunteerRequirementPeriod`). This is the one genuinely net-new
piece of infrastructure in the whole program — no time-windowed/dated
pricing pattern existed anywhere in the codebase before this (confirmed
during initial architecture review).

**Model**: `PtaVolunteerPricingWindow`
(`src/lib/labs/pta/volunteer-hours/pricing.ts`) — `rateType`
(FULL_BUYOUT/PER_HOUR/FINAL_ASSESSMENT) × a date range × `amountCents`
(integer cents — pure configuration, doesn't need `DuesPayment`'s
dollars+cents split since it isn't a settled transaction). The spec's
"early/standard/late" rate tiers are just window names/date ranges, not
a fourth enum dimension — three consecutive `FULL_BUYOUT` (or
`PER_HOUR`) windows produce the same effect with less schema surface.
`FINAL_ASSESSMENT` is a deliberately separate rate from the voluntary
`PER_HOUR` advance rate (an org can price them independently), consumed
by VH-G's assessment engine. `timezone` is snapshotted from the
period's timezone at creation (same discipline as VH-A). `lockTiming`
(CHECKOUT_START/PAYMENT_SUCCESS) and `contractSigningOnly` are pure
configuration columns — VH-F is where their behavior is actually
enforced.

**Resolution**: `resolveVolunteerBuyoutRate(orgId, periodId, rateType,
atInstant)` — the sole server-side price authority every checkout/
assessment call site must use; never accepts a client-supplied price.
Returns the ACTIVE window of the requested type whose `[startAt,
endAt)` contains the instant, or `null` if nothing is configured (never
fabricates a rate).

**Overlap prevention**: `assertNoOverlap` rejects a write whose range
intersects another ACTIVE window of the *same* rateType in the same
period — scoped per rateType (a `FULL_BUYOUT` window and a `PER_HOUR`
window are free to overlap in time; two `PER_HOUR` windows are not). An
inactive window never conflicts, mirroring VH-A/B's DRAFT-never-conflicts
posture.

**Permissions**: all pricing-window CRUD (any rateType, including
`FINAL_ASSESSMENT`) sits behind `pta:volunteer-buyout-pricing:manage` +
the `buyout` capability flag — configuring a rate is a pricing decision,
not a posting authorization. VH-G's actual assessment *posting* stays
separately gated by `pta:volunteer-assessments:preview-post` +
`assessments` flag, preserving "buyout config doesn't authorize
assessment posting."

**API**: `/api/labs/pta/volunteer-hours/periods/[periodId]/pricing-windows`
(GET, POST), `.../pricing-windows/[windowId]` (PATCH, DELETE).

**UI**: new "Pricing windows" section on the period detail page
(`PtaVolunteerPricingWindowsManager`) — list with activate/deactivate/
remove, plus a create form. Shown only once the `buyout` capability is
actually enabled.

**Tests**: 12 new (validation, timezone snapshot, audit events, overlap
matrix incl. adjacent-non-overlapping and different-rateType and
inactive-window cases, edit-excludes-self, rate resolution incl.
no-match-returns-null). Full existing suite green (364 PTA tests).
Typecheck + lint clean.

## VH-D — Unified volunteer ledger

Migration `20260828024516_vh_d_unified_ledger` — purely additive (3
enums, 1 new table with FKs to `Organization`,
`PtaVolunteerRequirementPeriod`, `PtaHousehold`, and nullable
`PtaHouseholdAdult`; 1 nullable `category` column added to the existing
`PtaVolunteerHourEntry`; 1 new `donatedGoodsAsHoursEnabled` boolean on
`PtaProfile`).

**Model**: `PtaVolunteerLedgerEntry`
(`src/lib/labs/pta/volunteer-hours/ledger.ts`) — deliberately
COMPLEMENTS, never replaces, the existing `PtaVolunteerHourEntry`/
`PtaVolunteerHourAdjustment` pair, which stays the authoritative raw
per-shift record (PTA-G's existing reports keep reading those
unmodified). 12 `entryType` values covering both hours
(SERVICE_VERIFIED/CORRECTED, mirrored from the raw tables;
PURCHASE/PURCHASE_REFUND/ADMIN_CREDIT/WAIVER) and money
(ASSESSMENT_CHARGE/PAYMENT_ELECTRONIC/PAYMENT_OFFLINE/REFUND/
WRITE_OFF), plus REQUIREMENT_CHANGE as an audit-trail-only marker.
`PtaVolunteerCategory` (9 values incl. DONATED_GOODS, gated by the new
`donatedGoodsAsHoursEnabled` policy toggle) classifies hour-type
entries — "event" vs "non-event" hours are just EVENT_SERVICE vs
everything else.

**Two independent adjustment tools, on purpose**: VH-B's
`PtaVolunteerRequirementAssignment` WAIVER changes what's REQUIRED (the
denominator) for a whole scope/household for the period; a ledger
WAIVER/ADMIN_CREDIT entry is a lightweight one-off credit toward what's
SATISFIED (the numerator) without restructuring the period. Both
require a reason and produce an audit trail; they compose rather than
conflict.

**Idempotent posting**: `postLedgerEntry` — insert-then-catch-P2002 on
`(organizationId, sourceType, sourceId, entryType)`, identical
discipline to `StripeWebhookEvent.stripeEventId`. Manual entries (no
natural source record) have a null `sourceId`, which Postgres never
treats as colliding with another null — they're exempt from the guard
by design, not accidentally unprotected.

**Totals**: `getHouseholdLedgerTotals` — pending/rejected entries are
never folded into `verifiedMinutes` (spec §10/§14, explicit regression
tests), purchased/waived/credit minutes stay in their own columns
(never reported as "volunteered"), `PURCHASE_REFUND` nets against
`PURCHASE` floored at zero, and the financial rollup
(`outstandingBalanceCents`) nets charges against payments/refunds/
write-offs, also floored at zero.

**Wiring**: `approvePtaVolunteerHourEntry`/`adjustPtaVolunteerHourEntry`
(`src/lib/labs/pta/volunteers.ts`) now call a best-effort mirror after
their existing write completes — checked platform-flag-first (so a
disabled platform touches zero PtaProfile rows, confirmed by a
dedicated test), then org-flag, then wrapped in try/catch so a ledger
bug can never fail an approval that already succeeded in the raw table.
The applicable period is resolved generically by "which ACTIVE period's
date range contains right now" (`findApplicablePeriod`) — period-type-
agnostic, and a deliberate no-op (not a guess) when zero periods are
active, e.g. an org that hasn't set up VH-A yet.

**Tests**: 21 in `ledger.test.ts` (idempotency incl. P2002-without-a-
sourceId re-throwing, the full acceptance-scenario-1 numbers, approval-
status exclusion, financial rollup, category-inference mirroring) + 6
in a new `volunteers-ledger-wiring.test.ts` (platform-flag-first
short-circuit, org-flag gating, mirror failure never blocking the
primary approval). Full existing suite green (391 PTA tests). Typecheck
+ lint clean.

## VH-E — Family dashboard + buyout election + dispute reporting

Migration `20260828025237_vh_e_buyout_policy_election_disputes` —
purely additive (6 nullable/defaulted buyout-policy columns on the
existing `PtaVolunteerRequirementPeriod`; 2 new tables + 2 enums).

**Closed a real gap found during implementation**: VH-C's pricing
windows capture RATES (how much) but the spec also needs LIMITS (how
much is allowed) — minimum/maximum purchasable hours, whether a full
buyout is offered at all, a mandatory-minimum-actual-service floor, and
purchase increments (whole/half/quarter hour). Added as 6 columns
directly on the period (`buyoutFullAllowed`, `buyoutMinPurchaseMinutes`,
`buyoutMaxPurchaseMinutes`, `buyoutMinServiceMinutes`,
`buyoutIncrementMinutes`) rather than a new table, since they're
period-wide singletons, not time-windowed like rates.

**Quote engine** (`src/lib/labs/pta/volunteer-hours/elections.ts`):
`buildBuyoutQuote` is the sole price/eligibility authority — composes
VH-B's `resolveHouseholdRequirement` + VH-D's `getHouseholdLedgerTotals`
+ VH-C's `resolveVolunteerBuyoutRate`, then validates the requested
hours against the period's policy limits before quoting. FULL_BUYOUT
always quotes the family's entire required minutes (matching the
spec's example exactly: required 20h + $250 flat → 20h purchased,
$250), and is rejected outright when a mandatory-service floor exists
(`buyoutMinServiceMinutes > 0`), regardless of the stored
`buyoutFullAllowed` value — a full buyout and a mandatory-service floor
are contradictory. PARTIAL_BUYOUT validates increment/min/max/floor-cap
before pricing.

**Election ≠ payment**: `recordElection` creates a
`PtaVolunteerBuyoutElection` row — the family's stated choice, with the
quote's rate/total permanently snapshotted (a later pricing-window edit
never reinterprets a past election) and a versioned/IP-stamped
acknowledgment (`VOLUNTEER_HOURS_ACK_VERSION`, mirroring
`sms-consent.ts`'s pattern). It posts NOTHING to the ledger — no hours
credited, no charge — confirmed by a dedicated test. Append-only: a
family re-electing creates a new row, never edits the old one.

**Disputes** (`disputes.ts`): spec §8/§15's "report a missing or
incorrect volunteer record" — a lightweight OPEN/RESOLVED/DISMISSED
flag that never itself alters any hour entry; an officer investigates
and corrects through the existing approve/reject/adjust tools.

**API**: household self-service under
`/api/labs/pta/volunteer-hours/my-household/{summary,quote,election,disputes}`
(all resolve the caller's own household from
`requireVolunteerHoursHouseholdAccess`, never a client-supplied
householdId) + admin dispute list/resolve under
`/api/labs/pta/volunteer-hours/periods/[periodId]/disputes{,/[disputeId]}`.

**UI**: `PtaVolunteerRequirementCard` added to the existing "My PTA"
page (`/labs/pta/my-pta`) — required/verified/event/non-event/pending/
purchased/waived hours, remaining, the election flow with a live quote
and required acknowledgment, and the dispute-report form. Responsive
grid (`grid-cols-2` on phones, up to 4 columns on desktop) per spec §6.
Admin-side `PtaVolunteerDisputesManager` added to the period detail
page.

**Tests**: 15 in `elections.test.ts` (VOLUNTEER always-free, FULL_BUYOUT
matching the spec's exact example numbers + the mandatory-service-floor
rejection, PARTIAL_BUYOUT increment/min/max/floor-cap validation
matching the spec's exact buyout acceptance scenario — 8h @ $15/hr =
$120 — snapshot-on-record, never-touches-the-ledger) + 4 in
`disputes.test.ts`. Full existing suite green (410 PTA tests).
Typecheck + lint clean.

## VH-F — Buyout checkout & payment

Migration `20260828030356_vh_f_buyout_purchases` — purely additive (2
enums, 1 new table).

**Reused, not duplicated**: the entire checkout is built on the
existing Stripe Connect + COST-POLICY v2 infrastructure —
`resolveConnectedAccountForCharges`/`getStripeForMode` (org's own
connected account, never the platform's), `createPendingPayment`/
`attachStripeSession`/`settlePendingPaymentBySession` (the same
first-party pre-checkout record + idempotent settle used by every other
payment flow in the app), and `resolveCoveragePlan` for the same
voluntary processing-cost-coverage families already see when giving.
Extended `PaymentPurpose` (`src/lib/payments/cost-policy.ts`) with
`"pta-volunteer-buyout"`, classified `VOLUNTARY` nature — never a
donation or tax-deductible contribution (spec §17), enforced by the
webhook branch recording it as a `PtaVolunteerBuyoutPurchase`, never a
`Contribution`.

**Rate lock, honestly scoped**: Stripe Checkout Sessions require a
fixed `unit_amount` at creation, so the quote is always re-derived
fresh (`buildBuyoutQuote`, never a client-supplied amount or a reused
stale election snapshot) at the moment checkout is created — this IS
the `CHECKOUT_START` lock point structurally, not just by convention.
Documented as a deliberate simplification versus a literal
`PAYMENT_SUCCESS` re-quote, which isn't meaningful for a
synchronous-card Checkout Session flow (the amount Stripe already
collected can't retroactively change); `lockTiming` remains a real,
tested column for VH-G/future async-payment-method work.

**Webhook** (`src/app/api/webhooks/stripe-connect/route.ts`): a new
branch mirrors the existing `giving`/`public-giving` branches exactly
— added *after* the shared `settlePendingPaymentBySession` step that
already runs for every purpose. `recordVolunteerBuyoutPurchase`
(`purchases.ts`) never re-quotes; it validates the paid total and
connected account against the row already snapshotted at checkout
time, and is idempotent via the same compare-and-swap
(`updateMany`-with-status-guard, re-check-on-lost-race) pattern as
`settlePendingPaymentBySession` itself — confirmed by dedicated replay
and lost-race tests. On success it posts two ledger entries (PURCHASE
for the hours, PAYMENT_ELECTRONIC for the money) via VH-D's
already-idempotent `postLedgerEntry`.

**Offline path**: `recordOfflineVolunteerBuyoutPurchase` mirrors
`resolveAndRecordDuesPayment`'s shape — an authorized administrator
records cash/check/Zelle/CashApp/other, and credit posts immediately
(the recording *is* the verification step, spec §7). Gated by the
dedicated `pta:volunteer-payments:record-offline` permission (FINANCE
bundle, not STAFF — matches the plan's money-side/hours-side split).

**API**: `/api/labs/pta/volunteer-hours/my-household/checkout` (family
self-service, rate-limited like every other checkout endpoint) +
`/api/labs/pta/volunteer-hours/periods/[periodId]/purchases/offline`
(admin).

**UI**: the family "Pay now" button (added to
`PtaVolunteerRequirementCard`) redirects to the returned Stripe
Checkout URL after an election is recorded. New
`PtaVolunteerOfflinePaymentForm` on the period detail admin page.

**Tests**: 12 in `purchases.test.ts` — checkout never trusts a
client-supplied amount (explicit hostile-payload test), classified
correctly for Stripe, created on the org's own connected account;
webhook idempotency (not-found, already-completed replay, amount
mismatch, connected-account mismatch, lost-race, and the exact buyout
acceptance-scenario numbers: 8h/$120 posts a 480-minute/12000-cent
PURCHASE entry); offline recording posts both ledger entries and
rejects a VOLUNTEER election type. Full suite green (458 PTA/cost-
policy/payments tests, zero regressions in existing giving/cost-policy
tests despite touching shared infrastructure). Typecheck + lint clean;
production build verified.
