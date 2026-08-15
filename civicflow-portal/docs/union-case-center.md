# Union Case Center — Grievance & Representation Case Management

The last major pre-launch Union feature program (per the 2026-08-15 program spec): a focused
case-management workflow for union orgs (members, stewards, representatives, authorized officers).
**This is deliberately not a full legal case-management platform and does not duplicate
UnionFlow** — Unestra Union stays thin and reuses existing Unestra infrastructure wherever
possible (see "Reused infrastructure" below). `UNION-CASE-A` (this PR) ships the foundation:
schema, RBAC, the status state machine, member intake, and basic staff read. `UNION-CASE-B`
through `E` (steward dashboard/assignment, timeline/notes/contract references, deadlines/
reminders, member mobile experience) are separate, sequential PRs — each merged, deployed, and
production-smoke-tested before the next begins.

## Discovery (why this design)

Grep across the repo for grievances/representation/case-management/stewards found no existing
Union-specific model — genuinely greenfield. The closest existing precedent is HOA's
`Violation`/`ArchitecturalRequest` pair (main record + append-only `*StatusHistory` + `*Comment`
with an `isPrivate` visibility default), which this feature mirrors structurally. Four pieces of
existing infrastructure are reused directly rather than rebuilt:

- **`Attachment`** (generic, polymorphic via `entityType`/`entityId`) — one new additive
  `AttachmentEntityType.UNION_CASE` value, wired into `src/lib/attachments.ts` exactly like
  `HOA_ARCHITECTURAL_REQUEST`.
- **`EmailReminderLog` + `processPendingReminderLogs()`** (`src/lib/reminders.ts`, dispatched by
  `/api/cron/reminders`) — the generic reminder-send queue. One new additive
  `ReminderType.UNION_CASE_DEADLINE` value. The future `UNION-CASE-D` deadline scanner will mirror
  `sendDeadlineReminders()` in `lib/hoa/violations.ts` (a small per-domain cron that queues
  `EmailReminderLog` rows) rather than building new scheduling infrastructure.
- **`createAuditEvent`** — universal audit logging, used for every write.
- **RBAC capability-string convention** (`"<domain>:<resource>:<action>"`) and the
  `hasVerticalCapability()` central flag resolver — same shape as every other vertical feature.

No existing "employer"/"worksite" model exists in the schema (grepped for
employer/worksite/workplace/bargaining unit — no matches), so the spec's optional intake field
("relevant employer/worksite context if already represented in the Union model") has nothing to
attach to and is not built in `A`. **No household concept was introduced** — a case relates
directly to `Organization` and to the member/assignee via `OrgMember`, with no `Property`-style
intermediate parent (Union has no per-property/per-worksite concept the way HOA does).

## Capability gate

`hasVerticalCapability(org.primaryVertical, "caseManagement")` — new `CapabilityFlag`, enabled
only for `UNION` in `src/lib/vertical-capabilities.ts`. `requireUnionCaseManagementEnabled()` in
`src/lib/union/cases-guard.ts` is the sole gate; per the spec's explicit instruction, nothing
gates solely on `primaryVertical === "UNION"` — the capability flag and an active-org check are
both required on every path.

## RBAC

Five permissions (see `src/lib/rbac.ts`) — more tiers than a plain read/write pair because the
workflow has genuinely distinct authority levels, same reasoning as HOA Violations/Architectural
Requests' multi-tier shape:

| Permission | ORG_OWNER/ADMIN | STAFF (Steward/Rep) | FINANCE | READ_ONLY | MEMBER |
|---|---|---|---|---|---|
| `union:cases:read` | ✅ | ✅ | — | ✅ | — |
| `union:cases:manage` (triage/assign/reassign/status/member-visible updates/contract refs) | ✅ | ✅ | — | — | — |
| `union:cases:notes:internal` (add INTERNAL comments) | ✅ | ✅ | — | — | — |
| `union:cases:deadlines:manage` | ✅ | ✅ | — | — | — |
| `union:cases:close` (resolve/close — terminal) | ✅ | — | — | — | — |

FINANCE holds none deliberately (grievance/representation case management is a steward/board
function, not a financial one, same reasoning as HOA Violations/Architectural Requests). STAFF
gets everything except `close`, mirroring `HOA_VIOLATIONS_RESOLVE`/
`HOA_ARCHITECTURAL_REQUESTS_DECIDE` being withheld from STAFF for the same reason: closing is the
terminal, record-closing action, reserved for board-level authority. A member's own submit/view of
their own case never goes through this permission set at all — that's
`requireUnionCaseMemberAccess()`/`requireUnionCaseSubmitterAccess()`, a dedicated guard scoped to
the caller's own linked `OrgMember` record via their MEMBER web session, mirroring
`requireArchitecturalRequestResidentAccess()`'s pattern exactly. No Union officer gets case access
merely by holding an "officer" role label — capabilities remain the sole source of authority, per
the spec's explicit instruction.

## Member-only intake, no eligibility gate

Unlike Architectural Requests (which restrict submission to OWNER/CO_OWNER/NON_RESIDENT_OWNER
relationship types), **any active member of a UNION-vertical org may submit their own case** —
there is no ownership-type eligibility concept in Union. `requireUnionCaseSubmitterAccess()`
checks only: real MEMBER web session + an active (`membershipStatus: "active"`) `OrgMember`
record in the organization.

Submitting an issue does **not** mean a formal grievance has been filed — that distinction is
preserved explicitly in the schema (`UnionCase.isFormalGrievance`, default `false`, flipped only
by staff) and must be preserved in every future UI built on top of it.

## State machine

```
NEW → TRIAGE
TRIAGE → ASSIGNED / CLOSED
ASSIGNED → ACTIVE / TRIAGE
ACTIVE → PENDING / RESOLVED
PENDING → ACTIVE / RESOLVED
RESOLVED → CLOSED / ACTIVE (reopen)
NEW / TRIAGE / ASSIGNED / ACTIVE / PENDING → WITHDRAWN (member-initiated, any non-terminal status)
CLOSED, WITHDRAWN → terminal
```

The suggested status names from the program spec were adopted as-is (no existing Union status
convention predates this PR). `PENDING` is split out from `ACTIVE` specifically so the future
dashboard (`UNION-CASE-B`) can distinguish "I'm working this" from "I'm waiting on someone else"
(a management response, a hearing date) — directly serving the "what needs my attention today"
requirement. `TRIAGE → CLOSED` exists as a direct dismiss path (duplicate/invalid intake that never
needs a rep assigned). Every transition uses the same transactional compare-and-swap shape proven
in `violations.ts`/`architectural-requests.ts` (conditional `updateMany` repeating the expected
starting status, `UNION_CASE_VALIDATION_ERROR` on a lost race) plus an append-only
`UnionCaseStatusHistory` row per transition.

**Assignment is deliberately decoupled from the state machine.** `assignUnionCase()` sets
`assignedToOrgMemberId` directly; it only advances status to `ASSIGNED` the first time a case
leaves `NEW`/`TRIAGE` (the natural "a rep is now on this" signal). Reassigning a case that's
already `ASSIGNED`/`ACTIVE`/`PENDING` changes only the assignee, leaving status and the
status-history log untouched — a routine reassignment shouldn't manufacture a fake status
transition.

## Schema (purely additive — `prisma/migrations/20260815213958_union_case_a`)

- **`UnionCase`** — `organizationId`, `memberOrgMemberId`, `assignedToOrgMemberId` (nullable),
  `caseNumber` (global auto-increment display number, "UC-42" — same per-org-sequence trade-off
  reasoning as `ArchitecturalRequest.requestNumber`), `caseType` (free-text, same reasoning as
  `Violation.violationType`), `title`, `description`, `status` (`UnionCaseStatus`),
  `isFormalGrievance`, `representationRequested`, `incidentDate`, `openedAt`, `resolvedAt`,
  `resolutionSummary` (member-visible), `closedAt`.
- **`UnionCaseComment`** — identical shape and visibility default (`isPrivate: true`) to
  `ArchitecturalRequestComment`/`ViolationComment`.
- **`UnionCaseStatusHistory`** — identical shape to `ArchitecturalRequestStatusHistory`.
- **`UnionCaseContractReference`** — `reference` (free-text, e.g. "Article 5, Section 3"), `note`.
  No contract/CBA document model exists in the schema yet, so this stays a plain label rather than
  a foreign key into infrastructure that doesn't exist.
- **`UnionCaseDeadline`** — `deadlineType` (free-text), `description`, `dueAt`, `completedAt`,
  `responsibleOrgMemberId`. No reminder-log table of its own; the future `UNION-CASE-D` scanner
  reads `dueAt`/`completedAt` directly and queues rows in the existing `EmailReminderLog`.

## Notifications

A case has exactly one interested member — its owner — so there's no fan-out concept (unlike
Violations, which notifies every active resident of a property). Every notification event
(assigned, status changed) has the member as its sole recipient via `notifyMemberSafely()`, which
never throws (logs and swallows delivery failures, same reasoning as `notifySubmitterSafely` in
`architectural-requests.ts`).

## Security boundary: internal vs. member-visible

`toMemberSafeUnionCase()`/`toMemberSafeUnionCaseComments()` are the **only** functions allowed to
produce a member-facing payload — opt-in field inclusion, not opt-out exclusion, so a future field
added to `UnionCase` without updating these functions stays excluded by default. Tested
adversarially in `src/lib/union/__tests__/cases.test.ts`: a 100-internal/1-public comment fixture
leaks exactly the one public comment; `authorUserId`, contract references, and a deadline's
`responsibleOrgMemberId` never reach the payload at all.

## Audit events

Exact action names per the program spec: `UNION_CASE_CREATED`, `UNION_CASE_ASSIGNED`,
`UNION_CASE_STATUS_CHANGED` (with `UNION_CASE_RESOLVED`/`UNION_CASE_CLOSED` used specifically when
the destination status is `RESOLVED`/`CLOSED`, so those cases are directly filterable by action
name), `UNION_CASE_DEADLINE_CREATED`, `UNION_CASE_DEADLINE_COMPLETED`. Metadata carries only
ids/enums/dates — never case narratives, comment bodies, or resolution text.

## API surface shipped in this PR

Member (`requireUnionCaseSubmitterAccess`/`requireUnionCaseMemberAccess`, no RBAC permission):
`GET/POST /api/union/cases/my`, `GET /api/union/cases/my/[caseId]`,
`POST /api/union/cases/my/[caseId]/withdraw`.

Staff (`requireUnionCaseRead`): `GET /api/union/cases` (directory, filterable by
status/assignee), `GET /api/union/cases/[caseId]` (detail with comments/status history/contract
references/deadlines).

No staff-facing POST/PATCH yet — assignment, status transitions, internal notes, and deadline
management are `UNION-CASE-B`'s job. No pages/UI ship in this PR (API + service layer only).

## Deliberately not built (scope guard — see the 2026-08-15 program spec verbatim)

Payroll functionality beyond what already exists, collective bargaining management, election
systems, full legal case management, AI grievance drafting, AI contract interpretation,
accounting, employer HR functionality, unrelated Union dashboards. Any useful enhancement outside
this scope discovered during the program gets recorded as POST-LAUNCH, not built opportunistically.

## PR sequence status

- **UNION-CASE-A** (this PR) — foundation: schema, RBAC, state machine, member intake, basic
  staff read. Tests: 34 (state machine, tenant isolation, note-visibility adversarial).
- UNION-CASE-B — steward/officer dashboard, assignment, case management endpoints. Not started.
- UNION-CASE-C — timeline UI, notes UI, contract references UI. Not started.
- UNION-CASE-D — deadlines/reminders dispatch (the `EmailReminderLog`-queuing scanner). Not
  started.
- UNION-CASE-E — member mobile experience + hardening pass. Not started.

Once the full program is complete, the next phase is full regression/security testing and
store-submission readiness, not another major feature program.
