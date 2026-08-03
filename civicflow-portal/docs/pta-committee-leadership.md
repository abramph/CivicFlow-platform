# PTA Committee Chairs, Co-Chairs, and Officer Access (PR #46)

## The core rule

**Committee position and application access are separate.** Marking someone chair or co-chair of a committee is a directory fact (`PtaCommittee.chairAdultId` / `coChairAdultId`, both pointing at `PtaHouseholdAdult` — a household-level parent record). It grants **zero** real permission by itself.

This is architectural, not a policy choice that could be toggled: `PtaHouseholdAdult` has no relation whatsoever to `OrganizationMembership`/`OrgRole` (the model that actually grants any permission — see `src/lib/rbac.ts`). A household adult can exist, and be chair of a committee, with no `OrganizationMembership` in the organization at all.

## How a chair/co-chair actually gets access

`STAFF` already holds `events:write` + `pta:events:manage` + `pta:volunteers:manage`. So rather than building a new committee-scoped permission mechanism, a chair or co-chair gets real access the same way any other officer does: an org owner/admin invites them as an officer through the existing Users & Roles flow (`/settings/users`, `POST /api/organization-memberships`).

The committee detail page (`/labs/pta/committees/[committeeId]`) makes this fast: next to the chair/co-chair display, an "Invite \<name\> as a STAFF officer →" link (visible only to someone who already holds `users:manage`, and only when the person has an email on file) opens `/settings/users` with the name/email pre-filled and the role defaulted to STAFF. This is a UI convenience only — it does not call any invite API itself, does not create a `User` or `OrganizationMembership`, and grants nothing. The org owner/admin still has to review and explicitly submit the form.

This system's officer invite is **synchronous account creation**, not an async token/pending-invite flow — there's no "pending," "expired," or "declined" invitation state to manage. `POST /api/organization-memberships` finds-or-creates a `User` by email and creates an `OrganizationMembership` with the chosen role directly, subject to:
- the actor cannot invite someone with a role higher than their own (`roleRank` check),
- a seat-slot limit,
- "that user already has access to this organization" if a membership already exists.

## Removal and revocation are independent

- Removing a chair/co-chair (`setPtaCommitteeChair`/`setPtaCommitteeCoChair` with `null`) only clears the committee field. It never touches `OrganizationMembership`.
- Revoking an officer's STAFF access (`DELETE /api/organization-memberships/[id]`) has zero relation to `PtaCommittee` — there is no foreign key between the two tables. Removing someone's officer access does not erase their committee history (the committee, the chair/co-chair record, and the underlying `PtaHouseholdAdult` all survive).
- The committee detail page states this explicitly: *"A chair or co-chair only gains real event/volunteer-opportunity access once invited as an officer below — being marked chair here is a directory role, not a permission grant."*

Verified live via a real-database walkthrough (disposable Postgres): assign chair → assign co-chair → confirm neither has an `OrganizationMembership` → invite chair as STAFF → confirm STAFF role → remove chair position → confirm STAFF membership survives → revoke STAFF → confirm committee history survives.

## Schema

`PtaCommittee.coChairAdultId` (new in PR #46) mirrors the pre-existing `chairAdultId` exactly — two independent nullable fields, not a list. A committee can have a co-chair with no chair set, or vice versa. Both FKs are `onDelete: SetNull`; tenant scoping is enforced at the application layer (`setPtaCommitteeChair`/`setPtaCommitteeCoChair` both verify the adult belongs to the calling organization) rather than the FK itself, matching the pre-existing `chairAdultId` pattern.

## Known, deliberately unaddressed: same person as both chair and co-chair

`setPtaCommitteeChair` and `setPtaCommitteeCoChair` never check each other's current value — the same household adult can be set as both chair and co-chair of the same committee. This was found and confirmed during review, and is documented by a test rather than silently left as an untested gap. It's a product-policy question, not a security one (no cross-tenant or permission implication), so it wasn't blocked. If this should be disallowed, add a cross-check in whichever of the two functions runs second.

## Audit logging

Chair-assigned and chair-removed share one audit action (`pta.committee.chair_set`), distinguished only by whether `chairAdultId` in the metadata is a real id or `null`. This is the pre-existing convention (unchanged for chair, mirrored for co-chair) — not a new gap introduced by this PR, but worth knowing if you're searching audit logs by action name rather than inspecting metadata.
