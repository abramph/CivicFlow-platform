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

Committee linkage is **not** preserved on the resulting `Expenditure` — `Expenditure` has no `committeeId` field at all, a pre-existing gap this program does not close (see "Remaining enhancements"). Event and category linkage *do* carry over correctly, unaffected by voiding.

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
- A real Treasurer Excel/CSV export sharing `getBudgetWithActuals`/`getFinanceSummary`
- Configurable dual/second-approval (the existing `reimbursementApprovalThreshold` only changes the starting status label today)
- A distinct "return for correction" workflow state
- Reconciliation status/flag on `Expenditure`/`Contribution`
- Volunteer-hours buyout/assessment income rollup onto the Treasurer dashboard (currently correctly excluded from the ledger, but also invisible to it — see the original review's §11 recommendation for the safest integration point)
- Fiscal-year closing as a hard mutation stop
- `Expenditure.committeeId` (committee linkage is lost when a reimbursement is posted or reversed — a pre-existing gap, not introduced or fixed here)
