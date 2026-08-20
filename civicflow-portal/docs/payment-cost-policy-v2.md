# Payment-Cost Policy v2 — Obligation-Aware Cost Allocation

Status: IN DEVELOPMENT on `feature/payment-cost-policy-v2`. Not merged, not
deployed. Feature-flagged OFF by default (§15).

The governing rule:

> Stripe processing costs must never reduce the amount credited toward a
> member's underlying obligation.

## 1. Audit findings (2026-08-20)

### 1.1 Every payment-creation path

| # | Path | Nature of payment | Coverage today |
|---|------|-------------------|----------------|
| 1 | `POST /api/giving/checkout` (member web Give Now) | Voluntary giving | Optional, unchecked (CONNECT-F) |
| 2 | `POST /api/public/give` (public giving page) | Voluntary giving | Optional, unchecked (CONNECT-F) |
| 3 | `POST /api/giving/recurring/checkout` (member web) | Voluntary recurring | Boolean election, live preference (CONNECT-F) |
| 4 | `POST /api/mobile/giving/checkout` | Voluntary giving | Optional, unchecked (MOBILE-COVER) |
| 5 | `POST /api/mobile/giving/recurring/checkout` | Voluntary recurring | Boolean election (MOBILE-COVER) |
| 6 | `POST /api/pay/[slug]/checkout` (public payment links) | MIXED: campaign (voluntary), event registration (fixed purchase), dues-in-advance (fixed obligation), general | Optional, unchecked (FEE-COVER-C) |
| 7 | `POST /api/member-portal/dues/checkout` | FIXED OBLIGATION (dues) | Optional, unchecked (FEE-COVER-C) |
| 8 | `src/lib/giving/recurring-self-service.ts` (amount/frequency/coverage changes) | Voluntary recurring | Re-grosses at current rate, boolean preference |
| 9 | Offline: staff dues-payments API, PaymentReport approval flow, mobile admin record-payment, payment imports (incl. `PAYROLL_CHECKOFF` pipeline) | Offline | None (correct) |
| 10 | Unestra Cloud subscription billing (platform account) | Platform SaaS billing | OUT OF SCOPE for this program — explicitly untouched |

All Stripe flows (1-8) are Connect direct charges created ON the connected
account via `resolveConnectedAccountForCharges()` — no platform fallback,
tenant cross-checks and `event.account` verification in both webhooks,
`StripeWebhookEvent` idempotency table. That architecture is kept as-is (§7).

### 1.2 Current "cover processing costs" implementation (CONNECT-F / FEE-COVER-C)

- **Displayed:** member web Give Now, public give, mobile Give (one-time +
  recurring + per-schedule toggle), `/pay/[slug]`, member dues checkout.
- **Calculation:** `gross = ceil((net + fixed) / (1 − p))` from the org's
  OWN configured `processingCostCoveragePercentBps` / `FixedCents`
  (`src/lib/giving/coverage-math.ts`, integer cents). This is an ESTIMATE
  from configured rates — NOT a processor-supported, eligibility-aware
  surcharge. No hardcoded 2.9%+30¢ anywhere.
- **Storage:** split stored separately everywhere —
  `Contribution.processingCostCoverageAmount` / `totalChargedAmount`,
  `DuesPayment.processingCostCoverageAmount` / `totalChargedAmount`;
  principal (`amount`) is ALWAYS base.
- **Dues status:** `DuesCharge.amountPaid/status` settles from
  `DuesPayment.amount` (base) only — **member status has never depended on
  Stripe net payout**. The "$10 paid but $9.41 credited" failure mode does
  not exist in current code. Verified in `src/lib/dues-payments.ts` and by
  the FEE-COVER-C tests.
- **Recurring:** boolean election on the schedule, never a frozen amount;
  re-grossed at the org's current rate on every self-service change.
- **Web/mobile parity:** both send only `coverProcessingCosts: boolean`;
  server quotes authoritatively; injected amounts/rates are structurally
  stripped (zod) and tamper-tested.

### 1.3 Existing obligation-nature model (reused, not duplicated)

Core Contributions & Giving 2.0 already defines the server-enforced
classification this program needs:

- `enum ObligationNature { REQUIRED, VOLUNTARY }` on `ContributionProgram`
  — REQUIRED is legal only for `type DUES`; every other program type is
  voluntary and can never produce debt/arrears (schema doc, enforced at the
  settings-write layer).
- `DuesCharge` is the obligation/invoice row (`amountDue`, `amountPaid`,
  `status`), settled exclusively by base principal.
- `DuesPaymentMethod` already distinguishes offline instruments (CASH,
  CHECK, ACH, ZELLE, …, PAYROLL_CHECKOFF) from STRIPE.

Payment-cost policy v2 derives `PaymentNature` from these existing facts —
it does NOT invent a parallel classification, and it never trusts a
client-supplied nature (§3).

### 1.4 Gaps v2 must close

1. No payment-nature POLICY layer: dues checkout offers coverage as
   *optional* rather than required-where-permitted / org-absorbs.
2. No org-level policy configuration or administrator acknowledgment.
3. No server-side pending payment record before redirect — the (base,
   coverage) snapshot lives only in Stripe session metadata (validated by
   `resolveCoverageSplit`, but §7 requires a first-party record).
4. No capture of the ACTUAL Stripe fee / net deposit
   (balance-transaction data) → no estimate-vs-actual reconciliation.
5. No payment-method eligibility awareness (credit vs debit/prepaid).
6. Dues refunds do not exist at all (pre-existing, documented since
   CONNECT-E) — v2 documents allocation order for the flows that do.

## 2. Payment nature (server-derived)

```
FIXED_OBLIGATION  dues (member-portal dues checkout, dues-type payment
                  links, DUES-type ContributionPrograms/REQUIRED),
                  event-registration payment links, fixed-price purchases
VOLUNTARY         giving (all Give flows), campaign links, VOLUNTARY
                  programs, pledges (non-debt by construction)
OFFLINE           cash/check/ACH-outside-Stripe/payroll-checkoff/admin entry
EXEMPT            resolved policy outcome where the org absorbs the cost
```

Derivation lives in `src/lib/payments/cost-policy.ts` and reads ONLY
server-side facts (link type, program type+obligationNature, route
identity, payment method). Client fields like `isObligation`,
`coverageRequired`, `processingFee`, `amountCredited`, `paymentNature` are
never read; unknown fields are stripped by zod as today.

## 3. Policy resolution

| Nature | Org policy | Resolved behavior |
|---|---|---|
| FIXED_OBLIGATION | `REQUIRED_WHERE_PERMITTED` | Required coverage IF eligibility can be established compliantly; otherwise `ineligiblePaymentMethodFallback` |
| FIXED_OBLIGATION | `ORGANIZATION_ABSORBS` | No payer coverage; member credited full principal |
| VOLUNTARY | `OPTIONAL` | Checkbox, unchecked by default (current behavior) |
| VOLUNTARY | `ORGANIZATION_ABSORBS` | No coverage offered |
| OFFLINE | — | Never any online processing cost |

**Eligibility reality (§7 STOP finding):** Stripe has no generally
available first-party surcharging capability for standard US Connect
accounts that determines card funding type (credit vs debit/prepaid)
before payment and enforces network caps. Unestra therefore CANNOT
compliantly impose a mandatory card surcharge today. Consequence,
implemented deliberately:

- `REQUIRED_WHERE_PERMITTED` resolves at runtime to the configured
  fallback (default `ORGANIZATION_ABSORBS`) for card payments, with the
  member ALWAYS credited full principal — never marked delinquent because
  the org absorbed the fee.
- The `mandatoryObligationCoverage` flag stays OFF until a compliant
  eligibility mechanism exists (Stripe capability, contract, or approved
  provider — an owner decision, reported in §18).
- Voluntary OPTIONAL coverage (payer chooses to add it) remains available
  on all natures where the org enables it — a voluntary opt-in is not a
  surcharge.

## 4. Data model (additive)

- `OrgSettings`: `fixedObligationCoveragePolicy`, `voluntaryCoveragePolicy`,
  `ineligiblePaymentMethodFallback`, `achEnabled`, `policyAcceptedAt`,
  `policyAcceptedByUserId`, `policyVersion`.
- New `PendingPayment` table: server-side pending payment/allocation record
  persisted BEFORE redirect (org, member, purpose, nature, obligation id,
  obligation/coverage/total cents as INTEGER minor units, coverage mode,
  policy version, Stripe session id, idempotency reference, status).
- `Contribution` + `DuesPayment`: `processorFeeActualCents Int?`,
  `netDepositedCents Int?` (filled from balance transactions when
  available), `pendingPaymentId String?`.
- Invariants enforced in code + CHECK-style validation:
  `totalCharged = obligation + processingCost`; allocation = obligation
  principal; negative fees impossible.

## 5. Feature flags (§15)

`paymentCostPolicyV2` (org-level master), `mandatoryObligationCoverage`
(global, OFF — blocked on eligibility), `paymentMethodEligibilityCheck`
(OFF — no compliant source), `paymentCostReconciliation` (fee capture +
reports). Flags OFF ⇒ byte-identical behavior to today.
