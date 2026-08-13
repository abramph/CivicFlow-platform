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
