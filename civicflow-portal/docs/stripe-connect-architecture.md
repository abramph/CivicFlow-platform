# Unestra — Stripe Connect Architecture

Program doc for the CONNECT-A..I migration (brief received 2026-08-14, mid
webhook-incident investigation). Owns: the three-domain financial model, the
audit, the charge-model decision, schema, webhook topology, processing-cost
coverage, RBAC, threat model, migration plan.

## 0. The three financial domains (§1)

| Domain | Money flows | Stripe account | Status |
|---|---|---|---|
| A. Platform SaaS billing | Organization → APH/Unestra | Platform account (`acct_…GsjEn`) | Stays exactly as-is |
| B. Organization member payments | Member/guest → Organization | **The organization's own connected account** | THE MIGRATION |
| C. Optional application fees | Connected charge → platform fee | Connect `application_fee_amount` | Architected, default ZERO, not collected |

APH Technologies must never hold an organization's member money. The
platform account's only member-money transaction ever is the $5.00
synthetic validation gift (see §2 inventory).

## 1. Audit results (2026-08-14, pre-CONNECT-A)

### Connect existence
**None.** Zero references to connected accounts, `on_behalf_of`,
`transfer_data`, `application_fee`, or `Stripe-Account` headers anywhere in
the portal. One platform Stripe account serves everything.

### Payment-flow matrix (§2 of the brief)

| Payment flow | Current Stripe account | Intended account | Migration required |
|---|---|---|---|
| Unestra SaaS billing (`stripe.ts`, Subscription) | Platform | Platform | **None** (stays) |
| Member dues checkout (`/api/member-portal/dues/checkout`) | Platform | Connected | CONNECT-E |
| Payment links (`/pay/[slug]`, dues/campaign/event) | Platform | Connected | CONNECT-E |
| One-time Giving (member web + mobile) | Platform | Connected | CONNECT-C |
| Public Giving (`/give/[slug]`, guests) | Platform | Connected | CONNECT-C |
| Recurring Giving (GivingCustomer + subscriptions + org product) | Platform | Connected | CONNECT-D |
| Recurring self-service (D-era) | Platform | Connected | CONNECT-D |
| Pledges | No provider objects (credit via contributions) | n/a | Attribution only |
| Refunds (K-era) | Platform | Original charge's account | CONNECT-C+ (§17) |
| Disputes (K-era mirror) | Platform | Connected-account context | CONNECT-G |
| Reconciliation sweep | Platform listing | Per-connected-account listing | CONNECT-G |

### Stripe call sites (all platform-account today)
`src/lib/stripe.ts` (SaaS-only, stays), `giving/giving-stripe.ts`,
`giving/recurring-self-service.ts`, `giving/refunds.ts`,
`giving/reconciliation.ts`, `platform-operations/health.ts`, and route-level
session creation in: giving/checkout, giving/recurring/checkout,
mobile/giving/checkout, mobile/giving/recurring/checkout, public/give,
pay/[slug]/checkout, member-portal/dues/checkout, webhooks/stripe.

### §75 SaaS billing safety determination
Platform Billing admin shows **0 active / 0 trialing / 0 past-due /
0 cancelled / 0 unpaid subscriptions, $0.00 MRR, zero Subscription rows**
(three orgs carry manually-set "Elite" plan labels with no Stripe linkage).
**The broken webhook endangers no SaaS billing today.** Per §74, the
webhook-secret correction is deferred to CONNECT-G.

### §53 real-transaction inventory
The platform account's complete successful-payment history is **exactly one
payment**: $5.00 (`pi_3U4MdCJe9g4GsjEn0cwFqbpb`, 2026-08-14, Link, paid by
the owner during assisted validation). Zero real customer member payments
exist. Classification: **HISTORICAL_PLATFORM_TEST (§52)** — it remains on
the platform account forever (provider objects are not movable), stays
unrecorded app-side until CONNECT-G/H reconciliation decides its treatment
(candidates: record-then-refund from the platform account, or refund
untracked and document). No migration STOP triggered.

### §74 webhook incident record (do not lose)
- Endpoint `we_1TrU0gJe9g4GsjEndebyeAUM` was registered at
  `https://app.civicflowapp.com/api/webhooks/stripe` (pre-migration domain);
  6 events subscribed; **100% delivery failure**.
- URL corrected to `app.getunestra.com` 2026-08-14 (same endpoint, secret
  unchanged). Manual resend STILL failed 400 `Invalid Stripe signature` →
  **the deployed `STRIPE_WEBHOOK_SECRET` does not match this endpoint's
  signing secret**. Deferred to CONNECT-G (no SaaS impact, above).
- The webhook route returns 400 on signature failure **silently** (no log
  line) — observability defect; fix lands with the CONNECT-G webhook work.
- Second failing endpoint `https://api.civicflowapp.com/webhooks/stripe`
  (2 events) belongs to the cloud-api deployable — OUT of portal scope;
  flagged for its own follow-up.

### §60 legacy-domain audit (code)
`civicflowapp.com` appears in: the two Stripe endpoints (portal one now
fixed), historical docs/reports, and marketing-redirect notes. No portal
code path constructs civicflowapp URLs. Historical records left untouched.

## 2. Charge-model decision (§8/§9/§48)

**Standard connected accounts + direct charges.**

Rationale:
- §77's target — "the church receives the funds through its Stripe
  account" — is direct charges' native shape: the charge, balance,
  customer, receipt, dispute, and payout all live on the connected account.
- **Standard** accounts give organizations their own full Stripe dashboard
  (§50: payments/payouts/disputes/bank/tax visibility without Unestra
  rebuilding it), Stripe-hosted onboarding/KYC (§3: no custom KYC ever),
  and the strongest liability separation: with Standard + direct charges,
  **the connected account is the merchant of record, pays Stripe's
  processing fees, and bears negative-balance/dispute liability** (§48
  documented; platform is not the fee payer).
- Destination charges/separate transfers are rejected: both settle funds
  through the platform first — exactly what the §1 principle forbids —
  and are justified only by products that need platform-side money
  aggregation, which Unestra explicitly does not want.
- Application fees (domain C) remain available on direct charges via
  `application_fee_amount`; architected, default zero, never collected
  without explicit product approval (§49).

## 3. Schema (CONNECT-A, all additive)

- `enum StripeAccountStatus { ONBOARDING_STARTED ACTION_REQUIRED CONNECTED
  PAYMENTS_ENABLED RESTRICTED DISABLED }` — NOT_CONNECTED is the absence of
  a row; PAYOUTS_PENDING is presented in UI from `payoutsEnabled=false`
  while PAYMENTS_ENABLED (not a stored state).
- `model OrganizationStripeAccount` — §4 fields verbatim; `organizationId`
  unique (one account per org until a business rule says otherwise) and
  `stripeAccountId` unique (an `acct_…` id is an identifier, never a
  secret; no credentials are ever stored).
- `model OrganizationMemberStripeCustomer` (§11) — (organization, user,
  connected account) → `cus_…`; unique per (organizationId, userId,
  stripeConnectedAccountId). The A-era `GivingCustomer` remains as the
  LEGACY platform-context record; CONNECT-D stops writing it.
- Immutable attribution (§56): `Contribution.stripeConnectedAccountId` +
  `Contribution.providerAccountContext` (`LEGACY_PLATFORM_PAYMENT |
  CONNECTED_ACCOUNT_PAYMENT`), same pair on
  `RecurringContributionSchedule`. Existing rows: context backfilled
  LEGACY_PLATFORM_PAYMENT where a provider reference exists, else null.
  Refunds/disputes/reconciliation resolve the account from the ROW, never
  from current org settings (§56: reconnection-safe).
- §57 considered: a generic `PaymentProviderAccount` is deliberately NOT
  built — one provider exists; renaming later is cheaper than abstracting
  now.

## 4. Webhook topology (§19–§23, §58) — implemented in CONNECT-G

- **Two endpoints, two secrets, one handler file per concern:**
  - Platform: `/api/webhooks/stripe` (existing URL) — SaaS billing events
    only, secret env `STRIPE_WEBHOOK_SECRET` (kept name; it becomes
    platform-only by subscription pruning, documented to avoid ambiguity).
  - Connect: `/api/webhooks/stripe-connect` — "Events on connected
    accounts" endpoint; secret env `STRIPE_CONNECT_WEBHOOK_SECRET`.
- Tenant resolution (§20): `event.account` (`acct_…`) →
  `OrganizationStripeAccount` → organization → internal object. Metadata is
  a CROSS-CHECK only (§23); account-context is the primary signal. No
  mapping → no financial mutation + security log (same F/§50 discipline).
- Idempotency: the existing `StripeWebhookEvent` unique-event-id dedup +
  per-object belts continue, keyed with account context.
- Recovery order (§59) executes at CONNECT-G, including the deferred
  platform-secret correction and controlled replay of the $5 event.

## 5. Optional processing-cost coverage (§28–§47) — CONNECT-F

- Org setting `processingCostCoverageEnabled` with mode enum `OFF |
  OPTIONAL_CONTRIBUTOR_COVERAGE | STRIPE_SURCHARGE`; ship
  OPTIONAL_CONTRIBUTOR_COVERAGE only; STRIPE_SURCHARGE stays a
  feature-flagged future program behind compliance validation (§66).
- Calculation: configurable `(percentBps, fixedCents)` per org; gross-up
  `gross = ceil((net + fixed) / (1 − p))` in integer cents; UI always says
  "Estimated processing costs", never "Stripe fee" (§33). No hardcoded
  2.9%+30¢ anywhere (§30).
- Accounting: `baseContributionAmount` + `processingCostCoverageAmount` +
  `totalChargedAmount` stored separately (§36); coverage is NOT fund
  principal (§37); receipts and statements show the split (§38/§39);
  recurring stores `coverProcessingCosts` boolean, never a frozen dollar
  amount (§40); member can toggle without cancelling (§41), audited;
  org admins can never silently enable coverage on an existing member
  schedule (§43); refunds account for both components (§45).

## 6. RBAC (§25)

| Capability | OWNER | ADMIN | FINANCE | STAFF |
|---|---|---|---|---|
| `payments:stripe:view` | ✓ | ✓ | ✓ | — |
| `payments:stripe:refresh` | ✓ | ✓ | ✓ | — |
| `payments:stripe:connect` | ✓ | ✓ | — | — |
| `payments:stripe:manage` (incl. disconnect workflow) | ✓ | ✓ | — | — |

Reconciliation stays on the existing `contributions:reconciliation:view`.
Disconnect is a controlled workflow (§26), never a casual button, and never
deletes historical `acct_` identifiers (disabled state only).

## 7. Security threat model (§61) — review gates CONNECT-C rollout

1. **Connected-account substitution** — no client-supplied `acct_…`
   anywhere (§10): every charge context resolves session → organization →
   `OrganizationStripeAccount` server-side. Mobile identical (§70).
2. **Cross-tenant checkout** — org resolution comes from the authenticated
   session / slug lookup, account from the org row; §62.1/.2 tests.
3. **Webhook account spoofing** — events accepted only from
   signature-verified Stripe payloads; `event.account` must map to a known
   `OrganizationStripeAccount` AND match the internal object's stored
   attribution; mismatch → no mutation + log.
4. **Refund misdirection** — refunds issue against the row's immutable
   `stripeConnectedAccountId`, never current settings (§17/§62.4).
5. **Customer/payment-method crossover** — customers are per
   (org, user, connected account) (§11); no cross-account reuse (§62.6/.7).
6. **Public giving fallback** — an org without `charges_enabled` shows
   "Online giving is temporarily unavailable"; there is NO platform-account
   fallback path in code (§14/§62.8).
7. **Onboarding hijacking / Account-Link misuse** — account links are
   created server-side for the caller's own org only, single-use,
   Stripe-expiring; return URLs are fixed app routes; return does NOT mark
   connected — only a server-side account fetch does (§6).
8. **Legacy coexistence** — LEGACY rows are read-only history; new charges
   require CONNECTED context once each flow migrates; §54 visibility via
   Data Health.

## 8. Migration risks & compatibility (§52–§56, §73)

- Provider objects never move accounts; nothing is reassigned or rewritten.
- Demo Community giving data = HISTORICAL_PLATFORM_TEST (kept, labeled).
- Legacy flows keep working on the platform account until their CONNECT-C/D/E
  PR moves them behind the §55 activation gate with per-org transition
  ("Payments Setup Required" for payment-active orgs, §7 — no abrupt break).
- The frozen vc4 mobile binary only reads dues/payment-link endpoints; those
  migrate in CONNECT-E with response shapes unchanged (§71 backward-compat).

## 9. Regression test plan

- §62 invariants 1–14 as authorization/unit tests (grown per PR).
- Per-PR: the moving flow's full existing suite (giving/dues) must stay
  green with only account-context assertions added.
- CONNECT-G: live controlled replay of the $5 event; duplicate replay
  no-ops; platform + connect endpoints verified with real deliveries.
- CONNECT-I: Demo Church connects a TEST-MODE connected account and runs
  onboarding → payment → recurring → refund → requirement-state → public
  giving end-to-end (no real payouts).

## 10. Program staging (§72)

A Architecture & Schema → B Org onboarding (Connect flow + status + gate) →
C One-time + public giving on direct charges → D Recurring on connected
context → E Dues + events + payment links → F Processing-cost coverage →
G Webhook separation & recovery (incl. deferred secret fix + replay) →
H Historical reconciliation → I Demo Church on test-mode Connect.
Each PR merges + deploys + production-verifies before the next.

## Decisions log

- **2026-08-14 (A):** Standard accounts + direct charges (rationale §2).
- **2026-08-14 (A):** SaaS billing not endangered (0 subscriptions) →
  webhook secret fix deferred to CONNECT-G per §74.
- **2026-08-14 (A):** Platform account's only member-money transaction ever
  is the $5 synthetic validation gift → HISTORICAL_PLATFORM_TEST; no real
  migration inventory exists.
- **2026-08-14 (A):** No generic PaymentProviderAccount abstraction (§57
  anti-over-engineering clause).
- **2026-08-14 (A):** `STRIPE_WEBHOOK_SECRET` keeps its name as the
  platform-billing secret; `STRIPE_CONNECT_WEBHOOK_SECRET` is new in G.
