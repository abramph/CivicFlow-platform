# Member Lifecycle & Termination Workflow

Part A of the 2026-08-04 Member Administration, Rosters, Termination Workflow, and UI
Modernization program. Design decisions only — implementation follows this document.

## What audit found (see PR description for full citations)

- **`OrgMember.membershipStatus`** (`prisma/schema.prisma`) is the sole authoritative
  lifecycle field: `active | inactive | deactivated | pending | retired | suspended |
  terminated`. It is completely separate from HOA's `PropertyResident.status`
  (occupancy, not membership) and from `OrganizationMembership.status` (platform login
  access — see below).
- **Delinquency is orthogonal**, not a status: `OrgMember.isDelinquent` is a computed
  boolean (`src/lib/member-delinquency.ts`), independent of `membershipStatus`. A member
  can be `active` and delinquent at the same time.
- **No dedicated termination flow exists today.** The only surface is the generic
  member-edit form (`MemberEditForm.tsx`) with a status `<select>` (including
  `terminated` as one of seven options) and a free-text reason field, validated by
  `PATCH /api/members/[id]`. The reason field genuinely exists and works; the real gap
  is that the route's 400 response omits `details.fieldErrors`, so the form's
  field-level red-border logic never highlights the reason input — only a generic
  banner shows the message. This PR replaces the flow rather than patching that one
  bug, because the deeper problem is architectural: termination via a 7-option status
  dropdown has no room for a suggested-reason list, an effective date, an internal
  note, a confirmation step, an access-removal cascade, or a last-owner safeguard.
- **A history model already exists and is reused, not duplicated**: `MemberTimelineEvent`
  (`schema.prisma`) already has `TERMINATED`/`REACTIVATED`/`STATUS_CHANGED` event types,
  `oldValue`/`newValue` JSON, and `createdByUserId`, and is already written on every
  status change today (`api/members/[id]/route.ts`). No new schema model is introduced.
- **Platform login access is a separate model**: `OrganizationMembership` (join of
  `User` ↔ `Organization` with a `role` and its own `active | suspended` status) is
  keyed by `(organizationId, userId)`, one row per org a user belongs to.
  `OrgMember.userId` optionally links a constituent record to a login. Terminating an
  `OrgMember` today has **zero effect** on that person's login/role — confirmed by
  reading the full PATCH route, which never touches `OrganizationMembership`.
- **No "last owner" guard exists anywhere in the codebase today**, including in the
  existing role-change/removal routes (`api/organization-memberships/[id]/route.ts`).
  This PR adds one, scoped to the new termination cascade only — it does not retrofit
  the pre-existing role-management routes (flagged below as a follow-up candidate,
  same treatment as the `updateViolationDraft` TOCTOU gap flagged in PR #52).
- **Report framework already exists** (`src/lib/reports/report-builder.ts`), including a
  `DELINQUENT_MEMBERS` report type that already queries `isDelinquent: true` — directly
  reusable for the Delinquent roster in PR B.

## Lifecycle rules (decided here, implemented in this PR)

**The 7-value enum is not narrowed.** Collapsing it to 4 values would be a breaking
schema change with no product benefit — `pending`/`retired`/`suspended`/`deactivated`
carry real, distinct meaning today (dues plans, category assignment, and the dashboard
all branch on the specific value). Instead, the four report buckets the program asks
for are a **read-model grouping**, defined once here and reused by both the report
layer (PR B) and any future UI:

| Roster bucket | `membershipStatus` values | `isDelinquent` |
|---|---|---|
| Active | `active` | `false` |
| Delinquent | `active` | `true` |
| Inactive | `inactive`, `deactivated`, `suspended`, `pending`, `retired` | any |
| Terminated | `terminated` | any |

Rationale for the Inactive bucket: all five values mean "not currently a
dues-accountable active constituent, but not permanently separated" — a roster
consumer (board member preparing a mailing list, treasurer reviewing rolls) cares about
that distinction more than the five-way split, which stays visible as a per-row status
column within the report.

**Dedicated actions, not the generic status dropdown.** The generic edit form
(`MemberEditForm.tsx` / `PATCH /api/members/[id]`) no longer allows setting
`membershipStatus` to or from `terminated` — those two transitions must go through the
new dedicated Terminate/Reinstate actions below, which are the only paths that apply
the reason/effective-date validation, the access cascade, and the last-owner guard. All
other status transitions (`active` ↔ `inactive`/`deactivated`/`suspended`/`pending`/
`retired`) are unaffected and continue through the existing generic form.

**Terminate** (`active|inactive|deactivated|pending|retired|suspended` → `terminated`):
- Reason: one of a fixed suggested list, or `"OTHER"` with required free text.
  `["MOVED_RELOCATED", "RESIGNED_VOLUNTARY", "NONPAYMENT_OF_DUES",
  "GOVERNING_DOCUMENT_VIOLATION", "DECEASED", "NO_LONGER_ELIGIBLE", "OTHER"]`
  (vertical-agnostic; a Union non-payment reason and an HOA bylaw-violation reason are
  both realistic across every vertical this platform serves).
- Effective date: required, valid date, bounded to ±5 years of today (guards against a
  fat-fingered year, not a business rule against back/forward-dating — orgs legitimately
  backdate a termination to when someone actually moved out, or forward-date to
  "effective end of month").
- Internal notes: optional, stored in the `MemberTimelineEvent` JSON payload, never in
  a field a resident/member-facing view reads.
- Compare-and-swap on `membershipStatus != "terminated"` (same `updateMany`-with-
  expected-prior-status pattern used throughout Violations/Architectural Requests) —
  concurrent double-termination is a real race (two officers, two tabs) and gets
  `MEMBER_ALREADY_TERMINATED` on the loser.

**Reinstate** (`terminated` → `active`):
- Reason required (free text) and effective date required, same validation shape.
- Compare-and-swap on `membershipStatus == "terminated"` — `MEMBER_NOT_TERMINATED` if lost.
- **Deliberately does not restore platform login access automatically.** Removing
  access is fail-safe (default to less exposure); restoring it is the more sensitive
  direction and is left to an explicit, separate action on the existing Users & Roles
  page. This asymmetry is intentional, not an oversight — noted again below.

## Access-removal cascade

On termination, if `OrgMember.userId` is set and that user holds an `active`
`OrganizationMembership` row for **this same organization**, that row is flipped to
`suspended` in the same transaction as the termination. This reuses the exact semantics
the schema already documents for that field ("suspended behaves like not a member of
this org" — `OrganizationMembershipStatus` doc comment) rather than inventing new
access-control machinery. Because `OrganizationMembership` is keyed by
`(organizationId, userId)`, this is naturally org-scoped: the same person's membership
rows in any other organization are untouched by this write. Historical data
(`AuditEvent`, `MemberTimelineEvent`, dues/contribution records) is never deleted or
modified by termination — only `membershipStatus` and, conditionally, the one
`OrganizationMembership` row change.

**`LAST_OWNER_CANNOT_BE_TERMINATED`**: before terminating, if the linked user's
`OrganizationMembership.role` for this org is `ORG_OWNER` (or `SUPER_ADMIN`) and no
other `active` `OrganizationMembership` row in this org holds `ORG_OWNER`/`SUPER_ADMIN`,
the termination is rejected. Without this guard, terminating an org's sole owner would
strand the organization with no one able to manage users, billing, or settings.

**Known scope limit, confirmed during manual walkthrough**: this guard (and the
access-suspension cascade above) only look at the *specific* `User` linked via
`OrgMember.userId` — the mobile/member-portal login. In the Oak Ridge demo data, the
org's President has two separate accounts: a staff web login holding `ORG_OWNER`, and a
separate mobile-portal login (created via "Invite to Mobile App") holding role `MEMBER`
that her `OrgMember.userId` actually points to. Terminating her `OrgMember` record
correctly suspended the linked `MEMBER`-role mobile login and did **not** trigger
`LAST_OWNER_CANNOT_BE_TERMINATED`, because the specific login tied to that record isn't
the owner login — confirmed working as designed, not a bug, but worth flagging: this
guard cannot protect against terminating a member record whenever a real person's staff
`ORG_OWNER` access happens to live on a different `User` row than their `OrgMember.userId`.
Closing that gap would require reasoning about "is this the same real person across two
User rows," which the schema has no reliable way to answer. The compare-and-swap
correctness itself (exactly-one-winner under real concurrency, and the guard firing when
the linkage does match) is proven by the real-database integration test.

## Permission

New permission `members:terminate`, granted only to `ORG_OWNER`, `SUPER_ADMIN`, and
`ORG_ADMIN` — not `STAFF` or `FINANCE`. `STAFF` currently holds `members:write` and can
today set `membershipStatus` to `terminated` via the generic form; after this PR that
specific transition requires `members:terminate`, a narrower grant. This is a
deliberate tightening: termination now cascades into login-access removal, which is a
materially larger blast radius than an ordinary field edit, and the org-tier separation
mirrors the existing `write`/`decide` pattern already used for HOA Violations and
Architectural Requests. `members:write` continues to cover every other field edit,
including all non-terminated status transitions.

## Error codes

`MEMBER_ALREADY_TERMINATED`, `TERMINATION_REASON_REQUIRED`, `INVALID_EFFECTIVE_DATE`,
`INSUFFICIENT_PERMISSION`, `MEMBER_NOT_FOUND`, `LAST_OWNER_CANNOT_BE_TERMINATED` (all
required by the program spec), plus `MEMBER_NOT_TERMINATED` (reinstate's
compare-and-swap-loss counterpart to `MEMBER_ALREADY_TERMINATED`) and
`REINSTATEMENT_REASON_REQUIRED`. Fixed HTTP status per code, mirrored in
`src/lib/member-lifecycle-errors.ts` after the existing `src/lib/hoa/errors.ts` pattern.

## Deliberately not built

A configurable/admin-editable reason list (fixed list ships instead — no product ask
for org-level customization here); automatic reinstatement of login access (see above);
retrofitting the last-owner guard onto the pre-existing role-management routes
(`api/organization-memberships/[id]/route.ts`), which have the same unprotected gap but
are out of this PR's scope — flagged as a follow-up candidate.
