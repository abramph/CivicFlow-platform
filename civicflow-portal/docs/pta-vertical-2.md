# Unestra PTA/PTO Vertical 2.0 — Program Audit & Plan

Audited 2026-08-13 against production `main`. This document records the
existing-capability matrix required by the program brief ("audit before code")
and the design for PR PTA-A. Later PRs append their designs here.

## Capability Matrix

| Capability | Existing | Partial | Missing | Action |
| ---------- | -------- | ------- | ------- | ------ |
| Households / adults / invites | ✅ `PtaHousehold`/`PtaHouseholdAdult`/`PtaHouseholdAdultInvite`, accept flow, dual identity (PR #85, #89/#90) | | | Keep — no change |
| Students / grades / classrooms / enrollment | ✅ `PtaStudent` + year-scoped `PtaStudentEnrollment`, `PtaGrade`, `PtaClassroom`, `PtaTeacher`; minimal-data policy | | | Keep |
| Membership & dues | ✅ Household billing OrgMember → existing dues pipeline; parent-dues self-service | | | Keep |
| School year | | ⚠ Free-text labels: `PtaProfile.currentSchoolYear` + `schoolYear` strings on Household/Classroom/Enrollment/VolunteerOpportunity. No entity, no prev/next, no prep-ahead | | **PTA-A**: `PtaSchoolYear` entity + backfill + nullable `schoolYearId` FKs + dual-write; year management UI in PTA Settings |
| Board positions / officers / terms / history | | | ❌ Nothing | **PTA-A** (models+API+RBAC) / **PTA-B** (UI) |
| Committees | | ⚠ `PtaCommittee` (name, desc, chair, co-chair, members, volunteer linkage). No school year, status, liaison, goals, scoped chair perms | | **PTA-B** |
| Meetings core + QR attendance | ✅ `Meeting`, `MeetingAttendanceSession` (QR, rotating token), `AttendanceRecord`, bulk worksheet, mobile check-in | ⚠ No lifecycle status, type is free text | | **PTA-C** (agendas, lifecycle, motions, votes, action items — additive) |
| Minutes | ✅ `MeetingMinutes` versioned DRAFT→IN_REVIEW→APPROVED→SUPERSEDED, immutable approved rows, shared read path | ⚠ No structured sections, no PDF export | | **PTA-C** |
| Motions / votes / decision register | | | ❌ | **PTA-C/D** |
| Action items | | | ❌ | **PTA-C** |
| Concerns & grievances | | | ❌ (union vertical has none to borrow either) | **PTA-E** + dedicated security review |
| Governance library (bylaws/policies/versions) | | | ❌ (documents page is an honest placeholder) | **PTA-D** |
| Document center | | ⚠ File infra exists (campaign attachments → DO Spaces, signed links, 15MB) but no org document model | | **PTA-D** (reuse storage layer) |
| Transition center / handoff / packet / onboarding | | | ❌ | **PTA-F** |
| Volunteers | ✅ Opportunities, slots (atomic claim), signups incl. waitlist statuses, check-in/out, hour ledger + adjustments + approvals, requirements, officer roster, mobile | ⚠ Reports thin; no reminders/recurrence | | **PTA-G** (small) |
| Finance | ✅ Dues pipeline, payment reports, base `Expenditure` | ⚠ No budget, no reimbursement workflow | | **PTA-H** |
| Elections | | | ❌ | **PTA-L** (gated, after security review) |
| Compliance calendar | | | ❌ | **PTA-I** |
| Contact directory / vendor history | | | ❌ | **PTA-I** |
| Communications | ✅ Campaigns (email+push+deep links), per-member recipients, household targeting via billing OrgMember, WhatsApp/SMS add-ons | ⚠ Targeting = member filters only (no board/committee/grade segments) | | **PTA-J** |
| Mobile member experience | ✅ PTA tab set, RSVP (household), volunteers, dues, announcements, inbox; admin tab via `mobileAdmin` | ⚠ No "My PTA" hub | | **PTA-J** |
| Dashboard | ✅ Basic officer dashboard (`/labs/pta/dashboard`) | ⚠ Not actionable (no tasks/compliance/transition) | | **PTA-K** |
| Reports | | ⚠ Volunteer + dues partials | | **PTA-K** |
| RBAC | ✅ 15 `pta:*` permissions, role bundles, org-level `OrgRolePermissionSet` editor, `getEffectivePermissions` | ⚠ No board/governance/concerns/transition/finance/compliance capabilities | | Each PR adds its own; **PTA-A** adds `pta:board:*` |
| Audit logging | ✅ `createAuditEvent` used across verticals | | | Reuse |
| Notifications | ✅ Push devices, campaign push, deep links (readiness-gated) | | | Reuse |
| Data health | ✅ Platform data-health page + export | ⚠ No PTA checks | | **PTA-K** |
| Tests | ✅ Extensive unit/integration under `__tests__` incl. PTA volunteers, invites, dues | | | Extend per PR |

Key architectural facts the program must respect:

- PTA gate = `Organization.primaryVertical === "PTA"` (`requirePtaAccess`), Labs retired.
- Parent self-service never uses `Permission` — it goes through household-linkage guards.
- Household billing OrgMember ≠ adult identity (docs/pta-communication-identity.md).
- Officer roles map to base `Role` via `OrgRolePermissionSet` overrides — no new Role enum values.
- `MeetingMinutes` already implements the exact immutability model section 6 asks for.

## PR PTA-A — Foundation (this PR)

Scope (per brief §38): school-year normalization, board positions, officer
assignments/history, RBAC. **No navigation changes** except a School Year
section on the existing PTA Settings page (usable, not placeholder); Board UI
ships in PTA-B on top of these APIs.

### Schema (additive only)

- `PtaSchoolYear` — `organizationId`, `label` ("2026-2027"), optional
  `startsOn`/`endsOn`, `isCurrent`. Unique `(organizationId, label)`.
  App-level invariant: exactly one current row per PTA org (enforced in
  `setCurrentSchoolYear` transaction).
- Nullable `schoolYearId` FK added to `PtaHousehold`, `PtaClassroom`,
  `PtaStudentEnrollment`, `PtaVolunteerOpportunity`. Existing `schoolYear`
  strings stay authoritative for reads this PR; new writes dual-write both.
- `PtaBoardPosition` — configurable positions: `name`, `description`,
  `responsibilities`, `classification` (OFFICER | BOARD_MEMBER), `isVoting`,
  `sortOrder`, `termLengthMonths`, `isActive`. Unique `(organizationId, name)`.
- `PtaOfficerAssignment` — history-preserving holder records: `positionId`,
  `schoolYearId?`, `schoolYearLabel?` (denormalized snapshot), holder as
  `householdAdultId?` and/or free-text `personName` (officers predating the
  system need no adult row), `startDate?`, `endDate?`,
  `status` (INCOMING | ACTIVE | ENDED), `notes`. Assigning a new ACTIVE holder
  ends the previous one (sets `endDate`+ENDED) — never deletes or rewrites it.
  Restrict-deletes: position and school year cannot be hard-deleted once
  assignments reference them.

### Backfill (in-migration, guarded, idempotent)

1. Insert one `PtaSchoolYear` per distinct label per org, from the union of
   `PtaProfile.currentSchoolYear` + the four string columns.
2. Mark the row matching `PtaProfile.currentSchoolYear` as `isCurrent`.
3. Populate the four new `schoolYearId` columns by `(organizationId, label)` join.

No destructive statements; new columns nullable; strings untouched.

### Lib/API

- `src/lib/labs/pta/school-years.ts` — list/create/setCurrent/ensure; label
  parsing (`2026-2027` → next `2027-2028`); `resolveSchoolYearId()` used by
  the household/classroom/enrollment/opportunity create paths (dual-write).
- `src/lib/labs/pta/board.ts` — positions CRUD, standard-position seeding
  (explicit action, not automatic), assign/end officer with history, board
  roster + history queries.
- Routes under `/api/labs/pta/school-years` and `/api/labs/pta/board/*`,
  guarded by `requirePtaAccess(...)` with the new permissions, audited via
  `createAuditEvent` (`pta.board.officer_assigned`, etc.).

### RBAC

New permissions: `pta:board:view`, `pta:board:manage`,
`pta:school-years:manage`. Bundles: ORG_OWNER/ORG_ADMIN get all three; STAFF
and FINANCE and READ_ONLY get `pta:board:view` (a treasurer/secretary must see
the roster; managing it stays board-level). Org-configurable via the existing
permission editor automatically.

### Risks / regression watch

- Migration backfill on prod PTA orgs (Harris PTA + Unestra Demo PTA):
  label-join backfill only — verified idempotent, skips when no PTA rows.
- Dual-write paths touch household/classroom/enrollment/opportunity creation:
  covered by existing tests + new unit tests; `schoolYearId` never replaces
  the string in any read this PR.
- `getEffectivePermissions` caches per role — new permissions must be added to
  bundles before any route requires them (same PR, safe).

### Out of scope for PTA-A

Board UI pages (PTA-B), committee changes (PTA-B), any navigation additions
beyond the Settings school-year section.

## PR PTA-B — Board & Committees (this PR)

Shipped on top of PTA-A (merged as PR #95):

- **Board Officers page** (`/labs/pta/board`, nav-gated by `pta:board:view`):
  roster with current holders, history-preserving assign/replace/end,
  incoming-officer prep, per-position leadership history, position management
  (add custom, retire, one-click standard set). PTA language throughout.
- **Committee upgrade** (`PtaCommittee` — additive migration
  `20260813130000_pta_b_committee_upgrade`): lifecycle `status`
  (PLANNING/ACTIVE/COMPLETED/ARCHIVED — retire, never delete), school-year
  association (label+FK dual convention, backfilled from the org's current
  year), `boardLiaisonAdultId`, `goals`, `meetingSchedule`. New committees are
  stamped with the current year on create.
- **Scoped chair permissions** — `requireCommitteeManageOrChair(committeeId)`:
  linkage-based (chair/co-chair `userId` on THIS committee), never a
  Permission grant, mirroring the parent self-service convention. Chairs can
  manage their own committee's member list and edit
  description/goals/meeting-schedule (server-side whitelist — the
  authorization boundary, not just UI hiding); rename/status/year/leadership
  stay officer authority. The committee detail page is now reachable by its
  chair, and adult search for roster-building goes through a committee-scoped,
  names-only endpoint (no contact data exposure to chairs). This supersedes
  the earlier "invite the chair as org-wide STAFF" guidance, which is exactly
  the over-grant §4 of the program brief prohibits.
- Tests: `committees-chair-scope.test.ts` (tenant isolation, chair pinning to
  their own committee, field whitelist, cross-org liaison/year rejection).

## PR PTA-C — Meetings 2.0 (this PR)

**Core, not PTA-namespaced** (brief §42): every vertical runs meetings and
passes motions, so `MeetingStatus`/`MeetingAgendaItem`/`MeetingMotion`/
`MeetingActionItem` live on the core Meeting surface; the only PTA linkage is
the optional `committeeId` on action items (SetNull, invisible elsewhere).

- **Lifecycle**: `Meeting.status` (DRAFT/SCHEDULED/IN_PROGRESS/COMPLETED/
  CANCELLED, default SCHEDULED so existing rows are untouched), validated
  transitions (COMPLETED terminal, CANCELLED re-schedulable). Plus
  `virtualMeetingUrl` (display-only) and `quorumRequired` (informational —
  attendance page shows met/not-met, never blocks).
- **Agenda**: ordered items (title/presenter/duration) on the meeting page.
- **Motions & Decision Register**: motion → seconded → passed/failed/tabled/
  withdrawn with vote counts; PASSED allocates a permanent per-org decision
  number ("2026-014") transactionally with unique-collision retry; decided
  motions are final (revisit = new motion). `/meetings/decisions` is the
  searchable register plus the open-action-item feed. Motions restrict-delete
  like minutes: a recorded decision can't be cascaded away.
- **Action items**: owner/due/priority/status (OPEN→…→COMPLETED with
  completedAt stamping), optional meeting + PTA-committee linkage; overdue
  surfaced on the Decisions page now, wired into Dashboard 2.0 in PTA-K.
- **Untouched by design**: QR attendance, the attendance worksheet, and the
  immutable minutes workflow (already exactly the §6 model). Structured
  minutes *sections* are deliberately a template/prefill concern on the
  existing single-body model — not a new persistence format — to keep the
  approved-version immutability machinery byte-identical; PDF export of
  minutes lands with the Document Center in PTA-D where file generation
  belongs.

## PR PTA-D — Governance Library & Document Center (shipped)

**Core, not PTA-namespaced** (brief §42): every vertical has governing
documents and shared files, so `GovernanceDocument` and the
`ORGANIZATION_DOCUMENT` attachment entity live in core with their own
`governance:read/write` + `documents:read/write` permissions (STAFF gets
documents r/w but governance read-only). The PTA pages are the vertical skin.

- **Governance Library** ("Bylaws & Policies"): versioned document groups via
  `rootDocumentId`; publishing a version CURRENT transactionally supersedes
  the group's previous CURRENT (never any other document); SUPERSEDED can
  never be set manually; nothing is ever deleted (Restrict org FK, ARCHIVED
  for retirement). Optional file per version via the existing storage layer
  (private bucket, signed 5-minute download URLs, audited downloads).
- **Document Center**: rides the existing Attachment pipeline (soft delete,
  15 MB cap, audit) with `entityId = organizationId` and the folder stored as
  the attachment `purpose`. Follow-up fix shipped with PTA-E: attachment
  listing accepts an optional `purpose` filter (opt-in `filterByPurpose` prop)
  so folder tabs actually scope their contents — single-purpose surfaces are
  unchanged.
- **Minutes PDF** (deferred from PTA-C): `/api/meetings/[id]/minutes/[minutesId]/pdf`
  via pdf-lib, APPROVED/SUPERSEDED versions only — a draft can never leave
  the building as a PDF.
- **Prod-verified** on Demo PTA: bylaws v1→v2 amendment auto-supersede with
  intact history, Document Center upload + signed-URL download byte-identical,
  minutes draft→IN_REVIEW→APPROVED→PDF (`%PDF-` magic, application/pdf).

## PR PTA-E — Concerns & Grievances (this PR)

The vertical's most sensitive records (brief §9, §36): a confidential case
register for formal concerns brought to the board. PTA-namespaced end to end —
no other vertical sees any of it.

### Security model (dedicated review — see below)
- **Five dedicated permissions** (`pta:concerns:view/manage/assign/resolve/export`)
  granted ONLY to ORG_OWNER and the ORG_ADMIN bundle. STAFF/FINANCE/READ_ONLY
  get nothing; MEMBER is structurally empty. No pre-existing permission was
  reused, so no role inherits access by accident; orgs can still delegate via
  OrgRolePermissionSet deliberately.
- **Restricted cases**: `isRestricted` cases are readable/writable ONLY by
  their explicitly assigned officers (`PtaConcernAssignee` rows) — no
  permission bypasses the wall (enforced in `canReadConcernContent`, the one
  access decision). Unassigned `assign`-holders see a REDACTED stub (case
  number, category, status — never title/people/narrative) purely so
  reassignment stays possible; everyone else sees nothing, and direct GETs
  answer 404, never 403, so restricted content existence is not confirmed.
  A restricted case auto-assigns its creator (never born unreachable) and
  must always keep ≥1 assignee.
- **Audit everything**: creation, every detail view, updates, assignment and
  removal, status changes, resolution — all via createAuditEvent. Audit
  metadata carries case number/status facts only, never narrative, reporter,
  subject, or note bodies (test-asserted).
- **Data minimization**: reporter/subject are plain optional strings — no FK
  to members/students, so a case never enriches itself from the directory.
  The case log is append-only (no update/delete surface). No file
  attachments in this PR — deliberately deferred rather than widening the
  generic attachment API to restricted content.
- **No member/mobile exposure**: officer-entered cases only; nothing under
  /api/mobile or any member-facing surface. Member self-submission is a
  future PR with its own review.
- **Feature switch**: `PtaProfile.concernsEnabled` (+ `concernsLabel` rename,
  e.g. "Member Feedback") — held to `pta:concerns:manage` even inside the
  general profile PUT; disabling hides nav + page + APIs (403
  PTA_CONCERNS_DISABLED) without deleting data.

### Mechanics
- Case numbers "C-2026-001": per-org per-year, allocated transactionally with
  P2002 unique-collision retry (Decision Register pattern). `@@unique([organizationId, caseNumber])`.
- Statuses: SUBMITTED → UNDER_REVIEW → INFORMAL_RESOLUTION / FORMAL_REVIEW /
  AWAITING_RESPONSE → RESOLVED / DISMISSED (require `resolve` permission + a
  resolution summary; stamp resolvedAt) → APPEALED / CLOSED. Category enum in
  PTA language (bylaws concern, officer conduct, election concern, …).
- Optional linkage: assigned committee (SetNull) and the governing document
  that applies (SetNull) — a grievance can cite the bylaws version it's about.
- Migration 20260813190000 purely additive (3 enums, 3 tables, 2 nullable
  PtaProfile columns with defaults). Restrict org FK on PtaConcern (never
  cascade a grievance away); Restrict user FK on assignees (deleting a User
  can't erase who was assigned).
- 21 new tests (`concerns.test.ts`): the §36 workflow — submit → restricted
  assignment → review → resolve — plus redaction content-leak assertions,
  404-not-403, last-assignee protection, tenant isolation, audit-metadata
  hygiene.

## PR PTA-F — Board Transition Center (this PR)

**The signature feature** (brief §12–§15). PTA-namespaced end to end (§42:
"board transition" is PTA workflow, not core) — built entirely on PTA-A's
board/school-year machinery instead of new parallel structures.

- **PtaBoardTransition**: one per (org, fromYear → toYear) pair, workflow
  PREPARING → READY_FOR_HANDOFF → HANDOFF_IN_PROGRESS → ACCEPTED → COMPLETED.
  Restrict org FK — a transition is a governance record.
- **PtaOfficerHandoff**: one per position in the transition; links the
  outgoing ACTIVE assignment and an INCOMING assignment (both SetNull —
  handoffs survive roster edits); NOT_STARTED → IN_PROGRESS → READY →
  ACCEPTED (requires an incoming officer + all required checklist items).
- **PtaHandoffChecklistItem**: position-specific templates seeded at creation
  (President/Treasurer/Secretary/Committee-Chair/default heuristics on the
  position name), plus custom items. **Credentials are a checklist line
  ("confirm access transferred outside Unestra") — never stored** (§13).
- **Readiness score**: computed, never stored — per-handoff points (incoming
  identified, required checklist complete, accepted) + org-level checks
  (CURRENT bylaws exist, approved minutes archived for the outgoing year),
  rendered as the brief's "78% — completed / missing" breakdown.
- **COMPLETED is the ceremony**: activates every linked INCOMING assignment
  (the existing activate primitive ENDs the outgoing holder — historical
  board preserved, §36), flips the current school year to the incoming year
  (setCurrentSchoolYear keeps the profile label in lockstep), stamps
  completedAt. Requires every handoff ACCEPTED first.
- **Transition packet** (pdf-lib, `pta:board:manage`, audited): org info,
  outgoing/incoming board, committee roster, governance index
  (titles/versions only), recent decisions, open action items, upcoming
  events, outgoing-year meeting history. **Concerns are never auto-included**
  — at most a count of open non-restricted cases, and only when the caller
  holds `pta:concerns:view` (§14).
- **Permissions**: rides `pta:board:view` (see) / `pta:board:manage` (run) —
  transition IS board management; no new permission surface.
- **Deferred deliberately**: incoming-officer *self-service* onboarding
  (guided §15 flow in the member/mobile experience) belongs to PTA-J — this
  PR records acceptance through board managers, which is how most PTAs run a
  handoff meeting anyway.

## PR PTA-G — Volunteer 2.0 (this PR, small)

The audit found volunteering already strong (opportunities, atomic slot
claims, waitlist statuses, check-in/out, hour ledger + adjustments +
approvals, requirements, committee/event linkage) — PTA-G fills exactly the
three audited gaps and touches nothing else:

- **Reports** (§16's list): approved-hours totals, hours by event, hours by
  committee, most active volunteers, unfilled opportunities (live open-spot
  math from slot capacity vs. claims), participation by month. Aggregated
  from the APPROVED hour ledger only. Officer page
  `/labs/pta/volunteers/reports` behind `pta:volunteers:manage` — the
  most-active list is a coordination tool, **never a public ranking** (§16's
  explicit rule). Per-section CSV export, built client-side from the same
  data already on screen.
- **Reminders**: email to every SIGNED_UP volunteer whose shift starts
  within 48h, deduped via new `PtaVolunteerSignup.reminderSentAt` (the whole
  migration is that one nullable column). Two triggers, one lib:
  `/api/cron/volunteer-reminders` (CRON_SECRET pattern, all orgs, safe to
  re-run) and an officer "Send shift reminders now" button (org-scoped,
  audited). Email-only by design: most household adults have no linked
  portal account, so push would silently miss them; adults with no email are
  counted and reported, never silently skipped. Failures leave the stamp
  null so the next run retries.
- **Recurrence**: `repeatPtaVolunteerOpportunity` — N dated OPEN repeats
  (interval × count, capped 12) carrying slots WITH shifted times; the
  existing undated-DRAFT "Duplicate" template copy is preserved unchanged.
  UI: "Repeat weekly ×N" beside Duplicate on the opportunity page. Full
  RRULE recurrence deliberately rejected as over-engineering (§41).

## PR PTA-H — Finance Lite (this PR)

**Core, not PTA-namespaced** (§42): budgets and reimbursements exist in every
vertical, so `BudgetLine`/`ReimbursementRequest` join Expenditure in core
with their own permissions; `/labs/pta/finance` is the PTA treasurer skin.
Explicitly NOT QuickBooks (§20): no ledger, no bank connections, no stored
bank credentials — ever.

- **Budget**: `BudgetLine` per (org, fiscalYear, name) — planned amount plus
  an optional link to an EXPENDITURE `Category`. Actuals are never stored:
  they're computed live from non-void Expenditures in the line's category
  within the fiscal-year window ("2026-2027" → Jul 1 2026–Jun 30 2027,
  "2026" → calendar year, unparseable → all-time), so variance is always
  Budget − Actual with no sync job. Category names are org-defined (§22's
  "don't hard-code" rule applies to budgets too) — the §20 list is seed
  suggestions in the UI, not schema.
- **Reimbursements**: SUBMITTED → UNDER_REVIEW → APPROVED → PAID, REJECTED
  from any pre-PAID state; PAID and REJECTED terminal (resubmit = new
  request). Approval threshold configurable per org
  (`OrgSettings.reimbursementApprovalThreshold`): requests above it START in
  UNDER_REVIEW (flagged for review), at-or-below start SUBMITTED. **Approver
  must differ from submitter** (self-approval forbidden — volunteer-hours
  precedent). **PAID books a real Expenditure row transactionally**
  (payee/category/event carried, reference REIMB-…) and links it — so paid
  reimbursements flow into budget actuals and the existing expenditure
  ledger with zero double-entry. Receipts ride the Attachment pipeline via
  new entity type REIMBURSEMENT.
- **Permissions**: new core `reimbursements:submit` (STAFF+ — chairs and
  officers file their own), `reimbursements:manage` + `budget:read`/
  `budget:manage` (FINANCE/ORG_ADMIN/OWNER; READ_ONLY gets budget:read).
  Submitters see exactly their own requests; managers see all.
- **Treasurer dashboard** (`/labs/pta/finance`, PTA language): income vs
  spend summary, budget-vs-actual table with variance, reimbursement queue
  with inline approve/pay/reject, submit form for officers.

## PR PTA-I — Compliance & Institutional Memory (this PR)

Three §22–§24 capabilities that make the org own its knowledge instead of
its officers:

- **Compliance calendar** (PTA-namespaced per §42's "PTA compliance"):
  `PtaComplianceRequirement` — title, owner (free text, PTA language:
  "Treasurer"), due date, recurrence (NONE/MONTHLY/QUARTERLY/ANNUAL),
  applicability. Display status is DERIVED, never stored: NOT_APPLICABLE if
  switched off, OVERDUE past due, DUE_SOON within 30 days, else COMPLIANT —
  so the dashboard can't go stale. "Mark complete" stamps lastCompletedAt
  and auto-advances the due date by the recurrence interval. The §22
  requirement list (bylaws review, insurance renewal, audit, tax filing,
  state reporting, …) ships as SUGGESTIONS applied by a button — never
  hard-coded as universal (§22's explicit rule); state/local items are just
  rows. Documentation attaches via the Attachment pipeline
  (COMPLIANCE_REQUIREMENT entity type). Rides pta:board:view/manage — 
  compliance is board operations, same authority as the Transition Center.
- **Contact directory + vendor history** (core — every vertical has
  institutional contacts): one `OrganizationContact` model covering both
  §23 and §24 — company/name, person, role, phone/email/website, free-text
  category (UI suggests Principal/District/State PTA/Accountant/Insurance/
  Venue/…, never an enum), notes, active flag, lastReviewedAt, and for
  vendors: isVendor + internal 1–5 rating. **Vendor spend and event history
  are computed, not entered**: non-void Expenditures matching the contact by
  name (case-insensitive) — "historical spend where available" (§24) with
  zero double-entry; paid reimbursements flow in automatically because
  PTA-H books them as Expenditures with the payee as vendor. Contracts/
  documents attach via ORGANIZATION_CONTACT entity type. New core perms
  contacts:read/write (STAFF+ write, READ_ONLY read).
- **Transition packet**: gains "Key contacts" and "Vendors" sections (§23:
  "this becomes part of board transition").

## PR PTA-J — Member Experience (this PR)

§19's "My PTA" for the web portal, §15's deferred officer self-onboarding,
and member-visible documents. Constraint honored: mobile app BUILDS are
frozen, so this PR ships the portal member surface + the server capabilities;
new mobile screens ride a later app release (no placeholder mobile APIs —
§41: capabilities ship when a client can exercise them).

- **Member-visible documents**: new `Attachment.memberVisible` flag
  (default false — nothing leaks by omission), toggled per file by officers
  in the Document Center. Parents read them through a DEDICATED
  linkage-gated route pair (`/api/labs/pta/my/documents` + signed download)
  built on requirePtaHouseholdSelfAccess — parents hold zero Permissions,
  so the member path NEVER touches the RBAC attachment API (the HOA
  resident-path precedent in attachments.ts). Downloads audited.
- **My PTA page** (`/labs/pta/my-pta`, parent tab): member documents,
  current governing documents index (bylaws & policies — titles/versions;
  §19 "Governance information"), the board roster (position + holder name
  ONLY — no personal contact details) with the PTA's contact email as the
  "Contact the board" action, and upcoming meetings (title/date only).
  Volunteer history/attendance deliberately not duplicated — they already
  live on the parent volunteer surface.
- **Officer self-onboarding** (§15, deferred from PTA-F): an incoming
  officer whose assignment links to their own household-adult account sees
  their position's handoff — checklist state, outgoing officer's notes —
  and can ACCEPT their own position. Linkage-gated
  (assignment.householdAdult.userId === session), never a Permission; the
  same acceptance rules apply (required checklist items must be complete),
  and board managers keep their PTA-F path unchanged. Surfaced inside
  My PTA only when applicable — no dead tab.

## PR PTA-K — Dashboard 2.0 (this PR)

The §25 actionable officer dashboard — pure read-side aggregation of
everything A–J built; NO migration, no new mutations.

- **Greeting**: time-of-day + the viewer's own sitting board position
  (resolved through their household-adult link) — "Good evening, President".
- **PTA Health strip**: households, adults, volunteer needs (live open-spot
  math), upcoming events, board fill (X/Y), transition readiness %,
  compliance state, open/overdue action items — each metric linking to its
  surface.
- **Upcoming**: meetings + events + compliance deadlines merged and sorted
  (60 days, top 8).
- **Needs Attention**: derived warnings — unaccepted handoffs (per-position
  when ≤3), open volunteer spots, compliance due-soon/overdue with day
  counts, overdue action items, reimbursements awaiting review, open
  concern cases.
- **§25's two rules enforced in the LIB, not the template**: every section
  is guarded by the viewer's `can` (an unauthorized metric is never
  computed, let alone rendered), and grievances appear at most as a
  permission-safe count of open NON-restricted cases — restricted cases are
  excluded even from the number.
- The existing metrics grid (membership/volunteers/payments/fundraising/
  governance) stays below — Dashboard 2.0 is the actionable layer on top,
  not a rewrite.
