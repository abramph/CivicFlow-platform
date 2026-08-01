# Unestra for PTA — Labs MVP

> **Superseded by PR #40 (2026-07-29):** PTA/PTO graduated from this
> Labs-gated pilot into a first-class Unestra vertical. `ptaVertical` is now
> `lifecycle: "RETIRED"` in the registry — it grants no access, is hidden
> from new Labs enrollment, and existing enrollment rows are historical/
> inert only. `Organization.primaryVertical === "PTA"` is now the sole
> access gate. See `docs/pta-access-architecture.md` and
> `docs/labs-feature-lifecycle.md` for the current architecture. This
> document is kept as a historical record of the original MVP build.

## Hardening-review status (2026-07-22)

This MVP went through an independent hardening review after initial implementation: a fresh adversarial code-review pass plus a hands-on smoke test executed directly against a real disposable Postgres instance (not just mocked unit tests). **Two real, critical defects were found and fixed**, and one significant usability gap (most officer-facing management functions had no HTTP route at all) was closed. See "Hardening-review findings" below for the full account, including what was found, what was fixed, and what remains an intentionally accepted limitation.

## Product goal

Validate whether Unestra's existing multi-tenant association platform can support a parent-teacher association (PTA/PTO) — household/family membership, school-year-scoped students and classrooms, volunteer signups, dues, events, fundraising, and communications — without building a separate application or weakening tenant isolation. This is a **product-validation experiment**, not a full school-management system, and it is not a student information system.

## Target user

A PTA board (President, VP, Treasurer, Secretary, Membership Chair, Volunteer Coordinator, Committee Chairs) running membership, dues, events, volunteer coordination, fundraising, and governance for a single school's parent organization, and the parents/guardians (households) who join it.

## Labs enrollment

Registered as `ptaVertical` ("Unestra for PTA") in `src/lib/labs/registry.ts`: `lifecycle: "ALPHA"`, `requiresEntitlement: true`, `requiresEnrollment: true`, `internalOnly: false`, `metered: false`.

Unlike Meeting Intelligence (`internalOnly: true`, APH-only forever by design), this vertical is deliberately **not** internal-only — it's meant, if it proves out, for a real paying customer someday. `internalOnly: false` only means the registry doesn't forbid a non-billing-exempt org from being enrolled; **this PR does not enroll any production organization**. The only organization enrolled anywhere is the fictional local seed org (see "Fictional test organization" below).

Enable/disable via the existing Operations Center (`/admin/platform/labs`) — no new enrollment UI or write path was built; `ptaVertical` uses the exact same `setOrganizationLabEnrollment()` function every other Labs feature uses. Disabling immediately removes access (verified by `guard.test.ts`).

## Reusable Unestra modules (nothing new)

| Capability | Reused as-is |
|---|---|
| Dues/payments | `DuesAccount` / `DuesCharge` / `DuesPayment` / `DuesAdjustment` / `PaymentLink` / `PaymentReport`, and `recordDuesPayment()` (`src/lib/dues-payments.ts`) |
| Fundraising | `Campaign` / `Contribution` / `ContributionReceipt` / `PaymentLink` (type `CAMPAIGN`) |
| Communications | `CommunicationCampaign` + `resolveCommunicationRecipients()`'s `"manual"` selector + `memberIds` list (`src/lib/communication-campaigns.ts`) — zero changes to that file |
| Events | `Event` (unchanged) |
| Meetings/governance | `Meeting` (unchanged) — PTA meetings are `Meeting` rows |
| Documents/minutes | `Attachment` (unchanged) — approved minutes are an `Attachment` with `entityType: MEETING`, `purpose: "approved_minutes"` |
| RBAC | `src/lib/rbac.ts`'s existing `Role`/`Permission`/`OrgRolePermissionSet` system — no new `Role` enum values |
| Multi-org support | `OrganizationMembership` + `src/lib/org-context.ts`'s active-org switching — unchanged |
| Audit | `createAuditEvent()` — unchanged |
| API error handling | `withApiErrorHandling()`, extended with one new `PtaError` branch (mirrors `MeetingIntelligenceError`) |

## Hardening-review findings

An independent adversarial code review plus a hands-on smoke test (executed directly against a real disposable Postgres instance, exercising every lib function's real code path — not a UI click-through, but not mocked either) were run after the initial implementation. Results:

### Critical defects found and fixed

1. **`PtaHouseholdAdult.userId` was globally unique, not per-organization.** The original migration created `CREATE UNIQUE INDEX ... ON "PtaHouseholdAdult"("userId")` — a bare global constraint. This made it **impossible for the same user to ever be a household adult in a second PTA organization**, directly breaking the explicit multi-org-parent requirement. Caught by the hands-on smoke test (a real `P2002` constraint violation, not a mock), not by any of the original mocked unit tests — mocked Prisma clients don't enforce real constraints, so a wrong constraint *scope* is invisible to them. **Fixed**: the migration was regenerated (never applied anywhere persistent, so safe to amend) with `@@unique([organizationId, userId])`. A permanent real-database regression test now exists specifically for this (`household-adult-constraint.integration.test.ts`), proving both that the same user can join two organizations and that a duplicate within one organization is still correctly rejected.
2. **`requirePtaHouseholdSelfAccess()` never checked household status.** A parent linked to a household an officer had deactivated (e.g., a family that left the PTA) retained full self-service access — claiming volunteer slots, RSVPing, viewing household data — indefinitely, since no self-service route re-checked `PtaHousehold.status`. **Fixed**: the guard now includes the household's status in its own query and throws `PTA_HOUSEHOLD_INACTIVE` (403) for anything other than `ACTIVE`, centralizing the check so every self-service route inherits it at once. Verified by both a mocked unit test and the hands-on smoke test against a real deactivated household.
3. **`claimPtaVolunteerSlot()`/`cancelPtaVolunteerSignup()` were not transactional.** The atomic `claimedCount` update and the signup row write were two separate, non-transactional Prisma calls; a failure between them could permanently inflate/corrupt `claimedCount` with no matching signup, or leave a signup cancelled while the slot still showed it as occupied. **Fixed**: both are now wrapped in `prisma.$transaction(async (tx) => ...)`. Re-verified under real concurrent load after the fix — 10 concurrent claims against a slot with capacity 3 still resulted in exactly 3 successes (`volunteers-concurrency.integration.test.ts`).

### Significant usability gap found and closed

4. **Most officer-facing management functions had zero HTTP route.** `addPtaHouseholdAdult`, `addPtaStudent`, `deactivatePtaStudent`, the entire `committees.ts` module, the entire `academic.ts` module (grades/teachers/classrooms/enrollment), `addPtaVolunteerSlot`/`completePtaVolunteerSignup`, and the entire `dues.ts` module were implemented and unit-tested but reachable **only from tests and the seed script** (which bypasses them with raw Prisma writes) — not from any API route. A real officer using the deployed app could create an empty household shell via `/labs/pta/settings` and `/api/labs/pta/households`, but had no way, through the app itself, to add an adult or student to it, create a committee, set up grades/classrooms, add a volunteer slot, or create/record/waive a dues charge. **Fixed**: 18 new API routes were added, wiring every one of these functions through the existing `requirePtaAccess()`/`requirePtaHouseholdSelfAccess()` guards (see "API surface" below) — no new business logic, purely routing to already-tested functions.

### Confirmed non-issues (reviewed, no defect found)

- Household billing-identity bridge (`PtaHousehold.orgMemberId → OrgMember`), dues cross-tenant scoping, communications-targeting cross-tenant scoping, and audit/log privacy (no student/household names in any `createAuditEvent` call or `console.*` statement) were all independently re-verified and found correct.
- No existing Group/Committee model was available for `PtaCommittee` to reuse instead (confirmed via schema search) — the new table is genuinely necessary.
- RSVP (`PtaEventRsvp`) never writes to, or is confused with, `AttendanceRecord` — verified by test; they remain two deliberately separate, non-reconciled signals for the same event (see "Known limitations").

### Accepted, documented limitations (not fixed — explicitly out of this PR's scope)

- **No capacity field exists on `Event` or `PtaEventRsvp` at all.** The original task's "optional capacity" for events was never implemented — there is nothing to overbook, but also nothing to enforce if an officer wants a cap. This is different from volunteer slots (which do have real, race-safe capacity enforcement).
- **Hard household delete (`deletePtaHousehold`) is intentionally not exposed via any HTTP route** — only `deactivatePtaHousehold` (soft) is reachable from the API. This is a deliberate safety choice (accidental hard deletes are a worse failure mode than an officer occasionally needing raw database access for the rare zero-history household), not an oversight.
- Household merge, household split, and automatic membership-model (individual ↔ household) conversion are **not supported** by any function, and deliberately so — see "Household lifecycle" below.

## New PTA-specific models (additive migration `20260722235539_add_pta_labs_mvp`)

`PtaProfile`, `PtaHousehold`, `PtaHouseholdAdult`, `PtaStudent`, `PtaGrade`, `PtaTeacher`, `PtaClassroom`, `PtaStudentEnrollment`, `PtaVolunteerOpportunity`, `PtaVolunteerSlot`, `PtaVolunteerSignup`, `PtaCommittee`, `PtaCommitteeMember`, `PtaEventRsvp` — 14 tables, 9 enums. Every model carries `organizationId` directly.

**Why this many, given the reuse table above**: none of Unestra's existing models have any household/family grouping (`OrgMember.householdName` is free text only, no relation), no grade/classroom/teacher concept, no event RSVP/capacity concept, and no volunteer-slot concept. These are the genuinely missing pieces; everything else (dues, fundraising, communications, meetings, documents) is reused unchanged.

### The household's "billing identity"

`PtaHousehold.orgMemberId` is a normal `OrgMember` row, created automatically when a household is created (`createPtaHousehold()`). This is what makes dues, `PaymentLink`, `PaymentReport`, and the whole existing financial pipeline work for a household with **zero new payment code** — a household's dues charge is just a `DuesCharge` scoped to this `OrgMember`, exactly like any other member's dues. The FK (`PtaHousehold.orgMemberId → OrgMember`) is `onDelete: SetNull`, so deleting/deactivating a household never deletes its `OrgMember` or dues history.

### Data minimization — `PtaStudent`

Deliberately minimal: `displayName`, `status` (ACTIVE/INACTIVE) only. Grade/classroom association is a *separate*, year-scoped row (`PtaStudentEnrollment`), never stored directly on the student, so a school-year rollover never overwrites history — it only adds a new row.

**Never collected, anywhere in this schema:** date of birth, medical/disability information, academic grades, discipline records, student ID numbers, custody information, emergency contacts, transportation data, or any other protected education record. This is not a student information system and makes no FERPA/COPPA/compliance claim (see "Privacy limitations" below).

### Volunteer overbooking prevention

`PtaVolunteerSlot.claimedCount` is only ever changed via an atomic conditional `UPDATE ... WHERE claimedCount < capacity` (`claimPtaVolunteerSlot()`) — the same pattern Meeting Intelligence's worker uses for its job-claim mechanism. The claim and its signup-row write (and the mirror-image cancellation) are wrapped in a single `prisma.$transaction(...)` — added during the hardening review after the two were found to be separate, non-transactional calls with a real partial-failure window (see "Hardening-review findings"). **Proven, not just claimed**: `volunteers-concurrency.integration.test.ts` fires 10 real concurrent claims (via `Promise.allSettled`, against a real disposable Postgres instance, not mocked) at a slot with capacity 3 and asserts exactly 3 succeed — re-run and re-verified after the transaction fix, same result. This test is skipped by default in a normal `vitest run` (it requires a live database); run it explicitly per the command in its own file header when validating a change to this code path.

## Permissions (RBAC)

Thirteen new granular permissions in `src/lib/rbac.ts`, namespaced `pta:*`: `directory:read`, `households:manage`, `students:manage`, `dues:manage`, `events:manage`, `volunteers:manage`, `committees:manage`, `fundraising:manage`, `announcements:publish`, `documents:manage`, `minutes:review`, `minutes:approve`, `analytics:read`.

**Officer titles (President, Treasurer, Secretary, Membership Chair, Volunteer Coordinator, Committee Chair, General Member) are not new `Role` enum values** — they map onto the existing `ORG_OWNER`/`ORG_ADMIN`/`FINANCE`/`STAFF`/`READ_ONLY` roles' default `pta:*` bundles (President/VP → full bundle; Treasurer → dues/fundraising/analytics-shaped `FINANCE` bundle; Secretary/Membership Chair/Volunteer Coordinator → operational `STAFF` bundle; General Member → read-only directory/analytics). An organization can further customize any of these four via the existing `OrgRolePermissionSet` override system — no new authorization mechanism was built. No officer role grants unrestricted platform administration; `PlatformAccess`/`SUPER_ADMIN` is untouched.

**Parent self-service is deliberately NOT a permission.** `MEMBER` role holds zero permissions by design (an existing, documented invariant this PR does not touch). A parent's access to their own household, dues, RSVPs, and volunteer signups goes through `requirePtaHouseholdSelfAccess()` (`src/lib/labs/pta/guard.ts`), which resolves the caller's household strictly from their own linked `PtaHouseholdAdult.userId` — never from a client-supplied household id, and never via `canDo()`/`requirePermission()`.

## Household and student authorization design

- Every PTA lib function takes `organizationId` as an explicit required parameter and scopes every Prisma query by it (mirrors `meeting-intelligence/jobs.ts`'s convention) — verified by dedicated cross-tenant tests for households, students, classrooms, volunteer slots, committees, and event RSVPs.
- A household adult never sees another household's data — the self-service guard resolves exactly one household per caller, and no route accepts a client-supplied household id for a self-service action (claim/cancel/RSVP all resolve the actor's own household/adult id server-side).
- An officer's `pta:*` permissions are checked via the standard organization-scoped `requirePermission()` — they operate only within the officer's active organization, exactly like every other permission in this codebase.
- Multi-organization: a parent belonging to two PTA organizations uses the existing `OrganizationMembership`/active-org-switching system unchanged — `requirePtaHouseholdSelfAccess()` always resolves the household for the *currently active* organization only, so switching orgs correctly changes which household (if any) is visible, with no leakage between them. **This depends on `PtaHouseholdAdult.userId` being unique per-organization, not globally** — the original migration got this wrong (see "Hardening-review findings"); it is now `@@unique([organizationId, userId])` and covered by a dedicated real-database regression test.
- A parent whose linked household has been deactivated (`status !== "ACTIVE"`) is blocked from every self-service action — `requirePtaHouseholdSelfAccess()` checks this centrally (added during the hardening review; see "Hardening-review findings").

## Household lifecycle

Supported: create household → add/remove adults → change primary/secondary contact → deactivate (soft) → hard-delete only if the household's billing-identity `OrgMember` has zero `DuesCharge` rows (verified by test on both the allowed and blocked path). Changing `PtaProfile.membershipModel` (individual/household/family) is an **organization-level display setting only** — verified by test that flipping it never mutates, deletes, or creates any existing `PtaHousehold` row as a side effect.

**Not supported, deliberately**: merging two households, splitting one household into two, or automatically converting existing data when `membershipModel` changes. No function exists for any of these. This is enforced at the database level, not just by omission — `PtaHousehold.orgMemberId` is `@unique`, so even a manual attempt to point two households at the same billing identity fails with a real constraint violation (verified by test). If a real pilot needs household merge/split, that is new, carefully-scoped work for a future PR — implementing it now would risk silently corrupting dues history, which this MVP treats as sacrosanct.

## Payments and dues

See "The household's billing identity" above. `createPtaDuesCharge()` creates (or reuses) a `DuesAccount` named "PTA Membership Dues" for the household's `OrgMember`, then a `DuesCharge` for the given school-year period. `recordManualPtaDuesPayment()` delegates to the platform's own `recordDuesPayment()` — no reimplemented balance math, so it can never drift from how every other manual dues payment in the app is recorded. `waivePtaDuesCharge()` sets the charge `WAIVED` and records a `DuesAdjustment` (type `WAIVER`). **PTA dues are never mixed with `Organization.plan`/Stripe subscription billing** — the two are entirely separate concerns (money the household pays the PTA vs. money the PTA org pays Unestra).

## Events and volunteering

- Events reuse the existing `Event` model unchanged. `PtaEventRsvp` is the one genuinely new piece (Event has no RSVP/capacity concept at all) — household-level, with an `attendeeCount` and GOING/NOT_GOING/MAYBE status.
- **QR check-in for PTA events is a known gap, not implemented** — see "Known limitations."
- Volunteer opportunities → slots → signups, with atomic claim/release (see above). Parents browse, claim, and cancel via `/labs/pta/volunteers`; officers create opportunities/slots via the API (`POST /api/labs/pta/volunteers/opportunities`).

## Fundraising

Reuses `Campaign`/`Contribution`/`PaymentLink` unchanged — no new model, no raffle/gaming/auction/tax-deductibility feature.

## Communications

`src/lib/labs/pta/communications.ts`'s `resolvePtaTargetMemberIds()` computes an `OrgMember` id list for a targeting rule (`all` / `grade` / `classroom` / `committee` / `volunteers_for_event` / `unpaid`), which is then fed into the **existing, unmodified** `resolveCommunicationRecipients()`'s `"manual"` selector + `memberIds`. No new targeting engine, no new send/opt-in/STOP-HELP logic. The resolver never returns a student name — only `OrgMember` ids.

## Parent portal experience

`/labs/pta/my-household` (view household/students, self-service only), `/labs/pta/volunteers` (browse + claim/cancel), `GET /api/labs/pta/volunteers/my-commitments` (a parent's own past/present volunteer commitments), and `GET /api/labs/pta/minutes` (approved minutes only — see below). Dues payment and committee-membership views are supported at the lib/API layer (`dues.ts`, `committees.ts`) but still have no dedicated parent-facing **page** in this MVP — see "Known limitations." (Household adult/student management, committees, academic structure, and dues now all have real API routes as of the hardening pass — see "API surface" — but those routes are officer-facing, gated by `pta:*` permissions, not parent self-service.)

## API surface

All 26 API routes under `/api/labs/pta/*`, by area:

| Area | Routes |
|---|---|
| Profile | `GET/PUT /profile` |
| Households | `GET/POST /households`, `GET/PATCH/DELETE /households/[id]` (DELETE = deactivate, soft only — see "Hardening-review findings"), `POST /households/[id]/adults`, `DELETE /households/[id]/adults/[adultId]`, `POST /households/[id]/students`, `DELETE /households/[id]/students/[studentId]` (deactivate) |
| Dues | `GET/POST /households/[id]/dues` (status / create charge), `POST /households/[id]/dues/[chargeId]/payments`, `POST /households/[id]/dues/[chargeId]/waive` |
| Academic structure | `GET/POST /grades`, `GET/POST /teachers`, `GET/POST /classrooms`, `POST /students/[id]/enroll` |
| Committees | `GET/POST /committees`, `GET/PATCH /committees/[id]` (set chair), `POST /committees/[id]/members`, `DELETE /committees/[id]/members/[adultId]` |
| Volunteers | `GET/POST /volunteers/opportunities`, `POST /volunteers/opportunities/[id]/slots`, `POST /volunteers/slots/[id]/claim`, `POST /volunteers/slots/[id]/cancel`, `POST /volunteers/signups/[id]/complete`, `GET /volunteers/my-commitments` (self-service) |
| Events | `POST /events/[id]/rsvp` (self-service) |
| Minutes | `GET /minutes` (approved only, any enrolled member) |
| Parent self-service | `GET /my-household` |

Every officer route is gated by `requirePtaAccess(<pta:* permission>)`; every self-service route by `requirePtaHouseholdSelfAccess()`.

## Meeting and minutes behavior

PTA meetings are `Meeting` rows — no schema change. Approved minutes are represented as an `Attachment` (`entityType: MEETING`, `purpose: "approved_minutes"`) — the *existing* Attachment model, not a new one. This is **deliberately independent of Meeting Intelligence's `MeetingMinutesDraft`/AI-generation pipeline** — the PTA vertical must never depend on, or implicitly enable, Meeting Intelligence.

The staff-facing Attachment route gates `MEETING` attachments by `meetings:read`, which a plain parent (`MEMBER` role) never holds. `src/lib/labs/pta/minutes.ts`'s `listApprovedPtaMinutes()` is a separate, parent-accessible read path (`GET /api/labs/pta/minutes`, gated only by Labs enrollment + an active session) that returns **only** attachments explicitly marked `purpose: "approved_minutes"` — a draft, or any other attachment on the same meeting, is never returned by this function.

## Data minimization and privacy limitations

See "Data minimization — PtaStudent" above for the explicit non-collection list. Additional safeguards:

- Every query is tenant-scoped by an explicit `organizationId` parameter; no route accepts a client-supplied `organizationId`.
- No route accepts a client-supplied household id, adult id, or organization id for a self-service action — all resolved server-side from the session.
- Audit metadata for student/household actions never includes the student's or household's name — only stable ids and counts (verified by test).
- No bulk public student directory, no public classroom roster, and no page here is indexed by search engines (standard Next.js app-router pages, no special public route added).
- Deletion: `deactivatePtaHousehold()` (soft) is always safe; `deletePtaHousehold()` (hard) is refused once any `DuesCharge` exists for the household, preserving financial history (verified by test). `deactivatePtaStudent()` sets `INACTIVE`, never deletes.
- Export: no dedicated bulk-export endpoint was built in this MVP — existing platform-wide export mechanisms (Reports) were not extended to PTA data. Documented as a known gap.

**No compliance claim is made anywhere in this feature** — not FERPA, not COPPA, not PCI, not HIPAA, not any state law. Unresolved compliance questions a real pilot would need to answer before handling actual student/family data: whether a real school's data-sharing agreement requires FERPA-level controls this MVP doesn't implement (e.g., audit logging of *who viewed* a student record, not just who changed it); whether background-check *verification* (not just a status label) needs a real integration; and whether a real PTA's insurance/legal counsel requires additional consent language beyond what's shown here.

## Setup (local/test only)

1. `npx prisma migrate dev` (or `deploy`) against a local/test database.
2. `npm run db:seed:pta-demo` — seeds the fictional Pine Grove School PTA org (see below).
3. Log in as one of the seeded officer accounts (see below) to explore `/labs/pta/settings`, `/labs/pta/dashboard`, `/labs/pta/households`, `/labs/pta/volunteers`.
4. Log in as the seeded parent account to explore `/labs/pta/my-household` and `/labs/pta/volunteers`.

## Fictional test organization

**Pine Grove School PTA** (`prisma/seed-pta-demo.ts`, `npm run db:seed:pta-demo`) — entirely fictional, idempotent (safe to re-run), never touches any other organization's data, never run against production. Includes:

- 5 officer accounts (President/`ORG_OWNER`, VP/`ORG_ADMIN`, Treasurer/`FINANCE`, Secretary/`STAFF`, General Member/`READ_ONLY`) — all with password `PtaDemo!Change1` (change before any shared use).
- 5 fictional households (7 adults, 6 students across 3 grades/classrooms), with dues alternating paid/unpaid.
- 3 committees (Membership, Fundraising, Family Engagement), each with a chair.
- 2 events (Scholastic Book Fair, Family Movie Night) with RSVPs.
- 1 volunteer opportunity with 2 slots (one already claimed, demonstrating both open and filled states).
- 1 fundraising campaign (Fall Fun Run) with one recorded contribution.
- 1 announcement.
- 1 approved sample-minutes document (September PTA General Meeting).

No real child, family, school, address, or payment information is used anywhere in this seed.

## Smoke-test procedure and results

**Methodology**: rather than a literal browser click-through (which would require constructing real NextAuth sessions for 3 personas), the hardening-review smoke test exercised every real lib function directly against a real disposable Postgres instance — seed the fictional org, then run 28 assertions covering enrollment, the full household lifecycle, parent self-access (including adversarial cases), RSVP, volunteer claim/cancel/cross-org denial, rollover, and communications-targeting cross-tenant safety. **Result: 28/28 passing** after the two critical fixes (before the fixes, 5 of 28 failed or confirmed a real gap — see "Hardening-review findings").

Manual procedure for a human (or future browser-automation pass) to reproduce the UI-level experience:

1. Run `npm run db:seed:pta-demo` against a local database.
2. Confirm `ptaVertical` shows `ENABLED` for Pine Grove School PTA on `/admin/platform/labs`, and confirm `meetingIntelligence` shows no enrollment row at all for that organization (PTA enrollment never implies it — verified by test).
3. Log in as `president@pinegrovepta.example` — confirm `/labs/pta/dashboard` shows non-zero membership/volunteer/fundraising metrics and no student name anywhere on the page.
4. Confirm `/labs/pta/households` lists all 5 fictional households with adult/student counts, no other organization's data.
5. Use the new API routes (`POST /api/labs/pta/households/[id]/adults`, `.../students`, `/api/labs/pta/committees`, `/api/labs/pta/grades`, `/api/labs/pta/households/[id]/dues`, etc.) to confirm an officer can actually build out a household/committee/academic structure/dues charge through the app, not just via direct database access.
6. Log in as `member@pinegrovepta.example` (the seeded parent) — confirm `/labs/pta/my-household` shows only the Patel household, and confirm attempting to view another household id via a direct API call (`/api/labs/pta/households/<other-id>`) is denied.
7. Claim and then cancel a volunteer slot as the parent account at `/labs/pta/volunteers`; confirm `GET /api/labs/pta/volunteers/my-commitments` reflects it.
8. Confirm `GET /api/labs/pta/minutes` returns the one seeded approved-minutes attachment, and never a draft.
9. Disable `ptaVertical` for Pine Grove on `/admin/platform/labs` and confirm every PTA page/route now denies access immediately; re-enable it and confirm all data (households, dues history, committees) is intact, unchanged.
10. Confirm no production organization was touched at any point (the disposable database used for this entire smoke test is never the production database).

## School-year rollover

Create a new `PtaClassroom` row per grade for the new `schoolYear`, then call `enrollPtaStudent()` for each returning student with the new classroom id — this creates a **new** `PtaStudentEnrollment` row (unique on `studentId` + `schoolYear`), leaving every prior year's enrollment row untouched. `PtaHousehold.schoolYear` and dues periods are similarly re-created per year (a new `PtaHousehold` row per (org, displayName, schoolYear), and a new `DuesCharge` per (org, member, account, period)) rather than mutated in place, so historical membership/dues records are never overwritten. There is no automated rollover job in this MVP — an officer (or a future automation) performs it explicitly.

## Dues workflow

1. Officer configures `PtaProfile.defaultDuesAmountCents` and `currentSchoolYear` at `/labs/pta/settings`.
2. Officer creates a household (`POST /api/labs/pta/households`) — this automatically creates the household's billing-identity `OrgMember` — then adds adults (`POST .../adults`) and students (`POST .../students`).
3. Officer creates a dues charge for the household/school-year (`POST /api/labs/pta/households/[id]/dues`) — one household at a time; a bulk-charge helper is not built in this MVP (see "Known limitations").
4. Household pays via an existing `PaymentLink` (type `DUES`) or submits a `PaymentReport`, or an officer records a manual payment (`POST .../dues/[chargeId]/payments`), or waives it (`POST .../dues/[chargeId]/waive`).
5. Dashboard reflects paid/unpaid counts in real time (`getPtaDashboardMetrics()`).
6. There is still no parent-facing "view my balance / pay now" page — a parent's only way to see their own status today is asking an officer, or (for those with portal access) the generic `/payments`/`/payment-history` surfaces. This is the single highest-value next feature (see "Recommended next steps").

## Volunteer workflow

Officer creates an opportunity (`POST /api/labs/pta/volunteers/opportunities`) and one or more slots (`POST .../opportunities/[id]/slots`). Parents browse open opportunities at `/labs/pta/volunteers` and claim a slot for themselves (their own linked household-adult record only) — claim and cancellation are both atomic/transactional and race-safe (see "Volunteer overbooking prevention"). A parent can cancel their own signup, releasing the seat, and can see all their own commitments (`GET /api/labs/pta/volunteers/my-commitments`). An officer marks a signup `COMPLETED` with optional hours logged (`POST /api/labs/pta/volunteers/signups/[id]/complete`) — this is officer-only; a parent cannot mark their own hours (matches the task's explicit requirement that volunteer-hour recording can't be altered by unauthorized parents).

## Communications workflow

Officer (or future dedicated PTA-communications UI — not built in this MVP) calls `resolvePtaTargetMemberIds()` with a targeting rule, then creates a `CommunicationCampaign` with `recipientFilter: { selector: "manual", memberIds: [...] }` via the existing communications API — no PTA-specific send logic.

## Tests

11 test files: `guard.test.ts`, `households.test.ts`, `volunteers.test.ts`, `academic.test.ts`, `committees-events.test.ts`, `communications.test.ts`, `dues.test.ts`, `minutes.test.ts` (unit, mocked Prisma — 47 tests total after the hardening pass), plus two real-database integration tests, skipped by default in a normal `vitest run` (require `DATABASE_URL` pointed at a disposable Postgres and `PTA_RUN_DB_INTEGRATION_TEST=1`): `volunteers-concurrency.integration.test.ts` (real concurrent claims) and `household-adult-constraint.integration.test.ts` (the multi-org-uniqueness regression — see "Hardening-review findings"). One pre-existing test (`src/lib/labs/__tests__/access.test.ts`) was updated because `ptaVertical` being the first non-`internalOnly` Labs feature made its old assumption ("every feature today is internal-only") factually outdated.

## Deletion and export

See "Data minimization and privacy limitations" above. No dedicated bulk data-export endpoint exists yet for PTA data in this MVP.

## Known limitations

- **No parent-facing dues-payment page** — dues functions have real API routes as of the hardening pass, but they're officer-facing (`pta:dues:manage`); `/labs/pta/my-household` does not render a "pay now" button or balance for the parent themselves. This is the recommended next PR (see below).
- **No event-level QR check-in** — `MeetingAttendanceSession`/QR check-in is hardwired to `Meeting`, not `Event`. PTA events reuse `Event` (not `Meeting`), so QR check-in for a PTA event (e.g. a book fair) is not available in this MVP. A future PR could either model select PTA events as `Meeting` rows or make the QR session model polymorphic.
- **No capacity field on `Event`/`PtaEventRsvp`** — confirmed during the hardening review; "optional capacity" from the original task spec was never implemented for events (volunteer *slots* do have real capacity enforcement — a different model).
- **No household merge/split, no automatic membership-model conversion** — confirmed unsupported, and deliberately so (see "Household lifecycle"); enforced at the database level via `PtaHousehold.orgMemberId`'s unique constraint, not just by omission.
- **Hard household delete has no HTTP route** — only soft-deactivate is reachable via the API; this is an intentional safety choice, not an oversight.
- **No mobile app surface** — the mobile app (`civicflow-mobile/`) has no Labs-enrollment concept at all today (confirmed: zero references to `OrganizationLabFeature` anywhere in that codebase). Building PTA-for-mobile would require new mobile-side Labs plumbing from scratch, out of scope for this MVP.
- **No teacher accounts** — `PtaTeacher` carries no `userId` at all; teachers are classroom-association records only, never authenticated, per the task's explicit scope.
- **No deep committee-to-document/event linkage** — committees have a roster and a chair, but committee-scoped documents/events beyond communications targeting are not built (an officer manages documents/events generically today).
- **No dedicated bulk dues-charge or bulk data-export tooling** — charges are created one household at a time via a real API route now; a bulk "charge every active household for the new school year" helper is not built.
- **No automated school-year rollover job** — rollover is a manual, per-student/per-household action (see "School-year rollover"), though it is idempotent and confirmed to leave prior-year history untouched.
- **RSVP and attendance remain two parallel, never-reconciled signals** for the same event — if an officer separately uses the generic attendance-tracking feature on a PTA event, nothing cross-checks "N households RSVP'd GOING" against actual `AttendanceRecord` check-ins.

## Pilot success criteria

- [x] One fictional PTA configured end-to-end (Pine Grove School PTA — done via seed).
- [x] At least 5 fictional households (done — 5 seeded).
- [x] Household and student isolation tests pass (done — see "Tests"; re-verified independently during the hardening review).
- [x] Membership dues workflow completes (charge → payment → PAID status) for at least one household (done — 3 of 5 seeded households are PAID; also independently re-verified with a partial-payment-then-waiver scenario during the hardening review).
- [x] At least two events created (done — Book Fair, Family Movie Night).
- [x] Volunteer slots can be claimed without overbooking under real concurrency (done — `volunteers-concurrency.integration.test.ts`, 10 concurrent claims vs. capacity 3, exactly 3 succeed; re-verified after the transaction-safety fix found during hardening).
- [x] Targeted announcements work (done at the resolver level — `communications.test.ts`, including a cross-tenant-safety re-check during hardening; full send-pipeline integration not separately re-tested since `resolveCommunicationRecipients()` itself is unmodified and already tested elsewhere).
- [x] Approved minutes are visible to a member without exposing drafts (done — `minutes.test.ts`).
- [x] Parent multi-organization switching works without cross-tenant leakage (done, and this is exactly where the hardening review found the critical `PtaHouseholdAdult.userId` global-uniqueness bug — now fixed and covered by a permanent real-database regression test).
- [x] No production organization enrolled (true — the only enrollment anywhere in this PR's diff or its review process is the local disposable-database seed).
- [x] No cross-tenant findings remain unresolved (one was found — the multi-org unique-constraint bug — and fixed; re-verified with a real-database test).
- [x] No real student data used anywhere (true — seed data is entirely fictional; re-confirmed during the hardening review's privacy audit).

## Recommended next steps

1. ~~**Parent Membership and Dues Self-Service**~~ — **done, in a separate PR** (`agent/pta-parent-dues-self-service`, depends on this PR) — see `docs/pta-parent-dues-self-service.md` for the parent-facing `/labs/pta/membership` page and its documented design decisions.
2. Decide whether event-level QR check-in is worth the `MeetingAttendanceSession` schema change, based on real pilot feedback about whether officers actually want it.
3. Consider whether an event-level capacity field is worth adding, based on real pilot feedback (confirmed absent during hardening review — see "Known limitations").
4. Consider a bulk dues-charge/rollover helper once a real pilot has run one full school year.
5. Do not expand to mobile, real customer enrollment, or billing changes until portal-side usage validates the concept.

## Pilot-readiness conclusion

**Safe for a fictional-data-only Labs demonstration**: yes. Tenant isolation, Labs gating, parent self-access authorization, and volunteer-claim concurrency are all independently re-verified against a real database, not just asserted. Two critical defects were found and fixed during this hardening pass specifically because real (not mocked) testing was used — this is itself evidence the review process is working, not evidence the feature is fragile.

**Not yet ready for a real-family pilot.** Beyond the explicit "no compliance claim" caveat (see "Data minimization and privacy limitations"), the biggest practical gap is that a parent has no dues-payment surface of their own — a real pilot would need at least a read-only balance view before asking real families to participate meaningfully. The event-capacity gap and the RSVP/attendance non-reconciliation would also need a product decision (not just an engineering one) before a real pilot depends on them.
