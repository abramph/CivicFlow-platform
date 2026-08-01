# Parent Membership and Dues Self-Service

> **Superseded by PR #40 (2026-07-29):** the "Passes the PTA Labs gate"
> line below is no longer accurate — access is now gated solely by
> `Organization.primaryVertical === "PTA"` via `requirePtaHouseholdSelfAccess()`
> in `src/lib/labs/pta/guard.ts`. See `docs/pta-access-architecture.md`.

Builds on the Unestra for PTA MVP (see `docs/pta-labs-mvp.md`). This feature gives a parent linked to an active PTA household a self-service view of their own membership and dues — closing the single highest-value gap identified in that MVP's hardening review.

## Dependency

This branch (`agent/pta-parent-dues-self-service`) is built directly on top of `agent/pta-labs-mvp` at commit `c837769` (PR #17), which was still open and unmerged when this work began. **This PR must not merge before PR #17.** It adds zero schema changes and touches no shared file in a behavior-changing way, so there is no reason it couldn't be reviewed in parallel, but the merge order matters.

## Parent workflow

1. Parent navigates to `/labs/pta/membership`.
2. Sees their PTA's name, current school year, membership type, and their household's current dues charge (amount due, amount paid, remaining balance, due date, status).
3. If online payment is configured for the PTA, clicks "Pay online" — goes to the **existing, unmodified** `/pay/[slug]` Stripe Checkout page.
4. Whether paying online, by check, cash, or another method, the parent can submit "Report this payment" — creating a `pending` `PaymentReport` for a PTA officer to review (the same mechanism, and the same underlying function, the base product's own member-portal report-payment flow already uses).
5. Once an officer approves the report (existing, unmodified `/api/admin/payment-reports/[id]/approve` route) or records a manual payment directly (existing PTA officer route from PR #17), the charge's status updates and the parent sees it reflected next time they load the page.
6. Prior school years' dues history remains visible below the current charge.
7. Switching active organization (existing multi-org mechanism) shows the correct, different household and dues for each PTA the parent belongs to.

## Reuse map

| Existing capability | Reused as | New code |
|---|---|---|
| `DuesCharge`/`DuesPayment`/`DuesAdjustment` | Read directly, scoped to the household's billing-identity `OrgMember` | None — same models, same scoping pattern already established in PR #17's `dues.ts` |
| `recordDuesPayment()` (`src/lib/dues-payments.ts`) | Unchanged — still the sole place balance math lives | None |
| `createPaymentReportAndNotify()` (`src/lib/payment-reports.ts`) | Called directly with the household's `OrgMember.id` as `memberId` | None — this is the exact function the base product's `/m/report-payment` already uses |
| `/api/admin/payment-reports/[id]/approve` | Unchanged — approving a PTA-originated report works identically to any other | None |
| `findActivePaymentLink()` (`src/lib/payment-links.ts`) | Unchanged — used to detect whether the org has configured online dues payment | None |
| `/pay/[slug]` Stripe Checkout page + webhook | Unchanged — a parent is sent there exactly like any other payer | None |
| `requirePtaHouseholdSelfAccess()` (PR #17) | Unchanged — the sole authorization guard for every route in this feature | None |
| `PtaProfile` | Read-only (school name, year, membership model, default dues amount) | None |

**No new payment-processing infrastructure was added.** See "Why no automatic payment reconciliation" below for the one significant design decision this required.

## Why no automatic payment reconciliation

Before writing any code, the existing `PaymentLink` → Stripe Checkout → webhook pipeline was read in full. Two facts made "pay online and see your specific charge update automatically" impossible without new engineering:

1. **Checkout session metadata carries no `memberId` or `duesChargeId`** — only `paymentLinkId`, `organizationId`, and a coarse `paymentType` string.
2. **The webhook's `checkout.session.completed` handler always creates a generic, unlinked `Contribution` row** — regardless of the `PaymentLink`'s type (including `DUES`) — never a `DuesPayment`, never a `DuesCharge` status update. This is true platform-wide, not a PTA-specific gap: no member of any organization gets automatic charge-specific reconciliation from a Stripe Checkout payment today.

Building that would mean adding new checkout metadata fields and new webhook branching logic tied to a specific member/charge — genuinely new payment-processing infrastructure, which this feature's own scope explicitly said to avoid unless the existing system is genuinely incapable of the *required* workflow. The required workflow — "a parent can pay and eventually see accurate status" — is fully satisfied by the existing report → officer-approval path, which already updates the charge via `recordDuesPayment()`. So that path is reused instead, and this limitation is documented rather than silently accepted as if instant reconciliation existed.

**Practical effect**: "return from payment and see updated status" is not instant. A parent who pays online should also click "Report this payment" (or an officer notices the online payment through their own Stripe dashboard and records it manually) — either way, an officer's approval is what flips the status. This is called out explicitly in the UI copy, not hidden.

## Authorization design

Every route in this feature is gated by `requirePtaHouseholdSelfAccess()` (unchanged from PR #17's hardening pass):

- Derives the authenticated user and active organization strictly server-side (`requireOrganization()`).
- Passes the PTA Labs gate (`requireOrganizationLabFeature(organizationId, "ptaVertical")`).
- Resolves the caller's household via `PtaHouseholdAdult.userId`, scoped to the active organization — never via a client-supplied household id.
- Rejects a household that is not `ACTIVE` (`PTA_HOUSEHOLD_INACTIVE`).
- Preserves the `MEMBER`-role zero-permission invariant — this guard is deliberately not built on `canDo()`/`requirePermission()`.

On top of this, `getPtaParentDuesSummary()` and `reportPtaDuesPayment()` (`src/lib/labs/pta/parent-dues.ts`) additionally:

- Re-verify the household belongs to the given `organizationId` (defense in depth — even though the guard already resolved it, the household id is still passed as an explicit parameter and re-checked, matching every other PTA lib function's convention).
- Re-verify any `duesChargeId` passed to `reportPtaDuesPayment()` belongs to **both** the correct organization **and** the correct household's own `OrgMember` — a guessed charge id from another organization or another household in the same organization is rejected (`PTA_VALIDATION_ERROR`), never silently accepted or misattributed.
- **A user linked to multiple active households in one organization cannot happen at all** — `PtaHouseholdAdult`'s `@@unique([organizationId, userId])` constraint (the critical fix from PR #17's hardening pass) makes this a schema-level impossibility, not just a handled edge case.
- A household with no billing identity (`orgMemberId` null) returns a safe, empty summary rather than throwing — and `reportPtaDuesPayment()` explicitly rejects with a clear message rather than crashing.

There is no separate "get payment by id" or "get receipt by id" route for a parent to probe with a guessed id — every payment/adjustment/report a parent can see arrives embedded in the single, already-scoped `getPtaParentDuesSummary()` response. This was a deliberate design choice: fewer standalone id-keyed endpoints means less attack surface, not just more test coverage on existing ones.

## Dues status mapping

No new status was invented that isn't backed by real data. Existing `DuesChargeStatus` values map to parent-facing labels:

| Underlying `DuesChargeStatus` | Parent-facing status | Notes |
|---|---|---|
| No `DuesCharge` row exists yet | `NO_CHARGE` | Shown as "No dues charge yet" — not an error |
| `PENDING`, no pending `PaymentReport` | `UNPAID` | |
| `PENDING`, with a `pending` `PaymentReport` against it | `PENDING_REVIEW` | A parent who already reported a payment isn't told to pay again |
| `PARTIAL` | `PARTIALLY_PAID` | Remaining balance computed and shown |
| `PAID` | `PAID` | |
| `WAIVED` | `WAIVED` | |
| `VOID` | `VOIDED` | Historical/cancelled — not currently owed |

**There is no `REFUNDED` status** — the underlying schema has no refund concept for dues at all (`DuesPayment` has no refund field; `DuesAdjustmentType` has no refund-like value). Rather than fabricate one, a refund is represented the same way the existing dues system already represents any adjustment: a `DuesAdjustment` row (typically `WRITE_OFF` or `CREDIT`, with a `reason` explaining it was a refund) is shown verbatim in an "Adjustments" list alongside the charge, in the adjustment's own words — not folded into a made-up status value. This is demonstrated in the fictional seed data (see below).

## Payment initiation

- `GET /api/labs/pta/my-household/dues` returns whether an active `DUES`-type `PaymentLink` exists for the organization (via the unmodified `findActivePaymentLink()`) and, if so, its slug.
- The page links directly to the existing `/pay/[slug]` checkout page — no new Stripe Checkout Session code was written for this feature at all.
- No duplicate-session-prevention logic was needed because no new session-creation code exists to duplicate.
- If no active `DUES` link exists, the page shows clear guidance ("online payment isn't configured for this PTA yet") rather than a broken button or a confusing error.

## External payment-link behavior

Identical to the existing platform-wide behavior for any `PaymentLink` — active/expired/minimum-amount checks are all inherited unchanged from `checkout/route.ts`, which this feature never modifies.

## Stripe test-mode behavior

No automated test in this feature ever calls Stripe. The one place a real Checkout Session would be created (`/pay/[slug]/checkout`) is completely unmodified and untouched by this PR's tests — a parent's "Pay online" button is a plain HTML link to a pre-existing page, not a new fetch/API call this feature owns.

## Receipts

**Dues payments have zero receipt/PDF concept in the codebase today** (confirmed by inspection — `ContributionReceipt` is exclusively for `Contribution` rows, i.e. donations, never `DuesPayment`). Rather than build new receipt/PDF generation (out of scope — the task explicitly said not to create tax-deductibility statements, and a full receipt system is a larger, separately-scoped feature), this PR shows accurate **payment history** (date, amount, method, reference) as the closest existing substitute, which is real data already available on every `DuesCharge`. This is documented as a known limitation, not silently omitted.

## Manual payments, waivers, and refunds — how they render

- A manual payment recorded by an officer (`POST /households/[id]/dues/[chargeId]/payments`, PR #17, unchanged) appears in the parent's payment history exactly like any other `DuesPayment` row — same list, no separate "manual" UI treatment needed since the underlying data already distinguishes method (`CASH`, `CHECK`, etc. vs. `CREDIT_CARD`/`STRIPE`).
- A waived charge (`POST .../waive`, PR #17, unchanged) shows status `WAIVED` and the `DuesAdjustment` (type `WAIVER`) in the adjustments list — never a false "paid" appearance.
- A refund is represented as a `DuesAdjustment` with a reason documenting it (see "Dues status mapping" above) — verified in the fictional seed data on an already-`PAID` charge, confirming a refund note doesn't silently flip the charge back to unpaid or otherwise corrupt its status.

## Prior-year history

`getPtaParentDuesSummary()` returns every `DuesCharge` for the household's `OrgMember`, not just the current period — the "current" charge is whichever one's `periodEnd` is in the future (or the most recent if none is), and every other charge is returned as `priorCharges`, each with its own full payment/adjustment history. Verified against fictional seed data (a household with both a current 2026-2027 charge and a prior, `PAID` 2025-2026 charge).

## Multi-organization behavior

Verified with a real database (`parent-dues-multi-org.integration.test.ts`): the same parent, linked to households in two different organizations, sees the correct — and different — dues summary for each, with a guessed cross-org household or charge id rejected, not silently redirected. Also demonstrated in the fictional seed data: the same seeded PTA president is also a parent household at a second, smaller fictional PTA ("Riverside Elementary PTA") with an entirely separate, unpaid $15 charge.

## UI routes and screens

- `/labs/pta/membership` — the only new page. States handled: no linked household, inactive household, no billing identity yet, no charge yet, no online payment configured, unpaid, partially paid, paid, waived, voided, pending review, prior periods, and the payment-report submission form (with its own pending/success/error states).
- No new officer-facing UI was built — the existing dues-management routes from PR #17 are sufficient for an officer to confirm a household's billing identity, create/adjust a charge, and record/waive payments so the parent view has something meaningful to show.

## Schema changes

**None.** Confirmed via `git diff` against this branch's own base commit (`c837769`): zero changes to `prisma/schema.prisma`, zero new migration files. Every model this feature reads or writes already existed before this PR.

## Known limitations

- No automatic payment-status reconciliation from a Stripe Checkout payment (see "Why no automatic payment reconciliation" above) — this is the single most consequential limitation and a deliberate, documented trade-off, not an oversight.
- No receipt/PDF generation for dues payments — payment history is the closest existing substitute.
- No parent-initiated refund request — refunds remain an officer-only, adjustment-based action, per the task's explicit scope restriction.
- No editing of financial records by a parent — the self-service surface here is entirely read-plus-report, never a write to `DuesCharge`/`DuesPayment` directly.
- A `PARTIAL` status shows the correct remaining balance, but there is no partial-payment-specific messaging beyond the existing generic "Partially paid" label plus the numbers — considered sufficient for this MVP.

## Fictional test data

Extends `prisma/seed-pta-demo.ts` (`npm run db:seed:pta-demo`, idempotent, local/test only, never production):

- Kim Household: dues **waived** (with a `DuesAdjustment` reason).
- Morgan Household: dues **paid**, plus a `DuesAdjustment` (`WRITE_OFF`) documenting a fictional refund — demonstrating the adjustment-based refund representation without a fabricated status.
- Osei Household: dues **unpaid with a pending self-reported `PaymentReport`** — demonstrates the `PENDING_REVIEW` status.
- Chen Household: current-year dues **paid**, plus a **prior school year (2025-2026)** fully paid charge — demonstrates prior-period history.
- Patel Household: unaffected, standard paid scenario from PR #17.
- **Riverside Elementary PTA** — a second, separate fictional organization; the same seeded PTA president is also a parent household there, with its own $15 unpaid charge — demonstrates multi-organization isolation with real, distinguishable data (not just a unit test).

No real parent, student, school, or payment data anywhere in this seed.

## Support troubleshooting

| Symptom | Likely cause | What to check |
|---|---|---|
| Parent sees "No linked household" | The parent's user account has no `PtaHouseholdAdult` row for this organization | An officer needs to add them via `POST /api/labs/pta/households/[id]/adults` with their `userId` |
| Parent sees "Membership not currently active" | The household was deactivated | An officer can reactivate via `PATCH /api/labs/pta/households/[id]` (`status: "ACTIVE"`) |
| No "Pay online" button | No active `DUES`-type `PaymentLink` configured for the org | An officer creates one via the existing `POST /api/payment-links` route (`linkType: "DUES"`) |
| Parent reports a payment but status doesn't change | Reporting only creates a `pending` review — an officer must approve it | Officer reviews via the existing Payment Reports admin page |
| Parent doesn't see a prior year's dues | The prior year's `DuesCharge` was never created (charges aren't generated automatically) | An officer creates it via `POST /api/labs/pta/households/[id]/dues` for that period, if reconstructing historical records is needed |

## Pilot-readiness criteria

- [x] A parent can view their current dues status, amount, and due date without seeing any other household's data (real-database tenant-isolation test).
- [x] A parent can view accurate payment history and adjustments.
- [x] A parent can view prior school-year history.
- [x] A parent can initiate online payment via the org's existing configured method, with clear guidance when none is configured.
- [x] A parent can report a payment for officer review.
- [x] Multi-organization parents see correct, isolated data per organization (real-database test).
- [x] No new schema, no new payment infrastructure, no compliance claim.
- [ ] **Not yet resolved for a real pilot**: whether "report → officer approval" is an acceptable UX for real families (vs. instant reconciliation), and whether a real pilot needs actual receipts/PDFs. Both are product decisions, not engineering ones — see "Recommended next step" in the PR description.
