# HOA Architectural Requests

The second complete HOA-specific workflow beyond the Property/Resident foundation (PR #43) and
Violations (`docs/hoa-violations-mvp.md`) — a resident/owner's submission for board or committee
approval of an exterior or property modification, and its review lifecycle. Built per Part 3 of
the 2026-08-04 program that also established the Principal Architect/TPM role for this project;
that program's own instruction was explicit and detailed enough to supersede `docs/hoa-domain-model.md`'s
earlier, lighter-weight `ArchitecturalRequest` planning table (notably: this implementation adds
`DRAFT`, `CHANGES_REQUESTED`, `RESUBMITTED`, and `EXPIRED` states the original draft didn't have).

## Capability gate

`hasVerticalCapability(org.primaryVertical, "architecturalRequests")` — the flag itself was already
reserved in `src/lib/vertical-capabilities.ts`'s `CapabilityFlag` union since PR #43 (anticipating
this exact feature); this PR is what actually flips it on for HOA and builds the model/routes
behind it. `maintenanceRequests` remains off.

## RBAC

Four permissions, mirroring Violations' four-tier shape for the same reason — the workflow has
distinct authority levels (see `src/lib/rbac.ts`):

| Permission | ORG_OWNER/ADMIN | STAFF | FINANCE (Treasurer) | READ_ONLY | MEMBER |
|---|---|---|---|---|---|
| `hoa:architectural-requests:read` | ✅ | ✅ | — | ✅ | — |
| `hoa:architectural-requests:write` | ✅ | ✅ | — | — | — |
| `hoa:architectural-requests:review` (move to review, request changes) | ✅ | ✅ | — | — | — |
| `hoa:architectural-requests:decide` (approve/conditionally approve/deny/expire — terminal) | ✅ | — | — | — | — |

Treasurer holds none deliberately, same reasoning as Violations: design/modification review isn't
a financial function. `write` here is not used by officers directly today — see "Resident-only
submission" below — it exists for symmetry with the permission model and in case a future officer
"submit on a resident's behalf" flow is added.

### Architectural committee (ARC) reviewers

No dedicated "committee" concept or role exists. Per this program's explicit instruction not to
infer permission from committee-chair status, an ARC reviewer is simply a `STAFF`-role invitee (or
a custom per-org role via the existing `OrgRolePermissionSet` mechanism) holding the `review`
permission — the same pattern `docs/hoa-navigation-proposal.md` had already proposed. There is
nothing ARC-specific in the schema or guard layer.

## Resident-only submission and relationship eligibility

Unlike Violations (officer-initiated), a request is always resident-initiated. Only an **ACTIVE**
`PropertyResident` relationship of type `OWNER`, `CO_OWNER`, or `NON_RESIDENT_OWNER` may submit —
see `requireArchitecturalRequestSubmissionEligibility()` in `architectural-requests-guard.ts`. This
is a deliberate MVP policy decision, not an oversight: `RESIDENT` and `TENANT` relationships cannot
self-submit, since architectural modification is an ownership-accountability decision in most HOA
governing documents. No "officer submits on a non-eligible resident's behalf" UI ships in this MVP
(the service function itself has no such restriction — an officer *could* call it directly — but
no page/route exposes that path).

A submitter keeps access to their own request regardless of relationship changes later —
`requireArchitecturalRequestResidentAccess()` scopes by `submittedByOrgMemberId` on the request
itself, not by re-checking `PropertyResident`, so an ended relationship never retroactively hides
someone's own submission history. Unlike Violations (which hides `DRAFT` from residents entirely,
since a violation's draft is an officer's internal working state), a resident's own `DRAFT` request
**is** visible to them — it's their own not-yet-submitted work.

## State machine

```
DRAFT → SUBMITTED
SUBMITTED → IN_REVIEW
IN_REVIEW → CHANGES_REQUESTED
CHANGES_REQUESTED → RESUBMITTED
RESUBMITTED → IN_REVIEW
IN_REVIEW → APPROVED / CONDITIONALLY_APPROVED / DENIED
DRAFT / SUBMITTED / CHANGES_REQUESTED → WITHDRAWN
APPROVED / CONDITIONALLY_APPROVED → EXPIRED
```

**Withdrawal is deliberately not allowed from `IN_REVIEW` or `RESUBMITTED`** — once a reviewer is
actively evaluating a submission (or it's freshly back in that queue), letting the resident pull it
out from under an in-progress review adds real complexity for limited product value; this exact
transition set was this program's own explicit recommendation and was adopted as-is rather than
expanded. `EXPIRED` is a manual officer (`decide`-tier) action in this MVP — no automated
expiry-date cron job runs yet, even though `expirationDate` is schema-ready; see "Deliberately not
built" below.

All transitions use the same transactional compare-and-swap shape proven in `violations.ts`
(conditional `updateMany` repeating the expected starting status, `HOA_ARCHITECTURAL_REQUEST_STALE_UPDATE`
on a lost race) — proven against real Postgres in
`architectural-requests-concurrency.integration.test.ts`.

## Schema (purely additive — see `prisma/migrations/20260804041705_add_hoa_architectural_requests`)

- **`ArchitecturalRequest`** — `organizationId`, `propertyId`, `submittedByOrgMemberId`,
  `requestNumber` (global auto-increment display number, e.g. "AR-42" — not a per-org sequence;
  Postgres/Prisma has no clean per-org sequence primitive without a bespoke trigger, and a global
  counter is a reasonable trade-off for a low-volume, display-only field), `category` (free-text,
  same reasoning as `Violation.violationType`), `title`, `projectDescription`, `proposedStartDate`,
  `proposedCompletionDate`, `status` (`ArchitecturalRequestStatus` enum), `submittedAt`,
  `decidedAt`, `decidedByUserId`, `decisionSummary` (resident-visible), `conditions`
  (resident-visible, only meaningful for `CONDITIONALLY_APPROVED`), `expirationDate`.
  The one decision a request ever gets is stored directly on the main record rather than as a
  separate append-only child table — unlike a Violation's notices (which can recur many times), a
  decision happens at most once per submission cycle, so a dedicated table would be an unused
  abstraction for a 1:0-or-1 relationship.
- **`ArchitecturalRequestComment`** — identical shape and visibility default (`isPrivate: true`) to
  `ViolationComment`.
- **`ArchitecturalRequestStatusHistory`** — identical shape to `ViolationStatusHistory`.

No `ArchitecturalRequestNotice` model exists — unlike Violations, there's no separate
formal-notice-sending concept distinct from status transitions/comments in this workflow;
`decisionSummary`/`conditions` on the main record cover the "formal decision notice" requirement.

## Attachments

Registered as `HOA_ARCHITECTURAL_REQUEST` in the shared `AttachmentEntityType` enum and
`src/lib/attachments.ts`, identical wiring to `HOA_VIOLATION`. The `Attachment` model has no
visibility/classification field at all (it's a purely generic file record), and adding one would
be a shared-infrastructure change affecting every other entity type that uses attachments — instead,
resident-visible vs. officer-only classification reuses the existing generic `purpose` free-text
field (e.g. `"RESIDENT_VISIBLE"` / `"OFFICER_ONLY"`), with actual enforcement happening in the
resident-facing read path, mirroring how `toResidentSafeArchitecturalRequest()` filters comments.
No attachment-upload UI ships in this MVP (same scope cut Violations made) — the entity type is
registered and authorization-gated so the generic attachment API can already accept uploads via
direct API calls, ready for a future UI pass.

## Notifications

Unlike Violations (which fans a notification out to every `ACTIVE` resident of a property, since a
violation can affect a whole household), an architectural request has exactly one interested
resident — its submitter — so there's no `resolveActivePropertyResidents`-style fan-out. Every
notification event (submitted, review started, changes requested, resubmitted, decided) has the
submitter as its sole recipient, delivered via `notifySubmitterSafely()`, which never throws (logs
and swallows delivery failures, same reasoning as `notifyPropertyResidentsSafely` in `violations.ts`).

## Deliberately not built (MVP scope cuts)

- **Permit verification, contractor licensing, automated governing-document interpretation, voting
  engine, fee collection, site-inspection scheduling, digital signatures, external government
  integration, AI approval recommendations, automatic approval** — all explicitly out of scope per
  this program's own instruction.
- **Automatic expiration.** `expirationDate` is schema-ready; no cron job transitions
  `APPROVED`/`CONDITIONALLY_APPROVED` to `EXPIRED` automatically yet. `EXPIRED` is reachable today
  only via a manual officer action.
- **Attachment upload UI.** The entity type and authorization are wired; no page renders an upload
  control yet.
- **"Submit on behalf of" for non-eligible relationship types.** An officer could theoretically call
  `createArchitecturalRequestDraft()` directly, but no UI exposes it.
- **Dedicated mobile screen.** The mobile app has no architectural-requests screen; `/m/architectural-requests`
  is a web-only resident surface, same reduced-mobile-scope reasoning as `/m/violations`.
