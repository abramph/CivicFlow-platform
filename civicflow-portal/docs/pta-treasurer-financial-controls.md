# PTA Treasurer — Financial-Control Correction Program

`fix/pta-treasurer-financial-controls` — a targeted correction program built directly on top of the existing PTA-H Treasurer architecture (`BudgetLine`, `ReimbursementRequest`, and the platform-wide `Expenditure`/`Contribution` ledgers). This is **not** a second expenditure system; every fix here extends the existing one.

Origin: the read-only "PTA Treasurer & Expenditure Review" (2026-08-31) traced the architecture end-to-end and found five concrete financial-control defects (D1–D5, below) plus a set of lower-severity gaps. This program fixes D1–D5 and the two structural gaps (§8 payment method, §6 lock-policy documentation) called out for this branch. Everything else from that review is deliberately deferred — see "Remaining enhancements."

## The existing architecture remains authoritative

- `Expenditure` and `Contribution` are the platform-wide ledgers, shared by every vertical.
- `BudgetLine` and `ReimbursementRequest` are the PTA-H layer on top of them.
- Budget actuals and the finance summary are computed **live** from non-void `Expenditure`/`Contribution` rows — never a separately stored total, so they can never drift out of sync with the ledger by construction.
- Nothing in this program introduces a parallel ledger, a new source of truth for spend, or a PTA-specific copy of `Expenditure`.

## External payments are recorded, not processed

Unestra has never processed a reimbursement payment and still doesn't. "Mark paid" records that a payment was made **outside** Unestra — by check, cash, ACH, card, or any other org-configured method. The Treasurer page's own copy and every "Confirm paid"/void/reversal control state this explicitly. No payment provider is contacted anywhere in this workflow, and no bank credential, full account number, or payment-service password is ever stored — a payment method is a label (`PaymentMethodConfig.label`) plus an optional non-secret reference string.

## Approval and payment segregation

Server-enforced, not UI-hidden, in `src/lib/reimbursements.ts`:

- The submitter can never be the actor who **approves**, **marks paid**, **voids**, or **reverses** their own request — checked against the authenticated session's user id, regardless of what permissions that role otherwise holds. No role (including `ORG_OWNER`/`SUPER_ADMIN`) bypasses this in the ordinary workflow. If emergency platform-admin correction is ever genuinely needed, that should be a separately audited administrative process (e.g. a platform-admin CLI action with its own audit trail), not a special case inside this route — none exists today, deliberately.
- Rejecting your own request is **not** restricted the same way, since it only ever withdraws your own claim rather than authorizing a payment to yourself.

## Payment-method selection (§8)

`ReimbursementRequest.paymentMethodId` (new, nullable, additive) references the org's own `PaymentMethodConfig` rows — the same model already used for dues/contributions/payment-links. Marking a reimbursement **PAID now requires** selecting an active, org-scoped method; the free-text `paymentReference` field remains available for a check number or similar, but is no longer the only record of *how* it was paid. The resulting `Expenditure` receives the same `paymentMethodId`, so a directly-entered expense and a paid-reimbursement expense are equally structured on the payment-method side.

Historical `PAID` rows from before this migration keep `paymentMethodId = NULL` and remain fully readable — nothing rewrites them, and nothing requires backfilling a method that was never recorded.

## Receipt security (§7)

Reimbursement receipts use the same private, signed-URL attachment infrastructure as every other entity type (`Attachment`, `/api/attachments/*`) — nothing new was built. Two additive changes:

1. **Ownership scoping** (`verifyAttachmentOwnership` in `src/lib/attachments.ts`): a submitter without `reimbursements:manage` may only read/attach to their **own** request's receipts, even if they know another user's request id. Every other attachment entity type's contract is unchanged — this function returns `true` immediately for all of them.
2. **MIME allowlist for `REIMBURSEMENT`** (`isAllowedAttachmentContentType`): PDF, JPEG, PNG, HEIC/HEIF only. Every other entity type keeps its previous, unrestricted contract. No malware/virus scanning is performed anywhere in this pipeline — this document does not claim otherwise.

Receipt retention: once a reimbursement reaches `PAID`, `VOIDED`, or `REVERSED`, its attachments become settled financial evidence. Removing one past that point requires `reimbursements:manage` (not just `reimbursements:submit`) and **never purges the underlying stored object** — the attachment row is soft-deleted (hidden from ordinary listings) but the file itself is preserved, and the audit action is recorded distinctly (`attachment.delete_evidence_preserved`).

## Correction/void/reversal semantics (§5)

Two new terminal `ReimbursementStatus` values, chosen to mean exactly one thing each:

- **VOIDED** — the reimbursement was marked paid in Unestra *by mistake*; the external payment never actually happened. Requires a reason and typing `VOID` to confirm.
- **REVERSED** — a real external payment happened and was *later* cancelled, returned, or recovered *outside* Unestra. Requires a reason and typing `REVERSE` to confirm.

Unestra never claims to have recovered money itself in either case — the copy in the correction UI says so explicitly, and no payment provider is ever contacted by this action.

Both corrections:

- Never delete or mutate the original `ReimbursementRequest` or `Expenditure` row beyond the correction fields — payee, amount, category, event, and payment reference are all preserved exactly as they were at payment time.
- Void the linked `Expenditure` (`voidedAt`/`voidedByUserId`/`voidReason`) — the same mechanism the rest of the app already uses for expenditure corrections — so `getBudgetWithActuals`/`getFinanceSummary` (which already filter `voidedAt: null`) stop counting it exactly once, automatically.
- Use the same conditional-`updateMany` compare-and-swap as the PAID transition (see below), so two concurrent void/reversal attempts on the same request produce exactly one correction and one stable 409 for the loser.
- Record who performed the correction and when (`correctedAt`/`correctedByUserId`/`correctionReason`), and commit their audit event in the same transaction as the state change.
- Cannot be performed by the original submitter, and cannot cross organizations (every query is scoped by the session's `organizationId`).

Committee linkage **is** preserved on the resulting `Expenditure` as of `feature/pta-treasurer-expenditure-experience` (E3, below) — the void/reverse update only ever touches `voidedAt`/`voidedByUserId`/`voidReason`, so whatever committee attribution the `Expenditure` was created with survives a correction unchanged, same as event and category linkage.

## Concurrency-safe payment (D1)

The pre-existing `transitionReimbursement` read the row, validated its status in application memory, and then ran an *unconditional* update — a real TOCTOU race where two near-simultaneous "mark paid" calls could each create their own `Expenditure` for the same request.

The fix adopts the same conditional-`updateMany` compare-and-swap idiom already used elsewhere in this codebase (`payment-report-mutations.ts`, `report-export-queue.ts`): the transition that actually flips status to `PAID` (or `VOIDED`/`REVERSED`) re-checks the current status **inside** the same `$transaction` that writes it, via `updateMany({ where: { id, organizationId, status: <expected> }, ... })`. A losing concurrent caller sees `count === 0`, never reaches the `Expenditure` create/void, and receives a stable `409` — "already paid" / "already voided" / "already reversed" as appropriate. The `Expenditure` create, the `expenditureId` link, and the audit event all sit in that same transaction, so an audit failure rolls back the payment state and the `Expenditure` together — nothing partially commits.

A new `CHECK` constraint (`ReimbursementRequest_paid_requires_expenditure_check`) makes "a `PAID` row always has its `Expenditure` linked" a database-level fact, not only an application-level one.

## Financial edit window (§6)

Traced `lockedAt`, `financialEditWindowHours`, and `financial-edit-policy.ts` end to end. Finding: the time-window model was **already the coherent, working mechanism** — `canEditFinancialRecord` computes editability dynamically from `record.createdAt + OrgSettings.financialEditWindowHours`, with no background job required to make the window effective, and privileged roles can still correct an expired-window record with a reason. `lockedAt` is not dead code exactly — it's a correctly-handled *override* signal that nothing currently sets, since no UI exists yet to manually lock a record. This program's decision: **retain** `lockedAt` as that reserved override (a future "lock this record" action can set it without any policy-function change), rather than remove it or build new lock UI — matching the request's own "if such a feature genuinely exists" framing. Once the ordinary edit window closes, the only path forward is a privileged correction or (for reimbursements specifically) void/reversal — never a silent mutation of the original.

Boundary tests (`src/lib/__tests__/financial-edit-policy.test.ts`) cover: just-before/at/after the exact expiration instant, a privileged correction with and without a reason, the org's `allowFinanceCorrections` kill switch, the retained manual-lock override (both denying and permitting-with-privilege), and that a voided record can never be edited regardless of role.

Fiscal-year closing (a hard stop on mutation for a prior year, independent of the rolling edit window) does **not** exist today and is not added here — no model represents a "closed" fiscal year. Listed as a remaining enhancement.

## Atomic auditing (§9)

Every financial mutation this program touches now creates its audit event with the transaction-aware `createAuditEvent(..., tx)` inside the same `$transaction` as the state change, instead of a post-commit best-effort call:

- Reimbursement submit, approve/reject/review, mark-paid, void, reverse (`src/lib/reimbursements.ts`)
- Budget-line create and update (`src/lib/budget.ts`)

The actor is always the authenticated session's user id — no placeholder actor exists anywhere in this path. Direct `Expenditure`/`Contribution` mutation (the generic, shared APIs used by other verticals too) were left with their pre-existing audit shape — their contract wasn't touched, per the instruction to avoid PTA-only divergence in shared code.

## Remaining enhancements (explicitly deferred from this branch)

- Restricted-fund expenditure linkage (`Expenditure` has no `fundId`)
- Configurable dual/second-approval (the existing `reimbursementApprovalThreshold` only changes the starting status label today)
- A distinct "return for correction" workflow state
- Reconciliation status/flag on `Expenditure`/`Contribution`
- Volunteer-hours buyout/assessment income rollup onto the Treasurer dashboard (currently correctly excluded from the ledger, but also invisible to it — see the original review's §11 recommendation for the safest integration point)
- Fiscal-year closing as a hard mutation stop
- Budget-vs-actual, reimbursement-status, and correction/audit-history exports (E4 — deferred, see "PTA Treasurer Expenditure Experience" below)
- Cross-vertical `Contribution` mutation/audit atomicity (found during the investigation that preceded the Expenditure Experience work below, not fixed here — see that section)

---

# PTA Treasurer Expenditure Experience (E1–E3)

`feature/pta-treasurer-expenditure-experience` — an investigation (2026-08-31/09-01) found that the PTA Treasurer page displayed spending totals and budget actuals sourced from the `Expenditure` ledger, but provided no way to see or manage that ledger directly. Root cause, confirmed both by code inspection and a live production check: the generic `/expenditures` routes and API were already fully built, tenant-scoped, and correctly permissioned (the `FINANCE` role — this app's Treasurer role — already held `expenditures:read`/`expenditures:write`) — the PTA navigation array in `vertical-navigation.ts` simply never linked to them. Not RBAC, not a missing route, not an incomplete backend: a missing nav entry. This program (E1–E3) closes that gap and completes several UI defects the investigation found alongside it, without forking any of the shared expenditure logic.

## E1 — Internal Treasurer navigation

The top-level PTA nav item stays exactly as it was: one entry, labeled **Treasurer**, at `/labs/pta/finance` (`vertical-navigation.ts` is unchanged). `/labs/pta/finance` is now a shell (`src/app/labs/pta/finance/layout.tsx`) with four internal sections, each a real nested route rather than client-only tab state:

| Section | Route | Gate |
|---|---|---|
| Overview | `/labs/pta/finance/overview` | `budget:read` (same as the original single page) |
| Budget | `/labs/pta/finance/budget` | `budget:read`; add/remove line requires `budget:manage` |
| **Expenditures** | `/labs/pta/finance/expenditures` (+ `/new`, `/[id]`, `/[id]/edit`) | `expenditures:read` / `expenditures:write` — the specific, correct permission the investigation confirmed the Treasurer role already holds |
| Reimbursements | `/labs/pta/finance/reimbursements` | `budget:read` (same as the original single page) |

`/labs/pta/finance` itself now redirects to `/overview`, so the existing nav href and any external link to the old URL keep working. Every tab is a real `<Link>` (`TreasurerTabs.tsx`), so direct URLs, refresh, and browser back/forward all work without any client-side tab-state plumbing; the active tab is marked both visually and via `aria-selected`.

The Expenditures section reuses the generic ledger: `TreasurerExpendituresPage` etc. call the same `listExpenditures()` service and render the same `ExpenditureLedgerTable`/`ExpenditureForm`/`AttachmentManager` components the top-level `/expenditures` routes use, parameterized by a `basePath` prop so links/redirects stay inside the Treasurer shell. Mutations go through the same `/api/expenditures*` endpoints either way — there is exactly one create/edit/void implementation, not two.

## E2 — Completing the expenditure UI

Gaps the investigation found in the pre-existing generic `/expenditures` UI, fixed for both the generic and Treasurer-nested surfaces (same shared components):

- **Void control**: the API already supported voiding (`voidReason`/`voidedAt`); no UI exposed it. `ExpenditureVoidControl.tsx` now does, with a required reason, a typed `VOID` confirmation, and copy explaining that voiding preserves history and changes totals going forward. Hardened while adding it: the PATCH route's void path now runs through a dedicated `voidExpenditure()` service function (`src/lib/expenditures.ts`) using a CAS-guarded `updateMany({ where: { ..., voidedAt: null } })`, so two concurrent void attempts (double-click or two officers) produce exactly one voided outcome and one stable `409` for the loser — the same idiom already used for the reimbursement PAID/VOIDED/REVERSED transitions. Voiding also now requires the previously-unwired `canVoidFinancialRecord(role)` gate in addition to the edit-window policy, closing a latent defense-in-depth gap (every role holding `expenditures:write` today already satisfies it, but a future org-custom role via `OrgRolePermissionSet` could otherwise have inherited void authority it was never meant to have).
- **Edit reason / lock status**: `canEditFinancialRecord` now also returns `requiresReason`, so the edit form can show/require the reason field and explain *why* before the user submits, not only after a rejected request.
- **Filters**: date range, category, payment method, status (active/voided), vendor/payee text, origin (direct/reimbursement), and committee — all as URL query parameters (`ExpenditureFilterForm`, a plain GET form), so a filtered view is refresh-safe, back/forward-safe, and shareable by URL with no client JavaScript required to reproduce it.
- **Reimbursement-origin linkage**: `Expenditure.reimbursement` (the existing back-relation) is now surfaced — the ledger and detail views show "Created from reimbursement" with a link into the Treasurer's Reimbursements section (`?highlight=<id>`, which scrolls to and outlines the matching row). This linkage is read-only by construction: no route accepts a client-supplied value to set or reassign it.

## E3 — Committee attribution

`ReimbursementRequest.committeeId` was already captured at submission time, but `Expenditure` — the actual ledger row, and what budget actuals and (now) the ledger UI read from — had no committee column at all, so the attribution was silently lost the moment a reimbursement was paid, and never existed for a direct expenditure.

Migration `20260901090000_pta_treasurer_expenditure_committee_attribution` adds two nullable columns to `Expenditure`:

- **`committeeId`** — a live FK to `PtaCommittee`, `ON DELETE SET NULL ON UPDATE CASCADE`, added `NOT VALID` then `VALIDATE CONSTRAINT`ed as its own statement (same convention as migration `20260831140000`) — the constraint is fully validated by the time the migration commits, but the initial `ADD CONSTRAINT` never holds a full-scan lock. `SET NULL`, not `RESTRICT`, was chosen deliberately: it matches every other optional attribution FK already on `Expenditure` (category/paymentMethod/campaign/event), and there is no accounting reason to block a committee from being archived just because it once posted an expense, given the snapshot below already preserves the historical record's meaning independent of the live row.
- **`committeeNameAtPosting`** — an immutable snapshot of the committee's display name, taken once at creation and never re-derived. A later rename, archive, or deletion of the `PtaCommittee` row never changes what a historical `Expenditure` is understood to say; verified directly against real Postgres (see below).

Migration-lock analysis (no production database queried): both `ADD COLUMN`s are metadata-only regardless of table size. `CREATE INDEX` on `committeeId` cannot use `CONCURRENTLY` inside Prisma's single-transaction migration, so it holds an ordinary `SHARE` lock (blocks writes, not reads) for the scan duration — the same category of risk already accepted for the two ordinary indexes added in migration `20260831140000`; production `Expenditure` row count is unknown and this migration does not assume it is small. `VALIDATE CONSTRAINT` is a real scan under `SHARE UPDATE EXCLUSIVE` (blocks other DDL only), trivially fast here since the column is new and all-NULL, but genuinely executed rather than assumed.

**Inheritance**: `markPaid()` (`reimbursements.ts`) now looks up the reimbursement's committee inside the same transaction as the Expenditure create, re-validates it belongs to the organization, and writes both `committeeId` and a fresh `committeeNameAtPosting` snapshot onto the new `Expenditure` — inherited, not chosen at pay time. If the referenced committee is no longer found (not reachable via any current UI, but not structurally impossible), the payment still proceeds with no committee attribution rather than blocking a real payment over a stale reference. Corrections (void/reverse) never touch these two columns, so attribution survives a correction unchanged (see the updated §5 above).

**Direct expenditures**: the create/edit form gains an optional Committee field, populated only for PTA organizations (`getOrganizationCommitteeOptions` returns `[]` for any other vertical, so the field simply never renders elsewhere — no vertical `if` needed at each call site). The API (`/api/expenditures*`) validates the id against `PtaCommittee` scoped to the caller's own `organizationId` and snapshots the name server-side; a client-supplied snapshot value is never accepted, and a non-PTA organization cannot reference a `PtaCommittee` row at all, because none exist scoped to its `organizationId` — the same tenant-scoping that prevents any other cross-org reference, not a separate vertical check.

**Historical rows**: no backfill was performed or considered — every `Expenditure` row that predates this migration (direct or reimbursement-generated) keeps `committeeId = NULL` and `committeeNameAtPosting = NULL`. If a later, separately authorized project wants to reconstruct committee attribution for old reimbursement-generated rows (recoverable via the still-intact `ReimbursementRequest.committeeId` on the originating request, where one exists), that is real-data-touching work requiring its own authorization — this program does not attempt it.

Verified against real PostgreSQL (`src/lib/__tests__/treasurer-expenditure-committee.integration.test.ts`, 9 tests, stable across 3 consecutive runs): the FK is genuinely enforced; same-org committees are accepted and cross-org/cross-vertical ones rejected; a committee rename does not alter an already-posted snapshot; a committee deletion `SET NULL`s the FK but preserves the snapshot and the `Expenditure` row itself; reimbursement mark-paid genuinely inherits and snapshots; void/reverse genuinely preserve attribution; two concurrent void requests produce exactly one voided outcome and one audit event; a forced audit-write failure genuinely rolls back the void.

## Role/permission matrix (Expenditures)

| Role | `expenditures:read` | `expenditures:write` |
|---|---|---|
| SUPER_ADMIN / ORG_OWNER / ORG_ADMIN / FINANCE (Treasurer) | ✅ | ✅ |
| READ_ONLY | ✅ | ❌ |
| STAFF / MEMBER | ❌ | ❌ |

Enforced server-side in every route (`requirePermission`/`getPtaPageGate`), not only by hiding UI controls — a caller without `expenditures:read` receives no ledger data from any Treasurer or generic expenditure route, and a `READ_ONLY` caller sees the ledger but no Add/Edit/Void controls.

## Known limitations

- No React component-rendering test library (e.g. `@testing-library/react`) exists anywhere in this codebase (verified: zero `*.test.tsx` files, no such dependency). Introducing one was judged out of scope for this feature. UI/navigation correctness was instead verified through: TypeScript across the full route tree, a full production build (which statically resolves every new route), and tests that call each new page's server-component function directly to assert its permission gate and data-fetch behavior (`treasurer-expenditure-navigation.test.ts`) — not through rendered-DOM assertions. Live browser verification of the new Treasurer tabs/Expenditures UI against a running local dev server was not performed in the implementation session (local Postgres was not running and there was no established way to start it in that session) — recommended as a manual smoke-test step before merge.
- Budget-vs-actual, reimbursement-status, and correction/audit-history exports remain missing — the generic Reports engine only has an `EXPENDITURES` report type. Deferred as E4, not implemented under this authorization.
- Fiscal-year closing as a hard mutation stop still does not exist (unchanged from the original program).

## Separately scoped: Contribution mutation/audit atomicity

Found during the investigation that preceded this program, out of scope here: `POST /api/contributions` → `createContribution()` (`src/lib/contribution-mutations.ts`) calls `createAuditEvent()` without wrapping it and the underlying write in the same `$transaction` — the same class of gap this and the prior Treasurer program already found and fixed for reimbursements and expenditures. Recorded here for a future, separately authorized fix; not touched by this branch.
