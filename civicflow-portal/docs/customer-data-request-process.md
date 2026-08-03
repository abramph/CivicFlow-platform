# Customer Data Request Process (Export / Deletion)

How to handle a real request from an organization or an individual member for their data (a
"subject access request" or "right to be forgotten" style request), using the tools that actually
exist today. This is a process document, not a legal opinion — if a request raises a real
GDPR/CCPA compliance question, that's a decision for the business, not something to resolve
unilaterally from this doc.

## Before doing anything: confirm identity and authority

Confirm the request is actually coming from someone entitled to make it — either the organization's
own admin (for an org-wide request) or, for an individual member's request routed through the
organization, confirm the organization itself is relaying a legitimate request from that member.
Never act on a data request that arrives with no way to verify who's asking.

## Data export

### Organization-level export

The existing member export already covers the bulk of an organization's own member data:

- `GET /api/members/export` (`src/app/api/members/export/route.ts`) — CSV or XLSX, every member
  field, formula-injection-safe (`src/lib/csv-safety.ts`).
- `/api/reports/export` (`src/lib/reports/exporters.ts`) covers financial reports (dues,
  contributions) in the same safe format.

These are self-serve for an organization's own admins already — for most "we want a copy of our
data" requests, direct them to use these existing export features themselves rather than doing it
for them, since that keeps the audit trail (and the responsibility for who has the export) with the
organization's own admin.

### A specific individual's data, across every table

There is no single "export everything about this one person" button today. If a request needs
that:
1. Identify the person's `OrgMember.id` (and `User.id` if they have portal/mobile login access —
   these are separate records; see `docs/platform-identity-architecture.md`).
2. Pull their row from every table that references that id: `OrgMember`, `Contribution`,
   `DuesCharge`/`DuesPayment`, `Attachment` (uploaded documents), `CommunicationLog`,
   `EventAttendance`, and any vertical-specific tables (`PtaHouseholdAdult`, `PropertyResident`,
   etc.) depending on the organization's vertical — check `prisma/schema.prisma` for the full set of
   models with a `memberId`/`orgMemberId` foreign key before considering an export complete.
3. This is a manual, one-off query today, not a built feature. Treat it as a data task, not a
   support task — verify results carefully rather than delegating a from-memory list of tables.

## Data deletion

`DELETE /api/members/[id]` (`src/app/api/members/[id]/route.ts`) performs a real, hard
`prisma.orgMember.delete` — this is genuinely destructive and not soft-delete/recoverable through
the app itself (only through a database restore — see
`docs/backup-and-disaster-recovery.md` — which would also restore everything else to that point in
time, not just the one deleted member).

Before deleting for a "forget me" request:
1. **Confirm what cascades and what doesn't.** Check `prisma/schema.prisma` for the actual
   `onDelete` behavior on every relation referencing `OrgMember` at the time of the request — some
   related records may cascade-delete, others may be retained with the member reference nulled out
   (e.g. financial records an organization may have its own legal obligation to retain, like
   `Contribution`/`DuesPayment` history for accounting purposes). Do not assume; verify against the
   live schema, since this is exactly the kind of detail that changes as new features are added.
2. **Flag the tension to the organization if retained financial records exist.** A member may have
   a right to deletion of their personal data while the organization simultaneously has a legal
   obligation to retain financial/tax records referencing them. This is a real conflict to surface
   to the organization's own admin, not something to silently resolve one way.
3. **Perform the deletion through the existing authenticated route** (as the organization's own
   admin, or via impersonation with a recorded reason — see `docs/customer-support-runbook.md`) so
   it's captured in that organization's own audit log, not via a raw database delete that leaves no
   trace of why.
4. Confirm afterward: re-query for the member's id across the same table list used for exports, to
   verify the deletion actually reached everywhere it needed to.

## What this process deliberately does not cover

- A formal, legally-reviewed data retention policy — this document describes the mechanics of
  fulfilling a request with today's tools, not a compliance policy. A recurring pattern of these
  requests, or one with real legal stakes, should prompt an actual legal/compliance review rather
  than treating this runbook as sufficient on its own.
- Automated/self-serve deletion requests — none exist yet; every deletion request today is a manual
  process following the steps above.
