# Unestra for PTA — Volunteer Management and Hours Tracking

## Status

PTA Web UI Integration (PR #19) and Fictional Demo Environment & Platform Administrator Impersonation (PR #20) have both been merged to `main`. This branch (PR #21) was rebased onto the resulting `main` — see "Branch dependency" below for merge commits. PR #21 itself remains open/draft, not merged, not deployed, no production migration applied.

## Stale-UI defect re-investigation (2026-07-26)

A prior report described post-action UI staleness (an officer's check-in/attendance/approval action succeeding server-side but not visibly updating without a manual reload). This was re-investigated carefully — every mutating client component was re-tested live with deliberate waits between the triggering click and the verifying screenshot, across check-in, check-out, attendance confirmation, hour approval/adjustment, requirement updates, and parent signup/cancellation. **The defect did not reproduce.** Every one of the 25 PTA client components that perform a mutating request already pairs it with `router.refresh()` and a `disabled={pending}` guard against double-submission (confirmed both by code audit and by `src/components/labs/pta/__tests__/refresh-consistency.test.ts`, a static-source regression test — see "Tests"). The original report is believed to have been a testing-methodology artifact: screenshotting immediately after a click, before the async fetch-then-refresh round trip completed. No code changes were made for this non-reproducing defect, per explicit instruction not to add speculative fixes; the regression test exists so a future change that actually drops a refresh call fails CI instead of only surfacing in manual testing.

## Rollback strategy

The migration (`20260725114304_add_pta_volunteer_hours_tracking`) is purely additive — `ALTER TYPE ... ADD VALUE` on existing enums, `ADD COLUMN` on existing tables, and `CREATE TABLE` for the four new models (`PtaVolunteerAttendance`, `PtaVolunteerHourEntry`, `PtaVolunteerHourAdjustment`, `PtaVolunteerRequirement`). It never drops, renames, or narrows anything that pre-existing code depends on. Rollback implications:

- **Before this migration is applied**: simply don't deploy this PR. Nothing else in the codebase depends on the new tables/columns, so the pre-existing schema and all other features are completely unaffected either way.
- **After this migration is applied but before this PR's application code ships**: the new tables/columns exist but are unused — harmless. No existing query touches them (Prisma only queries columns/tables the running code references).
- **After both ship and need to be rolled back**: revert the application code deploy first (safe — the old code never references the new tables/columns). The schema changes themselves do not need to be reverted to make rollback safe, since Postgres enum values and extra columns/tables sitting unused cause no functional or performance impact. If a full schema rollback is still desired, it requires a hand-written down-migration (Prisma does not auto-generate one) that drops the four new tables and the columns added to existing tables — enum values added via `ALTER TYPE ... ADD VALUE` cannot be cleanly removed in Postgres without recreating the enum type, so a full enum-level rollback would require an accompanying data migration if any row had already used a new enum value.
- No existing row's data is modified by this migration — every new column is nullable or has a safe default, and every backfill-free.

## Product goal

Give a PTA officer (Volunteer Coordinator, President, or anyone with `pta:volunteers:manage`) a complete lifecycle for volunteer opportunities — post an opportunity, publish shifts, let parents sign up, check volunteers in/out or record attendance after the fact, calculate actual credited hours, review and approve those hours, and report on participation — without assuming every PTA cares about hours at all. A PTA that only wants sign-up coordination (no hours tracking) is fully supported; hours-tracking is additive, not mandatory.

## Explicit design principle: five separate concepts, never collapsed

The brief for this feature explicitly forbade collapsing signup, attendance, and approved credit into a single mutable status field. The schema reflects that as five distinct models:

| Model | Represents | Mutates when |
|---|---|---|
| `PtaVolunteerOpportunity` | The volunteer activity itself (title, committee, school year, cancellation deadline) | Officer edits/publishes/cancels/archives it |
| `PtaVolunteerSlot` | A specific shift — time window, capacity, minimum staffing | Officer edits capacity/timing |
| `PtaVolunteerSignup` | A household adult's claim on a slot (self-signup or officer manual assignment) | Parent signs up/cancels; officer manually assigns/overrides |
| `PtaVolunteerAttendance` | What actually happened at the shift — check-in/check-out timestamps, and a separate outcome (ATTENDED/PARTIAL/NO_SHOW/EXCUSED) | Check-in/check-out actions (raw, idempotent); a distinct explicit "confirm outcome" action |
| `PtaVolunteerHourEntry` (+ `PtaVolunteerHourAdjustment`) | The actual credited-hours ledger, its approval state, and any post-approval correction with a mandatory reason | Auto-proposed from confirmed attendance or officer-entered minutes; approved/rejected by an officer who is never the same person who submitted it; adjusted only after approval, with an audited reason |

A signup being `SIGNED_UP` says nothing about whether the person showed up. Attendance being `ATTENDED` says nothing about how many minutes were actually credited — that's a separate, explicit hour entry, which itself says nothing until an officer approves it. Only `APPROVED` hour entries ever count toward a household's or volunteer's total.

## Hours calculation precedence

Implemented in `computeCreditedMinutes()` (`src/lib/labs/pta/volunteers.ts`), in this explicit priority order — verified by `volunteers-hours.test.ts`:

1. **Explicit officer-entered minutes** (`enter exact minutes` in the UI) — always wins if provided, e.g. for a volunteer whose real-world time didn't match the shift window.
2. **Actual check-in/check-out duration** — if both timestamps exist, credited minutes are computed from the real elapsed time, not the scheduled shift length.
3. **Scheduled slot duration, only if attendance is confirmed** (ATTENDED/PARTIAL) without real check-in/out timestamps — e.g. an officer marking a past shift as attended after the fact, with no live check-in ever performed.
4. **Never automatic credit for mere signup.** A `SIGNED_UP` (or even a claimed, unattended) signup produces no hour entry and no credited minutes at all. Showing intent to volunteer is not volunteering.

## Attendance workflow: check-in/check-out are separate from outcome

`checkInPtaVolunteer()`/`checkOutPtaVolunteer()` (idempotent, server-timestamped, race-safe — see "Concurrency" below) only ever record *when* something happened. They do not, by themselves, set the signup's outcome status. A separate explicit action (`setPtaVolunteerAttendanceStatus()` — the Attended/Partial/No-show/Excused buttons in the officer UI) confirms the outcome and is what actually proposes an hour entry via the precedence rules above. This was verified live in a real browser walkthrough: checking a volunteer in and out left their signup showing its prior status (e.g. `NO_SHOW`) until the officer explicitly clicked "Attended" to confirm the outcome — at which point both the signup and a `PENDING` hour entry updated together. This is deliberate, not a bug: it lets an officer correct a bad no-show/excused mark by walking someone through a live check-in without silently overwriting judgment calls.

## Hour approval workflow

- An officer can adjust the proposed minutes before approving (`adjust before approving` in the UI) — the final `creditedMinutes` is whatever the officer approves, and the approval's audit event (`pta.volunteer_hour_entry.approved`) records whether it was adjusted at approval time.
- **No self-approval**: `assertNotSelfApproval()` blocks an officer from approving their own submitted/proposed hours — verified by test and by the live walkthrough (the seed data's Morgan/president entries were pre-approved by seed data specifically because the president cannot approve their own).
- Rejecting requires a mandatory reason (`rejectPtaVolunteerHourEntry()` throws `PTA_VALIDATION_ERROR` for an empty reason).
- **Post-approval corrections** go through `PtaVolunteerHourAdjustment`, a separate audited model requiring a reason — never a silent edit to an already-approved `creditedMinutes`. The demo data's Morgan household scenario (780 base minutes approved, then a +120 minute adjustment with a documented reason, for 900 total) exercises this path.
- Household/member hour totals (`getPtaVolunteerHourTotalsForHousehold()`) are derived strictly from `APPROVED` entries. A household with no requirement configured shows "not required," never a misleading zero — absence of a requirement is not the same as a requirement of zero.

## Concurrency — proven against real Postgres, not mocked

Three real race conditions were found and fixed during this task by running actual concurrent load against a disposable local Postgres instance (`volunteers-concurrency.integration.test.ts`, gated behind `PTA_RUN_DB_INTEGRATION_TEST=1`, skipped in a normal `vitest run`):

1. **Attendance-row creation** — a naive find-then-create for a signup's first-ever attendance record threw a real `P2002` unique-constraint violation under 5 concurrent check-in calls. Fixed by switching to `prisma.ptaVolunteerAttendance.upsert()`.
2. **`upsert()` itself is not guaranteed atomic** under real concurrent load in this Prisma/Postgres version combination — the same test still threw P2002 from inside `upsert()` after fix #1. Fixed by wrapping the upsert in a try/catch for `Prisma.PrismaClientKnownRequestError` with `code === "P2002"`, falling back to `findUniqueOrThrow()` to read back whichever concurrent call actually won.
3. **Check-in/check-out timestamp races** — an unconditioned `update()` let multiple concurrent callers each stamp a different `new Date()` (last-write-wins), which would violate real-world idempotency (a shaky wifi connection retrying a check-in should never move the recorded time). Fixed by using a conditional `updateMany({ where: { id, checkInAt: null } })` — exactly the same "conditional update, check `count === 1`" pattern already proven for slot-capacity claims in the base PTA MVP.

Manual assignment capacity is protected by the same pre-existing conditional-`updateMany` capacity-claim pattern; a dedicated concurrency test (10 concurrent manual assignments against a slot with capacity 3) confirms exactly 3 succeed.

## Authorization

Two new granular permissions in `src/lib/rbac.ts`: `pta:volunteers:checkin` and `pta:volunteer-hours:approve`, both added to the `ORG_OWNER`/`ORG_ADMIN`/`STAFF` default bundles alongside the existing `pta:volunteers:manage` — and **deliberately not added to the `FINANCE` (Treasurer) bundle**. A Treasurer does not automatically gain volunteer-hours authority just because they hold financial permissions; an organization that wants a Treasurer to also approve hours must do so explicitly via the existing `OrgRolePermissionSet` override system, not by default.

Platform Administrator impersonation (from PR #20) was re-verified against this feature: an impersonated officer session sees exactly the permissions of the impersonated role, with no elevated platform-admin capability leaking through — consistent with the existing impersonation session-overlay design.

## Manual assignment with audited override

Officers can assign a household directly to a slot (bypassing self-signup) via `assignPtaVolunteerToSlot()`. Assigning past a slot's capacity requires an explicit override flag and is always audit-logged with the acting officer's id — capacity is a real constraint, not just a UI suggestion, so bypassing it is a deliberate, traceable action rather than a silent side effect.

## Reports

Implemented via existing dashboard/detail-page aggregation queries (no new reporting subsystem): hours by household (`getPtaVolunteerHourTotalsForHousehold()`, `listPtaVolunteerHoursByHousehold()`), understaffed shifts (slots below their informational `minNeeded` — a staffing signal, not a hard cap), pending-approval queue, and per-opportunity roster/attendance/hours breakdown on each opportunity's management page. All confirmed against real seeded data during the browser walkthrough (see "Manual verification" below).

## Volunteer requirements are optional, per-organization

`PtaVolunteerRequirement` is keyed on `(organizationId, schoolYear)` and is simply absent for a PTA that doesn't track a required number of hours. The parent-facing UI explicitly renders "This PTA doesn't require a set number of hours" rather than a bare `0` when no requirement row exists — verified both by test and live in the browser (Riverdale-style "no requirement" case is the default; Pine Grove's demo data configures a 10-hour/year requirement).

## Mobile-readiness (documented, not built)

Per the task's explicit scope, no mobile UI or QR-based check-in was built this pass. The API surface (`checkInPtaVolunteer`/`checkOutPtaVolunteer`, `signups/[signupId]/checkin`/`checkout` routes) is already the natural integration point for a future QR-code or mobile check-in flow — a mobile client would call the same idempotent, server-timestamped endpoints a desktop officer UI does today. No new plumbing is required to support that later; this is a documentation note, not a commitment of new surface area.

## API surface (new routes, all under `/api/labs/pta/volunteers/*` and `/api/labs/pta/my-household/*`)

| Area | Routes |
|---|---|
| Opportunities | `GET/POST /opportunities`, `GET/PATCH /opportunities/[id]`, `POST /opportunities/[id]/status` (publish/close/cancel/archive), `POST /opportunities/[id]/duplicate`, `POST /opportunities/[id]/slots` |
| Slots | `GET/PATCH /slots/[id]`, `POST /slots/[id]/claim` (self-service), `POST /slots/[id]/cancel` (self-service, honors cancellation deadline + officer override), `POST /slots/[id]/assign` (officer manual assignment, audited capacity override) |
| Attendance | `POST /signups/[id]/checkin`, `POST /signups/[id]/checkout`, `POST /signups/[id]/attendance` (confirm outcome: Attended/Partial/No-show/Excused, or exact minutes), `POST /signups/[id]/complete` (legacy simple-completion path, retained) |
| Hours | `GET /hour-entries/pending`, `POST /hour-entries/[id]/approve`, `POST /hour-entries/[id]/reject`, `POST /hour-entries/[id]/adjust` (post-approval correction, requires reason) |
| Requirement | `GET/PUT /requirement` |
| Parent self-service | `GET /volunteers/my-commitments`, `GET /my-household/volunteer-hours` |

Every officer route is gated by `requirePtaAccess(<pta:* permission>)`; every self-service route resolves the caller's own household/adult id server-side, never from a client-supplied id.

## UI

Officer: `/labs/pta/volunteers/manage` (opportunity list, overview metrics, understaffed-shift callout, requirement configuration), `/labs/pta/volunteers/manage/[opportunityId]` (shift roster, check-in/out, attendance confirmation, manual assignment), `/labs/pta/volunteers/approvals` (hour-approval queue, adjust-before-approve, approve/reject). Parent: `/labs/pta/volunteers` (browse/claim/cancel, family volunteer-goal progress, my signups, my completed service). Dashboard (`/labs/pta/dashboard`) surfaces approved-hours-this-year, pending-hour-approvals (with a direct link), and understaffed-shift counts alongside existing PTA metrics. `Manage Volunteers` and `Hour Approvals` are both top-level nav tabs, discoverable without hunting.

## Demo data (`prisma/seed-pta-demo.ts`)

Extended the existing fictional Pine Grove School PTA seed with: a 10-hour/year volunteer requirement; a fifth "Picture Day Helpers" opportunity (open, understaffed by design — 0/2 minimum); a canceled "Fall Festival Setup" opportunity; and a completed "Teacher Appreciation Breakfast" opportunity whose single shift exercises every attendance/hours outcome at once — Morgan household ATTENDED with 900 approved minutes (780 base + a 120-minute post-approval adjustment, demonstrating the audit-trail path), Osei household ATTENDED with exactly 600 approved minutes (meets the requirement exactly), Kim household ATTENDED with 480 pending minutes, Patel household ATTENDED with 90 minutes rejected (with a documented rejection reason), a second Kim adult marked NO_SHOW, an Osei adult marked EXCUSED, and the Whitfield household deliberately given no signup/attendance/entry at all (the "zero hours" case). Riverdale Community Association (the second, non-PTA seeded org) remains completely unaffected — confirmed both by test and by a live browser check showing "Manage Volunteers: Not available for this organization" while logged in as a user who is a member of both organizations.

**A real bug was caught and fixed during this seeding work**: the seed script's `seedAttendedSignup()` helper originally never set `householdId` on the signup row it created, so every one of these hour-entry scenarios silently had a blank `householdId` — meaning `getPtaVolunteerHourTotalsForHousehold()` and any household-hours report would have shown zero for all of them despite the underlying ledger being completely correct. This was only caught by directly querying the seeded data with a household-join SQL query (not by trusting the seed script's own success log output), and was fixed by resolving the real household id from the household-adult record before creating the signup. Re-verified idempotent (seed script safe to re-run) after the fix.

## Manual verification (real browser walkthrough)

Performed live against the disposable `civicflow_volunteer_dev` Postgres database (not production, not the shared review database) with the dev server bound to port 3000 to match `NEXTAUTH_URL`:

- Logged in as the seeded PTA president; confirmed the org-switcher correctly shows both Pine Grove (Owner) and Riverdale (Staff) memberships.
- Dashboard metrics matched hand-computed expectations exactly: 25.0 approved hours (900 + 600 minutes), 1 pending approval, 1 understaffed shift.
- Manage Volunteers list showed all 5 opportunities with correct statuses (OPEN/CANCELLED/COMPLETED) and fill counts.
- Live-exercised check-in → check-out → explicit "Attended" confirmation on a previously NO_SHOW volunteer; confirmed via direct database query that the real elapsed duration (13 seconds in this test) was correctly floored to 0 credited minutes by the precedence engine, and that this auto-created a new `PENDING` hour entry exactly as designed.
- Live-exercised "adjust before approving" (480 → 510 minutes) and Approve on a real pending entry; confirmed via database query that `creditedMinutes`, `status`, `approvedByUserId`, and `approvedAt` all persisted correctly, and that the audit event log recorded the adjustment.
- Confirmed Riverdale (the non-PTA org) shows "Manage Volunteers: Not available for this organization" for the same logged-in user — zero cross-vertical leakage.
- Confirmed the parent-facing view (same president, viewing his own Morgan household) correctly showed 15 approved hours, "remaining toward goal" clamped to 0 rather than a negative number, an open self-signup, and completed-service history.

### Finalization pass (2026-07-26), after PR #19 and PR #20 merged and this branch was rebased onto the resulting `main`

- **Stale-UI re-investigation**: re-tested check-in, check-out, and attendance confirmation with deliberate waits between each click and its verifying screenshot. The previously reported staleness did not reproduce — see "Stale-UI defect re-investigation" above.
- **Parent signup/cancellation live-capacity check**: claimed "Picture Day Helpers" (0/3 → 1/3, "My signups" updated), then canceled it (1/3 → 0/3 restored) — both updated the visible UI with no manual reload.
- **Requirement update**: changed the family volunteer-hour goal from 10 to 12 hours via the officer settings form; a "Saved." confirmation appeared and the new value (720 minutes) was confirmed persisted via direct database query.
- **Responsive check**: the check-in/attendance page and the officer nav were tested at tablet width (768px) and mobile width (375px). Both remain fully usable — action buttons wrap onto their own rows, no horizontal overflow, no hidden or unreachable controls. The event-day check-in workflow works on a phone-sized browser.
- **Impersonation re-verification** (PR #20, now merged): full walkthrough re-run against the rebased branch — persistent banner, org-switching to Riverdale (which correctly shows zero PTA nav and denies the direct route with a forbidden redirect), exit restoring Platform Admin context, and both the "started" and "ended" audit events correctly attributing the real superadmin actor.

## Known limitations

- **Self-reported hours (a parent proposing their own minutes without an officer-initiated check-in) were deliberately deferred**, per an explicit decision during this task, rather than shipped as a half-safe placeholder. All current hour entries originate from an officer action (check-in/out, attendance confirmation, or manual entry) or the seed script — never from an unauthenticated or self-asserted parent claim.
- **Notifications are not wired up** — no existing notification architecture was found to reuse for "your hours were approved/rejected" or "a shift you signed up for was canceled." Documented as deferred, matching the brief's explicit instruction to degrade gracefully rather than build a new notification pipeline for this pass.
- **No QR/mobile check-in** — see "Mobile-readiness" above.
- Pre-existing, unrelated: 5 TypeScript errors in `src/lib/__tests__/migration-import.test.ts` (a desktop-migration-import test file, untouched by this branch) were present in the baseline before this work began (confirmed present even on PR #19 alone) and remain outside this task's scope.

## Branch dependency

PR #19 (PTA Web UI Integration) and PR #20 (Fictional Demo Environment & Platform Administrator Impersonation) have both been independently validated and merged to `main` (merge commits `7161f65` and `d3dd95e` respectively). This branch was then rebased onto the resulting `main` — git's patch-id matching automatically recognized and skipped the two commits already merged via PR #20, leaving exactly one commit (the volunteer-management work) on top of `main`. PR #21 itself remains open/draft pending final human review; it was not merged as part of this finalization pass, per explicit instruction.
