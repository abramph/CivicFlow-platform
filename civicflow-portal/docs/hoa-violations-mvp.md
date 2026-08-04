# HOA Violations MVP

The first complete HOA-specific workflow beyond the Property/Resident foundation (PR #43) — a
recorded compliance issue against a `Property` and its resolution lifecycle. Scoped strictly to
Violations only, per this task's explicit instruction not to begin Architectural Requests,
Maintenance Requests, Amenities, Parking, Pets, Vendors, Elections, or any other HOA feature during
this pass — see `docs/hoa-mvp-recommendation.md` (the original discovery doc, which recommended
Violations + Architectural Requests together) and `docs/hoa-domain-model.md` (the `Violation`
entity's original field design) for the prior art this implementation builds on and, in places,
supersedes with a more detailed spec (the state list and permission split below reflect this
task's own instructions, not the discovery doc's earlier draft).

## Capability gate

`hasVerticalCapability(org.primaryVertical, "violations")` — flipped on for HOA in
`src/lib/vertical-capabilities.ts`, following the same `CapabilityFlag` mechanism Properties
already uses. `architecturalRequests`/`maintenanceRequests` remain off.

## RBAC

Four permissions, not two, because the workflow itself has three distinct authority levels (see
`src/lib/rbac.ts`):

| Permission | ORG_OWNER/ADMIN | STAFF | FINANCE (Treasurer) | READ_ONLY | MEMBER |
|---|---|---|---|---|---|
| `hoa:violations:read` | ✅ | ✅ | — | ✅ | — |
| `hoa:violations:write` (create draft, edit draft, issue) | ✅ | ✅ | — | — | — |
| `hoa:violations:review` (ACKNOWLEDGED, IN_REVIEW, CURED) | ✅ | ✅ | — | — | — |
| `hoa:violations:resolve` (RESOLVED, DISMISSED — terminal) | ✅ | — | — | — | — |

Treasurer holds none of these deliberately — compliance enforcement is a board/property-manager
function, not a financial one, even though a violation may eventually carry a fine. A resident's
own read access to their own property's violations does **not** go through this permission set at
all (see below).

## Schema (purely additive — see `prisma/migrations/20260803234710_add_hoa_violations_mvp`)

- **`Violation`** — `organizationId`, `propertyId`, `violationType` (free-text, matching
  `ArchitecturalRequest.category`'s precedent), `description`, `status` (`ViolationStatus` enum),
  `issuedAt`, `cureByDate`, `resolvedAt`, `resolutionNotes` (board-only), `fineChargeId` (nullable,
  unique, FK to `DuesCharge` — schema-ready per the discovery doc's "fines are just DuesCharge
  rows" design, but the fine-*creation* flow is not built in this MVP; see "Deliberately not
  built" below).
- **`ViolationNotice`**, **`ViolationComment`**, **`ViolationStatusHistory`** — three separate
  append-only child tables (never updated or deleted), exactly as this task specified, rather than
  one combined activity-log table. `ViolationComment.isPrivate` defaults `true` — a comment is
  only ever resident-visible when a caller explicitly opts out of privacy, never the reverse.
- Photos/supporting documents reuse the existing polymorphic `Attachment` model via a new
  `HOA_VIOLATION` `AttachmentEntityType` value — no dedicated attachment table, matching the
  discovery doc's explicit reuse recommendation.
- `onDelete: Restrict` on every organization/property foreign key (not `Cascade`), matching
  `Property`/`PropertyResident`'s own established convention in this schema — compliance history
  must never be silently destroyed by a cascading delete.

## State machine

```
DRAFT -> ISSUED -> ACKNOWLEDGED -> IN_REVIEW -> CURED / RESOLVED / DISMISSED
           \-> CURED / DISMISSED directly         \-> CURED / DISMISSED directly
```

Enforced centrally in `src/lib/hoa/violations.ts`'s `assertValidTransition()` — every write goes
through this module, never a raw `prisma.violation.update({ data: { status } })` at a call site.
`CURED`/`RESOLVED`/`DISMISSED` are terminal; correcting a resolved violation creates a new row
(mirrors `DuesCharge`'s correction-creates-new-revision convention) rather than reopening history
in place. `DRAFT -> ISSUED` is the only transition with its own function (`issueViolation()`) since
it uniquely also sends the resident's first notice and stamps `issuedAt`.

## Authorization architecture

One centralized guard module, `src/lib/hoa/violations-guard.ts`, applying the exact lesson from
`docs/hoa-mvp-recommendation.md`'s own stated prerequisite ("design the centralized access-guard
module before writing the first page — learning directly from PTA's own retrospective on scattered
checks"):

- **Officer path** (`requireHoaViolation{Read,Write,Review,Resolve}`) — RBAC permission + the
  `violations` capability check. No property-level scoping: an officer sees every property's
  violations in their organization.
- **Resident path** (`requireHoaViolationResidentAccess`, `listMyResidentPropertyIds`) — no RBAC
  permission at all, mirroring the documented pattern for parent/household self-service already
  established for PTA. Authorized purely by an ACTIVE `PropertyResident` relationship to the
  violation's own property, scoped to a real `MEMBER` web session
  (`requireMemberWebSession` — the same mechanism `/m/dues` already uses), never a raw
  `organizationId`/`propertyId` trusted from client input. A `DRAFT` violation is treated as
  not-yet-existing from a resident's point of view (404, not 403) — it's an internal officer
  working state never communicated to them yet.
- **`toResidentSafeViolation()`** (`src/lib/hoa/violations.ts`) is the *only* function allowed to
  produce a resident-facing violation payload. It uses opt-in field inclusion (a fixed list of
  fields to copy out), not opt-out exclusion — a future field added to `Violation` without
  updating this function stays excluded by default rather than silently leaking. `resolutionNotes`
  and every private `ViolationComment` are never included.

## Notifications

Exactly four kinds, as specified — no notification on `DRAFT` creation or edit:

1. **`issued`** — sent when `issueViolation()` runs, alongside the first `ViolationNotice` row.
2. **`deadline_reminder`** — sent by `sendDeadlineReminders()`, scanning for violations within 3
   days of `cureByDate`, deduped to at most once per violation per calendar day (checked against
   the `ViolationNotice` audit trail itself, not a separate tracking column). Wired to
   `POST /api/cron/hoa-violation-reminders`, mirroring `processPendingReminderLogs`'s existing
   cron-worker pattern (`validateCronSecret` + `requireRateLimit`). **This route exists and is
   ready, but actually scheduling it (adding it to whatever external trigger fires the other
   `/api/cron/*` routes — no `jobs`/cron component exists in the DO app spec itself, confirmed via
   `doctl apps spec get`) is an operational step outside this PR's scope**, since the real
   scheduling mechanism wasn't independently confirmed and shouldn't be guessed at.
3. **`status_changed`** — every non-terminal transition after `ISSUED`.
4. **`resolved_dismissed`** — every terminal transition.

Delivery reuses `sendEmail`/`sendPushToTokens` directly (not the bulk-campaign infrastructure,
since this is transactional per-violation messaging, not a campaign) and respects each recipient's
own `commsEmailEnabled`/`commsPushEnabled` preferences — the same opt-out check this readiness
program's PR A added to bulk communication campaigns.

## Officer UI

- `/hoa/violations` — list, filterable by status.
- `/hoa/violations/new` — create a `DRAFT`.
- `/hoa/violations/[violationId]` — detail: status, notices, comments (with private/visible
  distinction shown explicitly), full status-history audit trail, and every valid next action for
  the caller's own permission tier (`src/components/hoa/ViolationActions.tsx`).
- Added to the HOA nav profile (`src/lib/vertical-navigation.ts`) and the main dashboard
  (`src/app/(portal)/dashboard/page.tsx`) as a real-count widget (open violations, past-cure-by-date
  count, recent activity) — no fake/placeholder metrics, matching every other dashboard widget in
  this codebase.

## Resident read path

- Web: `/m/violations` (`src/app/m/violations/page.tsx`) — every non-`DRAFT` violation on a
  property the caller resides at or owns, added to `MemberPortalShell`'s nav.
- Mobile: API-ready (`GET /api/hoa/violations/my`, `GET /api/hoa/violations/my/[violationId]`) but
  no dedicated mobile screen was built, per this MVP's deliberately reduced mobile scope — a
  resident *reading* their own violation notices was judged a reasonable web-first exception
  (matching how `/m/dues` already works) rather than mobile-first, and building a new mobile screen
  wasn't a demonstrated blocking need for this pass.

## Deliberately not built in this MVP

- **Fine-creation flow.** `Violation.fineChargeId` exists and is schema-ready (per the discovery
  doc's "fines are just `DuesCharge` rows" design), but creating a `DuesAccount`/`DuesCharge` for a
  fine requires real billing-flow work (finding-or-creating the property's billing member's
  `DuesAccount`, a "Fine" category, etc.) that this task's own simplified state-machine spec didn't
  call for. A confirmed, bounded fast-follow, not built now.
- **Appeals.** The task's own instruction was explicit: "Appeals and fines should only be included
  if the approved discovery explicitly defines them." The state list actually specified for this
  MVP (`DRAFT`/`ISSUED`/`ACKNOWLEDGED`/`IN_REVIEW`/`CURED`/`RESOLVED`/`DISMISSED`) has no appeal
  state, so none was built — no `ViolationAppeal` model, no appeal UI.
- **Architectural Requests, Maintenance Requests, Amenities, Parking, Pets, Vendors, Elections** —
  explicitly out of scope for this task; `architecturalRequests`/`maintenanceRequests` capability
  flags remain `false`.
- **A dedicated mobile violations screen** — see "Resident read path" above.
- **Automated deadline-reminder scheduling** — the route exists; wiring it into whatever fires the
  other cron routes is a deployment/ops step, not a code change, and wasn't done here since the
  real trigger mechanism wasn't independently confirmed.

## Testing

- `src/lib/hoa/__tests__/violations.test.ts` (31 tests) — the full state machine (every valid and
  invalid transition pair), draft create/edit, issue (including the resident-notification path and
  the `commsEmailEnabled` opt-out check), every transition path, comments, the resident-safe
  projection (proves `resolutionNotes` and private comments are never included), and
  `sendDeadlineReminders`'s dedup logic.
- `src/lib/hoa/__tests__/violations-guard.test.ts` (11 tests) — officer permission gates, the
  vertical/capability check, cross-tenant isolation (`getHoaViolationAccessContext`), and every
  resident-access edge case (no relationship, `DRAFT` violation, wrong member id never trusted from
  outside the session).
- **Real end-to-end verification against a live (local, disposable) database**, not just mocked
  unit tests: ran `prisma/seed-hoa-demo.ts`'s new violation scenarios against the actual local dev
  Postgres instance, which caught a real bug (an invalid `ISSUED -> RESOLVED` transition in the
  seed script itself, missing the required `IN_REVIEW` step) that the mocked unit tests alone did
  not exercise. Fixed and re-verified; the seed script is idempotent (verified via a second and
  third run producing no duplicates).
- A route-mounting smoke test (dev server + `curl`) confirmed every new route compiles and responds
  sensibly (401/400 JSON errors on unauthenticated API calls, real HTML with no crash on page
  routes) — not a substitute for an authenticated click-through, which wasn't performed in this
  pass; noted honestly rather than claimed.

## Fictional demo data

`prisma/seed-hoa-demo.ts` (Oak Ridge Homeowners Association) now includes four violation scenarios
covering every meaningfully distinct state: a `DRAFT` (officer working note, nothing sent), an
`ISSUED` notice awaiting cure, an `IN_REVIEW` case with a private board-only comment, and a
`RESOLVED` case with `resolutionNotes`. Idempotent (checked before re-seeding).
