# Unestra for PTA — Labs MVP

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

## New PTA-specific models (additive migration `20260722213428_add_pta_labs_mvp`)

`PtaProfile`, `PtaHousehold`, `PtaHouseholdAdult`, `PtaStudent`, `PtaGrade`, `PtaTeacher`, `PtaClassroom`, `PtaStudentEnrollment`, `PtaVolunteerOpportunity`, `PtaVolunteerSlot`, `PtaVolunteerSignup`, `PtaCommittee`, `PtaCommitteeMember`, `PtaEventRsvp` — 14 tables, 9 enums. Every model carries `organizationId` directly.

**Why this many, given the reuse table above**: none of Unestra's existing models have any household/family grouping (`OrgMember.householdName` is free text only, no relation), no grade/classroom/teacher concept, no event RSVP/capacity concept, and no volunteer-slot concept. These are the genuinely missing pieces; everything else (dues, fundraising, communications, meetings, documents) is reused unchanged.

### The household's "billing identity"

`PtaHousehold.orgMemberId` is a normal `OrgMember` row, created automatically when a household is created (`createPtaHousehold()`). This is what makes dues, `PaymentLink`, `PaymentReport`, and the whole existing financial pipeline work for a household with **zero new payment code** — a household's dues charge is just a `DuesCharge` scoped to this `OrgMember`, exactly like any other member's dues. The FK (`PtaHousehold.orgMemberId → OrgMember`) is `onDelete: SetNull`, so deleting/deactivating a household never deletes its `OrgMember` or dues history.

### Data minimization — `PtaStudent`

Deliberately minimal: `displayName`, `status` (ACTIVE/INACTIVE) only. Grade/classroom association is a *separate*, year-scoped row (`PtaStudentEnrollment`), never stored directly on the student, so a school-year rollover never overwrites history — it only adds a new row.

**Never collected, anywhere in this schema:** date of birth, medical/disability information, academic grades, discipline records, student ID numbers, custody information, emergency contacts, transportation data, or any other protected education record. This is not a student information system and makes no FERPA/COPPA/compliance claim (see "Privacy limitations" below).

### Volunteer overbooking prevention

`PtaVolunteerSlot.claimedCount` is only ever changed via an atomic conditional `UPDATE ... WHERE claimedCount < capacity` (`claimPtaVolunteerSlot()`) — the same pattern Meeting Intelligence's worker uses for its job-claim mechanism. **Proven, not just claimed**: `volunteers-concurrency.integration.test.ts` fires 10 real concurrent claims (via `Promise.allSettled`, against a real disposable Postgres instance, not mocked) at a slot with capacity 3 and asserts exactly 3 succeed — see "Tests" below.

## Permissions (RBAC)

Thirteen new granular permissions in `src/lib/rbac.ts`, namespaced `pta:*`: `directory:read`, `households:manage`, `students:manage`, `dues:manage`, `events:manage`, `volunteers:manage`, `committees:manage`, `fundraising:manage`, `announcements:publish`, `documents:manage`, `minutes:review`, `minutes:approve`, `analytics:read`.

**Officer titles (President, Treasurer, Secretary, Membership Chair, Volunteer Coordinator, Committee Chair, General Member) are not new `Role` enum values** — they map onto the existing `ORG_OWNER`/`ORG_ADMIN`/`FINANCE`/`STAFF`/`READ_ONLY` roles' default `pta:*` bundles (President/VP → full bundle; Treasurer → dues/fundraising/analytics-shaped `FINANCE` bundle; Secretary/Membership Chair/Volunteer Coordinator → operational `STAFF` bundle; General Member → read-only directory/analytics). An organization can further customize any of these four via the existing `OrgRolePermissionSet` override system — no new authorization mechanism was built. No officer role grants unrestricted platform administration; `PlatformAccess`/`SUPER_ADMIN` is untouched.

**Parent self-service is deliberately NOT a permission.** `MEMBER` role holds zero permissions by design (an existing, documented invariant this PR does not touch). A parent's access to their own household, dues, RSVPs, and volunteer signups goes through `requirePtaHouseholdSelfAccess()` (`src/lib/labs/pta/guard.ts`), which resolves the caller's household strictly from their own linked `PtaHouseholdAdult.userId` — never from a client-supplied household id, and never via `canDo()`/`requirePermission()`.

## Household and student authorization design

- Every PTA lib function takes `organizationId` as an explicit required parameter and scopes every Prisma query by it (mirrors `meeting-intelligence/jobs.ts`'s convention) — verified by dedicated cross-tenant tests for households, students, classrooms, volunteer slots, committees, and event RSVPs.
- A household adult never sees another household's data — the self-service guard resolves exactly one household per caller, and no route accepts a client-supplied household id for a self-service action (claim/cancel/RSVP all resolve the actor's own household/adult id server-side).
- An officer's `pta:*` permissions are checked via the standard organization-scoped `requirePermission()` — they operate only within the officer's active organization, exactly like every other permission in this codebase.
- Multi-organization: a parent belonging to two PTA organizations uses the existing `OrganizationMembership`/active-org-switching system unchanged — `requirePtaHouseholdSelfAccess()` always resolves the household for the *currently active* organization only, so switching orgs correctly changes which household (if any) is visible, with no leakage between them.

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

`/labs/pta/my-household` (view household/students, self-service only), `/labs/pta/volunteers` (browse + claim/cancel), and `GET /api/labs/pta/minutes` (approved minutes only — see below). Dues payment, contact updates, and committee-membership views are supported at the lib/API layer (`dues.ts`, `households.ts`, `committees.ts`) but do not yet have a dedicated parent-facing page in this MVP — see "Known limitations."

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

## Smoke-test procedure

1. Run `npm run db:seed:pta-demo` against a local database.
2. Confirm `ptaVertical` shows `ENABLED` for Pine Grove School PTA on `/admin/platform/labs`.
3. Log in as `president@pinegrovepta.example` — confirm `/labs/pta/dashboard` shows non-zero membership/volunteer/fundraising metrics and no student name anywhere on the page.
4. Confirm `/labs/pta/households` lists all 5 fictional households with adult/student counts, no other organization's data.
5. Log in as `member@pinegrovepta.example` (the seeded parent) — confirm `/labs/pta/my-household` shows only the Patel household, and confirm attempting to view another household id via a direct API call (`/api/labs/pta/households/<other-id>`) is denied (403/404, not the officer directory route since parents aren't gated by `pta:directory:read`).
6. Claim and then cancel a volunteer slot as the parent account at `/labs/pta/volunteers`.
7. Confirm `GET /api/labs/pta/minutes` returns the one seeded approved-minutes attachment.
8. Disable `ptaVertical` for Pine Grove on `/admin/platform/labs` and confirm every PTA page/route now denies access immediately.

## School-year rollover

Create a new `PtaClassroom` row per grade for the new `schoolYear`, then call `enrollPtaStudent()` for each returning student with the new classroom id — this creates a **new** `PtaStudentEnrollment` row (unique on `studentId` + `schoolYear`), leaving every prior year's enrollment row untouched. `PtaHousehold.schoolYear` and dues periods are similarly re-created per year (a new `PtaHousehold` row per (org, displayName, schoolYear), and a new `DuesCharge` per (org, member, account, period)) rather than mutated in place, so historical membership/dues records are never overwritten. There is no automated rollover job in this MVP — an officer (or a future automation) performs it explicitly.

## Dues workflow

1. Officer configures `PtaProfile.defaultDuesAmountCents` and `currentSchoolYear` at `/labs/pta/settings`.
2. Officer creates a household (`POST /api/labs/pta/households`) — this automatically creates the household's billing-identity `OrgMember`.
3. Officer creates a dues charge for the household/school-year (`createPtaDuesCharge()`), or a future bulk-charge helper (not built in this MVP — see "Known limitations").
4. Household pays via an existing `PaymentLink` (type `DUES`) or submits a `PaymentReport`, or an officer records a manual payment (`recordManualPtaDuesPayment()`), or waives it (`waivePtaDuesCharge()`).
5. Dashboard reflects paid/unpaid counts in real time (`getPtaDashboardMetrics()`).

## Volunteer workflow

Officer creates an opportunity + one or more slots (`POST /api/labs/pta/volunteers/opportunities`, `addPtaVolunteerSlot()`). Parents browse open opportunities at `/labs/pta/volunteers` and claim a slot for themselves (their own linked household-adult record only) — claim is atomic and race-safe (see above). A parent can cancel their own signup, releasing the seat. An officer marks a signup `COMPLETED` with optional hours logged (`completePtaVolunteerSignup()`).

## Communications workflow

Officer (or future dedicated PTA-communications UI — not built in this MVP) calls `resolvePtaTargetMemberIds()` with a targeting rule, then creates a `CommunicationCampaign` with `recipientFilter: { selector: "manual", memberIds: [...] }` via the existing communications API — no PTA-specific send logic.

## Deletion and export

See "Data minimization and privacy limitations" above. No dedicated bulk data-export endpoint exists yet for PTA data in this MVP.

## Known limitations

- **No parent-facing dues-payment page** — `dues.ts`'s functions exist and are tested, but `/labs/pta/my-household` does not yet render a "pay now" button; a parent currently pays via the existing generic `PaymentLink`/`PaymentReport` flows, not a PTA-branded page.
- **No event-level QR check-in** — `MeetingAttendanceSession`/QR check-in is hardwired to `Meeting`, not `Event`. PTA events reuse `Event` (not `Meeting`), so QR check-in for a PTA event (e.g. a book fair) is not available in this MVP. A future PR could either model select PTA events as `Meeting` rows or make the QR session model polymorphic.
- **No mobile app surface** — the mobile app (`civicflow-mobile/`) has no Labs-enrollment concept at all today (confirmed: zero references to `OrganizationLabFeature` anywhere in that codebase). Building PTA-for-mobile would require new mobile-side Labs plumbing from scratch, out of scope for this MVP.
- **No teacher accounts** — `PtaTeacher` carries no `userId` at all; teachers are classroom-association records only, never authenticated, per the task's explicit scope.
- **No deep committee-to-document/event linkage** — committees have a roster and a chair, but committee-scoped documents/events beyond communications targeting are not built (an officer manages documents/events generically today).
- **No dedicated bulk dues-charge or bulk data-export tooling** — charges are created one household at a time via the lib function; a bulk "charge every active household for the new school year" helper is not built.
- **No automated school-year rollover job** — rollover is a manual, per-student/per-household action (see above).

## Pilot success criteria

- [ ] One fictional PTA configured end-to-end (Pine Grove School PTA — done via seed).
- [ ] At least 5 fictional households (done — 5 seeded).
- [ ] Household and student isolation tests pass (done — see "Tests").
- [ ] Membership dues workflow completes (charge → payment → PAID status) for at least one household (done — 3 of 5 seeded households are PAID).
- [ ] At least two events created (done — Book Fair, Family Movie Night).
- [ ] Volunteer slots can be claimed without overbooking under real concurrency (done — `volunteers-concurrency.integration.test.ts`, 10 concurrent claims vs. capacity 3, exactly 3 succeed).
- [ ] Targeted announcements work (done at the resolver level — `communications.test.ts`; full send-pipeline integration not separately re-tested since `resolveCommunicationRecipients()` itself is unmodified and already tested elsewhere).
- [ ] Approved minutes are visible to a member without exposing drafts (done — `minutes.test.ts`).
- [ ] Parent multi-organization switching works without cross-tenant leakage (done — `requirePtaHouseholdSelfAccess()` re-resolves per active organization every call; no separate multi-org PTA test was added beyond the existing platform-wide multi-org test suite, since PTA adds no new organization-switching logic of its own).
- [ ] No production organization enrolled (true — the only enrollment in this PR's diff is the local seed script).
- [ ] No cross-tenant findings (true — see "Tenant-isolation findings" in the PR description).
- [ ] No real student data used anywhere (true — seed data is entirely fictional).

## Recommended next steps

1. Run the smoke test above locally to confirm the pilot actually behaves as documented.
2. If proceeding: build the parent-facing dues-payment page (highest-value gap).
3. Decide whether event-level QR check-in is worth the `MeetingAttendanceSession` schema change, based on real pilot feedback about whether officers actually want it.
4. Consider a bulk dues-charge/rollover helper once a real pilot has run one full school year.
5. Do not expand to mobile, real customer enrollment, or billing changes until portal-side usage validates the concept.
