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

- `OrgSettings.paymentCostPolicyV2Enabled` — per-org master switch
  (default false ⇒ byte-identical legacy behavior for every flow).
- `MANDATORY_OBLIGATION_COVERAGE` (env, default off) — global gate on
  required coverage; MUST stay off until a compliant card-eligibility
  mechanism exists.
- `PAYMENT_METHOD_ELIGIBILITY_CHECK` (env, default off) — asserts such a
  mechanism exists. Both env flags AND the org's §6 acknowledgment are
  required before any checkout renders required coverage.
- `PAYMENT_COST_RECONCILIATION` (env, default on) — actual-fee capture.

Rollback = flip the org flag off (legacy behavior returns instantly); the
schema is additive, so application-level rollback needs no migration.

## 6. Why Stripe net payout never determines member status

`DuesCharge` settles exclusively from `DuesPayment.amount` — the BASE
principal. Coverage, the actual Stripe fee, and the net deposit live in
separate columns (`processingCostCoverageAmount`, `totalChargedAmount`,
`processorFeeActualCents`, `netDepositedCents`) that no status, campaign,
statement, or balance computation reads. A member who owes $10 and pays
$10 is credited $10 whether the org absorbed the fee, the payer covered
it, or the actual fee differed from the estimate.

## 7. Refund allocation order (§11)

- Full refund: reverses the obligation/contribution allocation under the
  existing (CONNECT-F/K) refund mechanics; the refund ceiling is
  `totalChargedAmount ?? amount`, so payer-covered coverage is refunded
  with it. What happened to the coverage component is visible as
  (refund total − principal).
- Partial refund: allocation order is PRINCIPAL FIRST — a partial refund
  reduces the obligation/contribution principal up to `amount`, and only
  the excess beyond principal is a coverage reversal. A processing-
  cost-only adjustment therefore never silently reopens an obligation.
- Failed payments record nothing (webhook-only recording).
- Dues refunds: no DuesPayment refund mechanism exists (pre-existing,
  documented since CONNECT-E) — unchanged by this program.
- Stripe not returning its own fee on refund is an ORGANIZATION expense,
  visible in reconciliation (fee captured, refund recorded) — never a
  member balance.

## 8. Recurring payments (§9)

- Recurring voluntary giving keeps the CONNECT-F model: the election is a
  live boolean on the schedule, re-grossed at the org's CURRENT rate on
  every self-service change; donors can change it any time; statements
  exclude coverage. The schedule row itself is the §7 first-party record
  for subscription checkouts (created PENDING_SETUP before redirect).
- Recurring fixed obligations: no recurring-dues product exists today
  (dues are charged per-period and paid per-charge). If one ships, each
  installment resolves the fixed-obligation policy at billing time and
  totals may not change without the recurring-authorization disclosures.

## 9. Reconciliation fields (§10)

Per successful online payment: principal (`amount`), payer-covered
estimate (`processingCostCoverageAmount`), exact charge
(`totalChargedAmount`), actual Stripe fee (`processorFeeActualCents`),
net deposit (`netDepositedCents`), organization-absorbed amount
(= actual fee − payer-covered, floored at 0), pending-record linkage
(`pendingPaymentId`), and the authorized-vs-paid verdict on the
`PendingPayment` row (COMPLETED / MISMATCHED + reason). The payer-covered
estimate and the actual fee are NOT assumed equal.

## 10. Administrator-facing explanation (plain language)

> When someone pays online, the card processor keeps a small fee. Unestra
> always credits the payer the full amount they intended to pay — the fee
> is your organization's expense unless the payer chooses (or, where
> lawful and technically supported in the future, is asked) to add it on
> top. You choose the policy for donations and for dues/tickets
> separately. Debit and prepaid cards cannot legally carry a surcharge in
> most places, so "required" coverage only activates where the platform
> can tell card types apart — until then Unestra protects you by falling
> back to the option you configure. No member is ever marked behind on
> dues because of a card fee.

## 11. §7 STOP report — missing Stripe capability

Mandatory, eligibility-aware card surcharging needs a capability Stripe
does not offer generally today for standard US Connect platforms
(funding-type detection + network-cap enforcement before confirmation).
Options if the owner wants required coverage on cards: Stripe's invite-
only/regional surcharging programs (account approval + contracts), a
third-party surcharge provider (new contract + integration), or keeping
the shipped model (voluntary opt-in + org-absorb fallback, ACH restrict
option). Affected: every connected account. Safest launch fallback
(implemented as default): ORGANIZATION_ABSORBS with full principal
crediting.

## 12. Launch model (LAUNCH-SAFE, owner-decided 2026-08-20)

The owner chose the launch-safe configuration; the settings surface and
API enforce it:

- No Stripe surcharge program / third-party surcharge integration
  pre-launch. `MANDATORY_OBLIGATION_COVERAGE` and
  `PAYMENT_METHOD_ELIGIBILITY_CHECK` stay OFF; the cost-policy API answers
  409 to `REQUIRED_WHERE_PERMITTED` even from an authenticated owner who
  accepts the policy, and the settings page presents required coverage as
  a described-but-unavailable capability, never a choosable option.
- Fixed obligations launch as ORGANIZATION_ABSORBS: members are credited
  the full amount they pay toward the obligation, always.
- Voluntary giving keeps the optional, unchecked coverage checkbox.
- ACH is the sanctioned cost-reduction path
  (`fixedObligationPaymentPreference`): CARD_AND_ABSORB (default),
  PREFER_ACH (restricts to ["us_bank_account","card"], bank listed
  first), REQUIRE_ACH (["us_bank_account"] only) — selectable only when
  `achEnabled` is true, otherwise 409 + locked in the UI. REQUIRE_ACH
  fail-safes to card+absorb with an offline-alternatives message rather
  than ever blocking a member.
- Offline payments (cash, check, payroll checkoff) are completely
  fee-free: no PendingPayment, no coverage, no fee fields.
- Mobile builds: iOS build 25 / Android vc14 remain the release
  candidates — no client contract changed (boolean-only coverage opt-in,
  server-priced totals), zero mobile source touched.

### §5 verification matrix

The full 24-case local matrix (real Stripe test-mode checkouts on a test
connected account, stripe-CLI-forwarded webhooks, dev DB) is recorded in
the LAUNCH-SAFE handoff report. Highlights: absorb-mode fixed obligations
credit the exact principal; gross-up nets the org exactly the principal
on covered gifts; ACH success settles only on
`checkout.session.async_payment_succeeded` (actual ACH fee on $10 was
8¢ vs 59¢ card); ACH failure records nothing and leaves the charge
PENDING; tampered pending records are MISMATCHED and never settle;
hostile client fields never affect server-derived nature or totals;
webhook replays are deduplicated.

### Stripe API-version hazard found by the matrix (fixed)

At Stripe API 2025-03+ ("basil"/"dahlia") the invoice payload no longer
carries top-level `invoice.subscription` (moved to
`invoice.parent.subscription_details.subscription`) or
`invoice.payment_intent`. Both webhooks previously read the legacy field
and silently skipped recurring-gift recording (and SaaS past_due
handling) when it was absent — production only worked because its
endpoint pins an older API version. Fixed via `invoiceSubscriptionId()`
reading both shapes, plus an error log when a subscription-billed
invoice yields no id. Known degradation under new API versions:
`payment_intent` is absent from the invoice payload, so recurring-gift
actual-fee capture is skipped (reconciliation-only data; fillable by a
later sweep).

### Micro-deposit note (ACH §2)

Manually entered bank accounts require micro-deposit verification before
the debit runs (`payment_intent.requires_action`); Financial-Connections
instant verification does not. Support runbooks should expect
Processing → (verify) → Paid/Failed for manual-entry members.
