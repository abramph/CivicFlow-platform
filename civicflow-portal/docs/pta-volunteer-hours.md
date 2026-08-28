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
- VH-C: 🔲 not started — pricing window engine
- VH-D: 🔲 not started — unified ledger
- VH-E: 🔲 not started — family dashboard + buyout election + dispute reporting
- VH-F: 🔲 not started — checkout & payment
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

**Not yet built** (later stages): pricing windows (VH-C), the unified
ledger (VH-D), and everything downstream. The settings page currently
lets an admin define a period's default required hours and per-family
assignment rules only — no buyout, no payment, no report queries
consult these tables yet.

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
