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
- VH-G: ✅ built + tested locally (not merged/deployed) — assessment batch & posting
- VH-H: ✅ built + tested locally (not merged/deployed) — corrections/reversals/refunds
- VH-I: ✅ built + tested locally (not merged/deployed) — permissions rollout + tenant-isolation audit
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

**Not yet built** (later stages): the full reporting/Excel center
(VH-J/K), notifications, mobile spec doc, and final verification
(VH-L). Every core financial/hour mechanic, permission, and
tenant-isolation guarantee described in the spec is now built, audited,
and tested end-to-end on this branch.

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

## VH-G — Assessment batch & posting

Migration `20260828031258_vh_g_assessment_batches` — purely additive (3
enums, 3 new tables).

**Deliberately its own model family, not DuesCharge/DuesAccount**:
`PtaVolunteerAssessmentCharge` could have reused the existing dues
obligation pipeline (`PtaHousehold.orgMemberId` already gives every
household a billing identity), but doing so would require an
auto-provisioned `DuesAccount`/`Category` and would surface volunteer
assessments inside a parent's existing membership-dues balance/reports
— directly contradicting spec §17's "classify these payments
separately." Kept as a lightweight parallel model instead, reusing the
expensive/risky PAYMENT-PROCESSING layer (Stripe Connect, PendingPayment,
cost-policy) exactly as VH-F does, while keeping the OBLIGATION-TRACKING
layer purpose-built and visually/semantically separate from real dues.
Documented as a deliberate architectural judgment call, not an
oversight.

**Preview** (`previewAssessmentBatch`): a pure computation — persists a
DRAFT batch + one line per non-exempt household with `remainingMinutes
> 0` (using the identical remaining-hours formula as VH-E's family
summary), snapshotting the `FINAL_ASSESSMENT` rate and every
contributing figure at that moment. Calling preview again reuses the
existing DRAFT batch rather than creating a duplicate, so in-progress
admin exclusions survive a reload. Verified against the spec's exact
end-of-period acceptance scenario: required 20h, verified 12h,
purchased 3h, waived 0h → remaining 5h × $25/hr = **$125**.

**Review**: `excludeAssessmentLine`/`includeAssessmentLine` — reason
required to exclude (mirrors VH-B's non-STANDARD-needs-a-reason rule),
only permitted while the batch is still DRAFT.

**Post** (`postAssessmentBatch`): an interactive `$transaction` —
first a compare-and-swap `updateMany(status: DRAFT → POSTED)` claims
the batch (a lost race throws "already posted," duplicate-post-proof,
same pattern as `settlePendingPaymentBySession`), then one
`PtaVolunteerAssessmentCharge` + one idempotent `ASSESSMENT_CHARGE`
ledger entry per INCLUDED line; EXCLUDED lines generate neither.
Supplemental/correction batches carry `supersedesBatchId` — posted
lines are never mutated by a later batch.

**Payment collection** (`assessment-payments.ts`): mirrors VH-F's
Stripe Connect pattern closely, classified `"pta-volunteer-assessment"`
(`FIXED_OBLIGATION` nature — the family genuinely owes this, unlike the
buyout's `VOLUNTARY` classification). Payment state lives directly on
the charge (`amountPaidCents`/`status`) rather than a separate
payment-attempt model — a deliberate V1 simplification (documented in
the model's own schema comment) since nothing in the spec requires
installment/partial-payment support yet, and the columns already
support adding it later without a migration. The family checkout route
double-checks `householdId` server-side before even looking up the
charge — cross-household lookups return not-found, never a 403 that
would confirm the charge exists.

**Webhook**: a new `"pta-volunteer-assessment"` branch added alongside
VH-F's buyout branch, same structure.

**API**: full admin batch lifecycle under
`/api/labs/pta/volunteer-hours/periods/[periodId]/assessments{,/[batchId]{,/lines/[lineId],/post,/cancel},/charges/[chargeId]/offline}`
+ family-facing `/api/labs/pta/volunteer-hours/my-household/assessments{,/[chargeId]/checkout}`.

**UI**: `PtaVolunteerAssessmentManager` (preview table with per-line
exclude/include + post/cancel) on the period detail admin page; the
family "My PTA" card now shows any open assessment charge with a "Pay
assessment" button.

**Tests**: 14 in `assessments.test.ts` (the exact $125 acceptance
scenario, exempt/zero-remaining households correctly skipped, no
FINAL_ASSESSMENT-rate rejection, preview reuses existing DRAFT rather
than duplicating, exclude-requires-reason, duplicate-post rejection,
EXCLUDED lines never charged) + 8 in `assessment-payments.test.ts`
(cross-household tenant isolation, already-paid rejection, webhook
idempotency). Full suite green (480 PTA/cost-policy/payments tests).
Typecheck + lint clean; production build verified.

## VH-H — Corrections, reversals & refunds

Migration `20260828032356_vh_h_corrections_reversals_refunds` — purely
additive (2 enums, 1 new table, 1 nullable-safe `refundedMinutes`
column with a `@default(0)` on the existing buyout-purchase table).

**The pattern throughout (spec §21)**: nothing here auto-charges or
auto-refunds — every case that could create a financial surprise posts
a `PtaVolunteerReviewFlag` for a human instead of resolving itself.

**`reverseHourEntry`** deliberately does NOT introduce a parallel
correction mechanism — it delegates straight to the existing
`adjustPtaVolunteerHourEntry` (which VH-D already wired to mirror a
`CORRECTED` ledger entry), then checks whether the household has any
posted assessment charge; if so, the correction still succeeds but
posts a `CORRECTION_AFTER_ASSESSMENT_POSTED` flag rather than
generating any automatic supplemental charge.

**`refundPurchasedHours`** supports partial refunds, tracked via two
new cumulative columns on the purchase (`refundedAmountCents`,
`refundedMinutes`), validated against what's still refundable on each
call. Stripe-paid purchases refund through Stripe against the
purchase's OWN stored `stripeConnectedAccountId`/
`providerPaymentIntentId` — never the org's current settings (same
rule as `giving/refunds.ts`) — confirmed by a dedicated test. Marks
success only on Stripe's synchronous `"succeeded"` response; a
`charge.refunded` webhook confirmation path is a **documented V1
simplification** (same posture as VH-F's checkout-time rate lock — this
program doesn't yet have an async-refund scenario in its own test
matrix). Every refund posts both a `PURCHASE_REFUND` ledger entry
(hours) and a `REFUND` entry (money), keyed by Stripe's own refund id
when available (free per-refund idempotency, mirroring
`ContributionRefundEvent`'s pattern) or a generated id for offline
refunds. If the reversal leaves the family still owing hours, a
`REFUND_CREATES_DEFICIT` flag posts — informational only, never
blocking.

**`checkForOverpaymentAfterRequirementChange`** is deliberately a
standalone function, NOT wired into VH-B's `createAssignment` — calling
it automatically from inside that already-tested path would require
mocking additional Prisma models in all 23 of VH-B's existing tests for
zero behavior change on the happy path. Exposed instead as its own API
the assignment-rules UI can call as a follow-up after creating a
requirement-reducing HOUSEHOLD assignment. Only flags when the excess
came from *purchased* hours specifically (`purchasedMinutes > 0`) —
pure over-volunteering past the requirement is not a financial concern
and is deliberately never flagged (a dedicated regression test confirms
this distinction).

**Verified**: "excess volunteer hours must not create a negative
balance or automatically transfer to another period" — already
structurally true everywhere `remainingMinutes` is computed
(`Math.max(0, ...)` throughout VH-D/E/G); no carryover mechanism exists
anywhere in the program, confirmed by review rather than newly built
here.

**API**: `/api/labs/pta/volunteer-hours/periods/[periodId]/{hour-entries/[entryId]/reverse,purchases/[purchaseId]/refund,check-overpayment,review-flags{,/[flagId]/resolve}}`.

**UI**: new "Flagged for review" section
(`PtaVolunteerReviewFlagsManager`) on the period detail admin page.
Refund/reverse initiation is API-only in this stage (no dedicated form)
— a deliberate, documented scope cut given these are comparatively rare
admin actions and the reporting stages (VH-J/K) are the largest
remaining surface; a follow-up can add the UI without any API change.

**Tests**: 17 in `corrections.test.ts` covering all three functions —
delegation (never a parallel correction path), flag-only-when-posted,
Stripe-refunds-against-its-own-account, offline-skips-Stripe, deficit
warning true/false, and the overpayment-only-when-purchased-contributed
distinction. Full suite green (491 PTA/cost-policy/payments tests),
typecheck/lint clean, production build verified.

## VH-I — Permissions rollout & tenant-isolation audit

No schema changes — all 11 `pta:volunteer-*` permissions and their
role-bundle wiring already landed in VH-A (front-loaded then, since the
full role split was already finalized in the approved plan). This
stage's actual work was verification: a systematic audit of every
route + a full permission-matrix test suite, plus one real fix the
audit surfaced.

**Route audit**: read every one of the ~30 `/api/labs/pta/volunteer-hours/**`
route handlers built across VH-A..H and confirmed each uses either
`requireVolunteerHoursAccess` (officer) or
`requireVolunteerHoursHouseholdAccess` (family self-service) — no route
bypasses the flag+permission guard layer — and that the
permission↔capability pairing matches intent everywhere (e.g. offline
assessment-charge payments check the `assessments` capability, offline
buyout payments check `buyout`; nothing is cross-wired). No gaps found.

**Permission-matrix tests** (`rbac-volunteer-hours.test.ts`, 17 new
tests): every one of the 11 permissions checked against all 7 roles —
confirms in code, not just documentation, that FINANCE never gets
requirements/assessment authority, STAFF never gets pricing/payment/
financial-report authority, both share general reports as the one
deliberate overlap, READ_ONLY sees hours but never money, and
ORG_OWNER/SUPER_ADMIN/MEMBER hold the unconditional all/none rails.

**Real tenant-isolation gap found and fixed**: `resolveHouseholdRequirement`
(the shared entry point every buyout/assessment/correction function
calls with a `householdId`) never validated that the household actually
belonged to the calling organization before reading it. Downstream
queries (ledger entries, dues accounts) are all independently
`organizationId`-scoped and would have returned empty for a foreign
household, so this was never an exploitable cross-org DATA LEAK — but
`checkForOverpaymentAfterRequirementChange` and the offline-payment
recording routes accept a client-supplied `householdId` directly with
no upstream ownership check of their own, and would have silently
computed a nonsensical "period default, nothing on file" result for a
household from a different org instead of failing closed. Fixed once
in the shared function (`assertHouseholdBelongsToOrganization`,
mirroring the exact `findFirst({id, organizationId})` → 404-equivalent
pattern used everywhere else in this codebase) so every caller across
VH-E/F/G/H is protected transitively — no need to patch each call site
individually. 2 new regression tests confirm the rejection and the
happy path.

**Tests**: 17 in `rbac-volunteer-hours.test.ts` + 2 in `assignments.test.ts`
(the tenant-isolation fix). Full suite green (539 tests, zero
regressions from the fix). Typecheck + lint clean.

## VH-J — Reporting foundation + Reports A-D

New dependency: `exceljs ^4.4.0`. The installed `xlsx` (SheetJS
community edition) can't write bold header rows or cell-level number
formats — a Pro-only feature — so real formatted `.xlsx` needed a
second library, scoped entirely to this reporting module.

**Architecture** (`src/lib/labs/pta/volunteer-hours/reports/`): one
`build*ReportData(organizationId, filters, generatedByName)` function
per report, returning a shared `ReportData<Row> = { info, summary,
rows }` shape. Both the on-screen JSON API route and the `.xlsx`
export route call the *exact same* function and pass the *exact same*
`ReportData` into `buildVolunteerReportWorkbook` — there is no
separate export-only code path that could compute different numbers,
so the on-screen and downloaded totals cannot structurally diverge
(this is the anti-divergence guarantee, verified by tests below, not
just an intention).

- `shared.ts` — `resolveReportHouseholds` (household/grade/classroom
  scoping, reusing VH-B's current-year enrollment lookup),
  `buildHouseholdReportContexts` (composes VH-B's
  `resolveHouseholdRequirement` + VH-D's `getHouseholdLedgerTotals` —
  the one shared per-household computation every report in this
  program builds on, so "verified means APPROVED-only" etc. can never
  drift between reports), `buildReportInfo`, `parseVolunteerReportFilters`
  (shared query-string parsing so the JSON and export routes derive
  identical filters from the same request shape), `resolveGeneratedByName`.
- `xlsx-builder.ts` — `buildVolunteerReportWorkbook<Row>(data, columns)`:
  a 3-worksheet workbook (Report Information / Summary / Detailed
  Data) built with exceljs. Detailed Data gets a bold+shaded frozen
  header row, a column autofilter, per-column number formats (hours as
  h with 2 decimals, currency as `$#,##0.00`, percent, integer, date),
  and a bold totals row summing only numeric columns. All text cells
  pass through the existing `sanitizeFormulaCell` (spec's
  formula-injection requirement, same helper the CSV exporter uses).
- Reports A-D (`family-summary.ts`, `detail-activity.ts`,
  `event-hours.ts`, `compliance.ts`): each exports both its
  `build*ReportData` function and a `*_COLUMNS: ReportColumn[]` array
  consumed by the workbook builder.
  - **A — Family Volunteer Summary**: one row per household, derives a
    9-state `requirementStatus` (NOT_STARTED/IN_PROGRESS/MET_SERVICE/
    MET_BUYOUT/MET_COMBINED/EXEMPT/OVERDUE/ASSESSMENT_DUE/
    ASSESSMENT_PAID) from the shared context plus buyout-purchase and
    assessment-charge history.
  - **B — Detailed Family Volunteer Activity**: one row per raw hour
    entry. `PtaVolunteerHourEntry` has no Prisma relations to
    household/opportunity/slot (only a real `signup` relation) — every
    join here is a deliberate manual batch fetch-and-merge
    (`Promise.all` + `Map`s keyed by extracted ID sets), not a nested
    `include`.
  - **C — Event Volunteer-Hours**: one row per event, aggregated
    across every linked opportunity. `PtaVolunteerSignup` has no
    `opportunityId` of its own, only `slotId` (a real relation) — signups
    attribute to an event via `slot.opportunityId`, resolved with an
    explicit slot lookup and a `slotId -> opportunityId` map before the
    signup query runs.
  - **D — Volunteer Requirement Compliance**: adds a deadline
    countdown and a *live estimate* (never a posted charge) of what an
    unposted final assessment would currently charge, using the active
    `FINAL_ASSESSMENT` pricing window — explicitly never fabricates a
    rate when none is active.

**API routes** (8 new files under
`/api/labs/pta/volunteer-hours/periods/[periodId]/reports/{report}/{,/export}`):
each pair shares the identical guard
(`requireVolunteerHoursAccess("pta:volunteer-reports:view"|":export", "reports")`),
filter parsing, and `generatedByName` resolution; the export route
additionally builds the workbook and writes an audit event
(`pta.volunteer_hours.report_exported`) before streaming the
`.xlsx` as an attachment. Small-org synchronous streaming only in this
stage — background generation for large orgs is VH-K.

**Permission-gating decision** (made informally mid-stage, now
recorded): Reports A-D use the general `pta:volunteer-reports:view`/
`:export` permission (capability `"reports"`), since Report A is the
primary operational report STAFF needs day-to-day. `pta:volunteer-
financial-reports:view` is reserved specifically for Report E (VH-K),
which the spec explicitly titles as the financial/transaction-detail
report.

**Admin UI**: `PtaVolunteerReportsCenter.tsx` (client component) — a
report-type selector, per-report filter bar, summary-stat tiles, and a
data table, all driven by `fetch`ing the same JSON route the export
route reads from. New page at
`/labs/pta/settings/volunteer-hours/periods/[periodId]/reports`,
linked from the period-detail page's header actions when the caller
holds `pta:volunteer-reports:view` and the org has the `reports`
capability enabled.

**Gotchas hit**:
- `PtaVolunteerHourEntry`/`PtaVolunteerSignup` relation gaps (above) —
  both needed manual batch joins instead of `include`, discovered via
  `tsc`, not by reading the schema comments first.
- exceljs's `numFmt` setter type is `string`, not `string | undefined`
  — `NUMBER_FORMATS["text"]` is `undefined`, so every numFmt assignment
  needed an `if (numFmt)` guard.
- React Compiler's `react-hooks/set-state-in-effect` lint rule flags
  *any* reactive data-fetching effect (non-empty deps calling
  `setState`) — including the React-docs-sanctioned cancelled-flag
  fetch pattern already used elsewhere in this codebase
  (`PtaVolunteerRequirementCard.tsx`, deps `[]`). It only fires once
  the effect's deps array is non-empty, which a reactive
  report-filter refetch genuinely needs; suppressed with one targeted
  `eslint-disable-next-line` and a comment explaining why, rather than
  restructuring away from the correct pattern.
- Running the full suite as this stage's gate surfaced a **real
  pre-existing gap from VH-E**: `PtaVolunteerRequirementCard.tsx`
  never called `router.refresh()` after any of its 5 mutating actions,
  and its double-submit guard on the dispute button used
  `disputePending` (capital P breaks the repo-wide
  `refresh-consistency.test.ts` convention check's case-sensitive
  regex). Fixed both — `router.refresh()` added after
  election/dispute/checkout/quote/assessment-payment, and
  `disputePending` renamed to `pendingDispute` — no behavior change,
  but real staleness risk closed (e.g., a family's dashboard not
  reflecting a saved election without a manual reload).
- Duplicate `@types/node` copies in `node_modules` made
  `Buffer.from(x) as unknown as Buffer` still fail typecheck in the
  round-trip test (exceljs's own `.d.ts` resolves `Buffer` against a
  different copy than this file's global). Fixed by casting to
  `Parameters<typeof workbook.xlsx.load>[0]` instead of the ambient
  `Buffer` name, which is immune to which copy is "the" global.
- 5 lint errors surfaced by a repo-wide `npx eslint src` were
  confirmed pre-existing and unrelated (files last touched by the
  original SMS opt-in work, no working-tree diff, untouched this
  session) — out of scope for this stage, not fixed.

**Tests** (35 new, all in `reports/__tests__/`):
`xlsx-builder.test.ts` (13) is the anti-divergence + exceljs-styling
suite — builds a fixture `ReportData`, generates a real workbook,
reloads it with exceljs, and asserts cell values match the exact
hours/60, cents/100, and percent/100 transforms the on-screen JSON
uses, plus header bold/fill, frozen panes, autofilter, the bold totals
row, formula-injection sanitization, and summary-sheet values.
`family-summary.test.ts` (7), `compliance.test.ts` (6),
`detail-activity.test.ts` (5), `event-hours.test.ts` (4) each mock
`@/lib/prisma` plus the relevant sibling modules
(`../../assignments`, `../../ledger`, `../../periods`, `../../pricing`)
and verify the report-specific branching (requirement-status
derivation, compliance-filter matching, event/slot/signup
attribution, manual-join correctness). Full suite: 3593 tests passing
across 353 files (zero regressions). Typecheck clean. Lint clean on
every file touched this stage. Production build compiles successfully,
including the two new routes.

## VH-K — Reports E-G, background export, and family self-service

**Reports E-G** (`financial.ts`, `individual-volunteer.ts`,
`volunteer-category.ts`), following VH-J's exact pattern (a
`build*ReportData` function + a `*_COLUMNS` array, both fed into the
same `buildVolunteerReportWorkbook`):

- **E — Purchased-Hours & Financial Report**: the one report gated on
  `pta:volunteer-financial-reports:view` rather than the general
  reports permission — reconciles every real money movement this
  feature can produce into one transaction-level view: completed/
  refunded buyout purchases and non-void assessment charges, each
  row carrying the household, amount, payment method, and outstanding
  balance. `PtaVolunteerAssessmentCharge.line` is a real Prisma
  relation (unlike the hour-entry gaps hit in VH-J), so the assessment
  side is a straightforward `include`, not a manual join.
- **F — Individual Volunteer Report** and **G — Volunteer Category
  Report**: neither queries Prisma directly. Both call
  `buildDetailActivityReportData` (Report B) and re-aggregate its own
  rows — by `householdAdultId` for F, by `volunteerCategory` for G.
  This was a deliberate choice over a fresh query: Report B already
  resolved the same manual opportunity/slot/adult/household joins
  these reports need, and aggregating its output makes it structurally
  impossible for F or G to disagree with B about what counts as a
  verified hour. Required adding `householdAdultId` to
  `DetailActivityRow` (additive — no existing column or test touches
  it) so F could group by person, not just by display name.

**Background generation** (`dispatch.ts` + an extension to the
platform's existing `processQueuedReportExport` in `src/lib/reports.ts`):
reuses the `ReportExport` model and worker every other export in this
app already uses, rather than a second queue mechanism. `isVolunteerReportType`
lets the shared worker recognize a `PTA_VOLUNTEER_*` job and route it
to a new xlsx-generation branch (real `.xlsx`, not the generic CSV
path) *before* falling through to the existing `SUPPORTED_REPORT_TYPES`
check — the two paths can never race over the same queued row, since
every row is claimed by exactly one branch based on its `reportType`
string.

- **Queue**: `POST .../reports/exports` resolves the permission
  per-`reportType` (Report E needs the financial permission, A-D/F/G
  need the export permission) before creating the `QUEUED` row —
  a STAFF officer can queue Reports A-D/F/G but not E.
- **List**: `GET .../reports/exports` filters to only the report types
  the caller can actually view, computed from the `can()` checker
  `requireVolunteerHoursAccess` now returns (a small additive change
  to `guard.ts` — every other caller destructures a subset of the
  return value, so this couldn't break anything already landed).
- **Download**: deliberately its own route
  (`.../reports/exports/[exportId]/download`), not the platform's
  generic `/api/attachments/[id]/download`. That generic route grants
  read access to anyone holding the plain `reports:read` permission —
  which STAFF has — so reusing it for Report E would have let a STAFF
  officer download a FINANCE-queued financial export just by knowing
  its id. The dedicated route resolves the correct permission from the
  export's own `reportType` before ever generating a signed URL, and
  no `Attachment` row is created for volunteer-hours exports at all
  (the generic entity-type-based Attachment permission model can't
  express Report E's stricter gating, so it's skipped entirely —
  `ReportExport.fileUrl` is sufficient to locate the object).
- Filters round-trip through `ReportExport.filters` (JSON) via two new
  `shared.ts` helpers, `volunteerReportFiltersToJson`/`FromJson` — the
  queue route serializes the same `VolunteerReportFilters` shape the
  synchronous routes parse from a query string, so a queued job
  reproduces the exact filters the caller had on screen.

**Family self-service** (`my-household/report` + `.../report/export`):
own household only, resolved from `requireVolunteerHoursHouseholdAccess`
exactly like every other `my-household/*` route — never a
client-supplied `householdId`. Reuses `buildFamilySummaryReportData`
directly rather than a bespoke query. "Admin/financial columns
stripped" was interpreted narrowly and documented as a judgment call:
strips only `noteOrExceptionIndicator` (an officer's internal
reasoning text for a non-standard assignment, never meant for the
family to read verbatim), while *keeping* the family's own hours and
financial figures (buyout paid, assessment charged, outstanding
balance) — those already mirror exactly what `/my-household/summary`
and `/my-household/assessments` show the family live on their own
dashboard, so hiding them on a downloadable summary of the family's
own data would be inconsistent, not more protective. A "Download my
volunteer report" link was added to `PtaVolunteerRequirementCard.tsx`,
gated on a new `reportsAvailable` prop threaded from `my-pta/page.tsx`
(mirrors the existing `buyoutAvailable` prop's pattern exactly).

**UI**: `PtaVolunteerReportsCenter.tsx` extended with Reports E-G
(Report E hidden from the selector entirely when the caller lacks
`pta:volunteer-financial-reports:view` — the export routes independently
re-enforce this server-side regardless of what the UI shows), a
"Generate in background" button next to "Export to Excel", and a new
`BackgroundExportsPanel` sub-component polling the list route and
showing a download link once a queued job completes.

**Gotchas hit**:
- The React Compiler's `set-state-in-effect` rule's exact trigger
  conditions proved inconsistent between separate `eslint` invocations
  of the same unchanged code — a disable comment reported as "unused"
  in one run and as suppressing a real error in the next. Resolved
  pragmatically: kept the disable comments on every reactive
  data-fetching effect in this file, since the failure mode is
  asymmetric (a stray disable is at worst an "unused directive"
  *warning*, never a build-blocking error; removing a needed one *is*
  build-blocking and appeared unpredictably).
- Running the full suite as this stage's gate again caught a real
  regression this stage introduced: the new `PtaVolunteerReportsCenter.tsx`
  and `PtaVolunteerRequirementCard.tsx` additions added mutating POST
  fetches without `router.refresh()`/a `pending`-named double-submit
  guard, tripping the same `refresh-consistency.test.ts` convention
  check VH-J's gate caught in `PtaVolunteerRequirementCard.tsx`. Fixed
  the same way — added `useRouter`/`router.refresh()` calls and
  renamed `queuePending` to `pendingQueueExport` (lowercase "pending"
  substring, matching the check's naming assumption) before
  committing, rather than after.
- `PtaVolunteerAssessmentCharge.line` turned out to be a real Prisma
  relation despite `PtaVolunteerHourEntry`'s relation-less scalar
  columns being the norm elsewhere in this program — worth checking
  per-model rather than assuming every join in this schema needs a
  manual batch fetch.

**Tests** (14 new, in `reports/__tests__/`): `financial.test.ts` (5),
`individual-volunteer.test.ts` (5, mocks `buildDetailActivityReportData`
directly rather than Prisma), `volunteer-category.test.ts` (4, same
approach), `dispatch.test.ts` (5, including one smoke test that builds
a real `.xlsx` buffer for all 7 report types end-to-end through
`buildVolunteerReportExportFile`). Full suite: 3614 tests passing
across 357 files (zero regressions). Typecheck clean. Lint clean on
every file touched this stage (confirmed against a fresh `--no-cache`
full-repo run — the same 5 pre-existing, unrelated errors from VH-J
are still the only errors in the repo). Production build compiles
successfully.

## VH-L — Notifications, audit UI, compatibility tests, mobile spec, final verification

**Schema**: `PtaVolunteerNotificationType` enum + `PtaVolunteerNotificationLog`
model (`organizationId, requirementPeriodId, householdId, notificationType,
sourceId, pricingWindowId?, recipientEmail, sentAt`), unique on
`(organizationId, notificationType, householdId, sourceId)`. One
generalized dedup log rather than a per-model timestamp column (the
existing `reminderSentAt` pattern from `volunteer-reminders.ts`), since
these notifications aren't each tied to one single existing row the way a
shift reminder is tied to one signup. Migration
`20260828043658_vh_l_volunteer_notification_log`, purely additive.

**Notifications** (`notifications.ts`), three sweep functions plus a
preview/test-send path, all mirroring `sendVolunteerRemindersForOrganization`'s
established shape (billing-access check once, dedup query, send, log,
audit event summarizing counts):

- `sendVolunteerHoursDeadlineReminders` — once per household per period,
  as `volunteerDeadline` enters a lookahead window (default 14 days),
  for households not exempt and not yet fulfilled.
- `sendVolunteerHoursAssessmentPostedNotices` — once per posted charge,
  wired as a best-effort (`.catch(() => {})`, never blocks or rolls back
  the posting transaction) follow-up call at the end of
  `postAssessmentBatch` in `assessments.ts`.
- `sendVolunteerHoursRateChangeNotices` — once per household per
  upcoming pricing window (requires the `buyout` capability, not just
  `notifications`).
- `sendVolunteerHoursNotificationsAllOrganizations` — the cron sweep,
  filtered to `ptaVolunteerNotificationsEnabled && ptaVolunteerRequirementsEnabled`
  orgs, run against every `ACTIVE` period. Assessment-posted notices are
  deliberately NOT part of this sweep — "a batch just posted" is an
  event to react to inline, not a recurring condition to poll for.
- `previewVolunteerHoursNotification` — the admin test-send. Deliberately
  bypasses `ptaVolunteerNotificationsEnabled` (an admin must be able to
  preview templates before ever turning automated sending on) but never
  looks up a real household's email — the recipient is always supplied
  directly by the caller, and every message is prefixed `[TEST]`.

New cron route `POST /api/cron/volunteer-hours-notifications` (same
`CRON_SECRET` bearer pattern as `/api/cron/volunteer-reminders`) — not
registered with any external scheduler as part of this program; that's
an ops step for Phase 2.

**Admin UI**: `PtaVolunteerNotificationsManager.tsx` on the period-detail
page (preview form always visible; "send now" buttons only once
`ptaVolunteerNotificationsEnabled` is actually on) and
`PtaVolunteerAuditHistory.tsx` at a new page,
`/labs/pta/settings/volunteer-hours/audit`, linked from the main PTA
settings page. The audit page doesn't maintain a second log — it
surfaces the existing `AuditEvent` trail (every stage since VH-A has
been writing dotted `pta.volunteer_hours.*` actions) via a new route,
`GET /api/labs/pta/volunteer-hours/audit`, gated on
`pta:volunteer-audit:view` — the permission VH-A/VH-I defined for
exactly this purpose but left unwired until now.

**Mobile-compatibility contract tests**
(`mobile-compatibility.test.ts`, 50 tests): rather than a literal
before/after response diff (no snapshot exists from before VH-A), a
static-source guard scanning every `route.ts` under
`src/app/api/mobile/pta/**` and asserting none of them import anything
from the volunteer-hours module tree or reference any of the six new
`PtaProfile` flags — the actual failure mode this guarantee protects
against. A second small check confirms all six flags default `false`
in the schema itself, not just by convention.

**Chained end-to-end acceptance tests**
(`e2e-acceptance-scenarios.test.ts`, 5 tests): the plan's 4 acceptance
scenarios (family totals, event report, buyout math, assessment math),
built from one shared, consistent fixture (10h required, 3h verified
via one event, 2h bought out at $25/hr = $50, 5h remaining assessed at
$20/hr = $100) rather than four independent ones. Calls Reports A, C,
D, and E's real build functions against that one fixture and asserts
they all agree with each other and with hand-computed expected values
— proving the whole system's math is internally consistent end-to-end,
not just correct in isolation (which every prior stage's unit tests
already covered separately).

**Documentation set** (new, alongside this file):
`pta-volunteer-hours-admin-guide.md`,
`pta-volunteer-hours-family-guide.md`,
`pta-volunteer-hours-api-reference.md`,
`pta-volunteer-hours-mobile-phase3-spec.md` (the required Phase 3
mobile spec — document only, zero `civicflow-mobile` changes),
`pta-volunteer-hours-rollout-runbook.md` (dark-launch + rollback,
finalizing the plan file's sketch into an actionable ops checklist),
`pta-volunteer-hours-release-notes.md`.

**Tests**: 15 in `notifications.test.ts`, 50 in
`mobile-compatibility.test.ts`, 5 in `e2e-acceptance-scenarios.test.ts`
— 70 new tests this stage. Full suite: 3686 tests passing across 360
files (zero regressions). Typecheck clean. Lint clean (same 4
pre-existing, unrelated files as every prior stage's `--no-cache`
full-repo check — untouched this session). Production build compiles
successfully.

**Program status: Phase 1 (VH-A through VH-L) complete.** Branch
`feature/pta-volunteer-hours`, not merged to `main`, not deployed, not
enabled for any organization, zero mobile source changes, zero mobile
build/submission action taken — every constraint from the program's
approved plan held for all 12 stages. See
`pta-volunteer-hours-release-notes.md` for the shipped feature summary
and `pta-volunteer-hours-rollout-runbook.md` for what happens next,
none of which proceeds without explicit approval.

## VH-L follow-up — pending/rejected ledger-mirroring fix (pre-merge)

Found during merge-readiness verification: the unified ledger only ever
mirrored **approved** or **adjusted** hour entries
(`mirrorHourEntryApprovalToLedger`/`mirrorHourEntryAdjustmentToLedger`,
called from `approvePtaVolunteerHourEntry`/`adjustPtaVolunteerHourEntry`
in `volunteers.ts`). Neither `setPtaVolunteerAttendanceStatus` (which
creates the initial PENDING entry) nor `rejectPtaVolunteerHourEntry`
ever mirrored — so `getHouseholdLedgerTotals().pendingMinutes`/
`.rejectedMinutes` always read zero, regardless of real pending/
rejected hours. This affected three surfaces: the family dashboard's
"Pending approval" stat, Report A's `totalPendingMinutes`, and Report
D's `PENDING` compliance filter (which never matched anything).
`remainingMinutes` — and therefore every buyout quote, assessment
amount, and financial figure — was **never affected**: confirmed by
grep that every computation of it (`assessments.ts`, `corrections.ts`,
`elections.ts` ×2, `reports/shared.ts`) uses the identical formula
`max(0, required − verified − purchased − credit − waived)`, which
never references pending/rejected minutes at all.

**Fix**: hour entries are the only ledger source with a real state
machine (PENDING → APPROVED or PENDING → REJECTED). A fresh
`postLedgerEntry` insert per transition would either violate the
`(organizationId, sourceType, sourceId, entryType)` uniqueness
constraint, or — worse — silently no-op via `postLedgerEntry`'s
insert-then-return-existing idempotency and leave the mirror row
permanently stuck at whichever state it was first mirrored in. Added
`upsertHourEntryLedgerRow` (private helper in `ledger.ts`): finds the
existing mirror row for an hour entry (by `sourceType`/`sourceId`/
`entryType`) and `UPDATE`s it in place if found, else creates fresh.
`mirrorHourEntryApprovalToLedger` now calls it instead of inserting
blindly (so an existing PENDING mirror transitions to APPROVED rather
than being orphaned). Two new functions, `mirrorHourEntryPendingToLedger`
(wired into `setPtaVolunteerAttendanceStatus`) and
`mirrorHourEntryRejectionToLedger` (wired into
`rejectPtaVolunteerHourEntry`), use the same upsert. Every other ledger
entry type (purchase, assessment, waiver, refund, adjustment) is a
one-shot event and correctly keeps using `postLedgerEntry` directly,
unchanged.

**Tests**: 8 new in `volunteers-ledger-wiring.test.ts` (wiring —
mirrors on/off per flag, never blocks the real action if mirroring
throws, never fires for NO_SHOW/EXCUSED), 10 new in `ledger.test.ts`
(upsert-vs-create branching, including the specific "transitions the
SAME row, not a second one" assertion the fix exists for). Additionally
verified end-to-end against a real (non-mocked) Postgres instance in a
throwaway scratch script (not committed): a real PENDING entry mirrors
with `pendingMinutes: 90`; a real approval by a different officer
transitions the *same* ledger row id to APPROVED with
`pendingMinutes: 0, verifiedMinutes: 90`; a real rejection transitions
a different entry's row to REJECTED — never more than one ledger row
per hour entry at any point. Full suite: 3703 tests passing across 360
files (zero regressions from the pre-fix baseline of 3686/360).
Typecheck clean. Lint clean (same 4 pre-existing unrelated files as
every prior stage). Production build compiles successfully.
