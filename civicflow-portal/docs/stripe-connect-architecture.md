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

## 4. Webhook topology (§19–§23, §58) — **minimal slice pulled forward into
CONNECT-C** (see the CONNECT-C entry below); full separation work
(secret-recovery replay, broader event coverage for D/E) remains at G.

- **Two endpoints, two secrets, one handler file per concern:**
  - Platform: `/api/webhooks/stripe` (existing URL) — SaaS billing events
    only, secret env `STRIPE_WEBHOOK_SECRET` (kept name; it becomes
    platform-only by subscription pruning, documented to avoid ambiguity).
  - Connect: `/api/webhooks/stripe-connect` — "Events on connected
    accounts" endpoint; secret env `STRIPE_CONNECT_WEBHOOK_SECRET`. Shipped
    in CONNECT-C scoped to `checkout.session.completed` (giving +
    public-giving), `charge.refunded`, `charge.dispute.created/closed` — the
    minimum needed to make direct-charge one-time/public giving real and
    testable, per the program's own "no PR ships untestable" discipline.
- Tenant resolution (§20): `event.account` (`acct_…`) →
  `OrganizationStripeAccount` → organization → internal object. Metadata is
  a CROSS-CHECK only (§23); account-context is the primary signal. No
  mapping → no financial mutation + security log (same F/§50 discipline).
- Idempotency: the existing `StripeWebhookEvent` unique-event-id dedup +
  per-object belts continue, keyed with account context.
- Recovery order (§59) executes at CONNECT-G, including the deferred
  platform-secret correction and controlled replay of the $5 event. This is
  UNCHANGED by the CONNECT-C pull-forward: the new endpoint only ever
  receives NEW connected-account events, never the stuck $5 platform event.

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

## 11. CONNECT-C — one-time + public giving on direct charges (implemented)

- **Checkout (member web `/api/giving/checkout`, mobile
  `/api/mobile/giving/checkout`, public `/api/public/give`):** each route
  now calls `resolveConnectedAccountForCharges(organizationId)` (§10/§55 —
  org-only signature, no client-supplied account) before creating a
  session, uses `getStripeForMode(accountMode)` for the matching
  test/live data plane, and passes `{ stripeAccount: stripeConnectedAccountId }`
  as the session-create request option — the connected account becomes the
  merchant of record (§2 direct-charge decision). A 409 from the resolver
  (`Payments are not set up…` / `…needs additional information…`) is the
  ONLY outcome when an org hasn't connected or isn't charges-enabled —
  there is no code path back to the platform account (§14/§55).
- **Public giving page (`getPublicGivingPage`):** added a
  `chargesEnabled && !disabledAt` gate; when false, `funds: []` is
  returned (the identical "not accepting online gifts" empty-state the
  page already had for zero published funds) rather than a working form —
  §14's "temporarily unavailable" behavior with no new UI surface.
- **New webhook `/api/webhooks/stripe-connect`:** built per the §4 topology
  above (pulled forward from G). `event.account` resolves the org via
  `OrganizationStripeAccount.stripeAccountId` (unique); `session.metadata
  .organizationId`, when present, is cross-checked and a mismatch is
  rejected + logged, never trusted alone (§20/§23). Reuses the SAME
  `recordGivingContribution` / `recordPublicGivingContribution` /
  `applyProviderRefund` / `applyDisputeStatus` functions as the platform
  webhook — no forked business logic, only a different tenant-resolution
  and account-scoping wrapper.
- **Old platform webhook (`/api/webhooks/stripe`):** the `paymentType ===
  "giving"` / `"public-giving"` branches were REMOVED (not left dead) —
  once checkout sessions are created against the connected account, their
  `checkout.session.completed` events physically cannot arrive on the
  platform's "Events on your account" stream.
- **Attribution (§56):** `RecordGivingInput`/`RecordPublicGivingInput` now
  REQUIRE `stripeConnectedAccountId`; every Contribution row created
  through these paths stamps `stripeConnectedAccountId` +
  `providerAccountContext: CONNECTED_ACCOUNT_PAYMENT` immutably. Pre-C
  historical rows (if any existed — §53 found none from real member money)
  are untouched; no backfill migration.
- **Refunds (§17):** `issueRefund` resolves the Stripe client + `{
  stripeAccount }` option from the CONTRIBUTION'S OWN
  `stripeConnectedAccountId` (via a fresh `OrganizationStripeAccount`
  lookup by that id, not the org's current settings) when
  `providerAccountContext === CONNECTED_ACCOUNT_PAYMENT`; legacy/null rows
  keep using the platform client with no `stripeAccount` option, unchanged.
- **Scope not covered here (deferred, unblocked by nothing in C):**
  recurring giving (D), dues/events/payment-links (E), processing-cost
  coverage (F), the live-mode counterpart of the new webhook endpoint
  (needed only once a real org — not just test-mode Demo Church —
  completes onboarding), and the full G-scope webhook separation
  (`STRIPE_WEBHOOK_SECRET` recovery + $5 event replay).

## 12. CONNECT-D — recurring giving on connected accounts (implemented)

- **Scope:** every Stripe call site touching a recurring giving subscription
  now resolves the CONNECTED account — nine call sites in
  `recurring-self-service.ts` (change amount/frequency, pause, resume,
  cancel, retry, payment-method start/apply, plus the shared subscription-item
  lookup) via a new `getStripeForSchedule(schedule)` helper mirroring
  CONNECT-C's refund pattern: null `stripeConnectedAccountId` → platform
  client, no `stripeAccount` option (legacy schedules, unchanged); a stamped
  connected account → look up its mode via `OrganizationStripeAccount`,
  `getStripeForMode`, pass `{stripeAccount}`. The schedule's OWN immutable
  attribution drives every mutation — never the org's current settings.
- **Checkout (`giving/recurring/checkout`, `mobile/giving/recurring/checkout`):**
  same §10/§55 gate as C (`resolveConnectedAccountForCharges`, 409-only, no
  platform fallback), then a NEW connected-account customer/product pair —
  `getOrCreateConnectedGivingCustomer` (writes
  `OrganizationMemberStripeCustomer`, unique per org+user+connected-account,
  CONNECT-A §11) and `getOrCreateConnectedGivingProduct` (a Product created
  ON the connected account, since products are account-scoped in Stripe;
  cached on the same `OrgSettings.givingStripeProductId` field, assuming one
  connected account per org's active lifetime — documented, not enforced).
  The LEGACY `getOrCreateGivingCustomer`/`getOrCreateGivingProduct`/
  `GivingCustomer` stay untouched and unused by new checkouts, per CONNECT-A's
  own note that CONNECT-D stops writing them.
- **Attribution (§56):** `linkScheduleFromCheckout` stamps
  `stripeConnectedAccountId` + `providerAccountContext` on the schedule at
  linkage time; `recordRecurringInvoicePaid` reads those two fields straight
  off the already-resolved schedule row (never re-derived from the invoice)
  when stamping each recurring Contribution.
- **Webhook — LEGACY COEXISTENCE, unlike C's full removal:** CONNECT-C could
  remove its old-webhook branches outright because its own audit (§53) proved
  zero real platform-account one-time contributions ever existed. CONNECT-D's
  audit could not rule out a pre-existing recurring subscription already
  running on the platform account (a PENDING_SETUP or just-started schedule
  that never generated a payment would leave no trace in §53's
  transaction-history audit). So: the giving-recurring branches were ADDED to
  `/api/webhooks/stripe-connect` (checkout.session.completed,
  customer.subscription.created/updated/deleted, invoice.paid,
  invoice.payment_failed) for all NEW connected-account subscriptions, and
  the equivalent branches in the OLD `/api/webhooks/stripe` were LEFT IN
  PLACE — not removed — as the only path for any subscription that might
  still be running on the platform account. Also added to the connect
  webhook: the `giving-method-update` setup-mode session branch.
- **Not covered here:** dues/events/payment links (E), processing-cost
  coverage on recurring schedules (F), and confirming — via CONNECT-I's
  Demo Church test-mode validation — whether any real platform-account
  recurring schedule actually exists (the legacy-coexistence code handles it
  either way, but the question itself is unresolved).

## 13. CONNECT-E — dues, campaign/event, and payment-link contributions (implemented)

- **Real-usage audit (before writing any code, mirroring §1's own discipline):**
  unlike C and D, payment links are the OLDER feature — the audit couldn't
  assume zero real usage by construction. Checked all 14 platform orgs: 4
  are explicitly internal/billing-exempt (the Demo orgs + APH itself); of
  the remaining 10, every one checked (Harris PTA, Pine Grove School PTA)
  showed either zero payment links or clear synthetic-QA signatures
  (`.example` email domains — the RFC 2606 reserved test TLD, fictional
  names, audit events clustered in single QA-walkthrough sessions). No real
  Stripe revenue exists on the platform account via payment links. Same
  conclusion as C's audit, reached independently rather than assumed —
  confirmed with the user before proceeding. Cleared the same hard
  §14/§55 gate (409-only, no platform fallback) for immediate use, matching
  C and D — no soft transition period needed.
- **Scope:** the two Stripe-session-creating checkout routes —
  `/api/pay/[slug]/checkout` (public campaign/event/dues via a public
  payment link; ONLY invoked for the STRIPE payment method specifically —
  manual/offline methods on the same link are untouched by this gate) and
  `/api/member-portal/dues/checkout` (authenticated member "pay dues now")
  — both gate on `resolveConnectedAccountForCharges` and pass
  `{stripeAccount}`, identical discipline to C/D.
- **Schema (additive):** `DuesPayment` gained the same
  `stripeConnectedAccountId` + `providerAccountContext` pair as
  Contribution/RecurringContributionSchedule (migration
  `20260815180000_connect_e_dues_payment_attribution`). `recordDuesPayment`
  takes them as optional params — offline/manual entries (the vast
  majority of callers: staff manual entry, payment-report approval, mobile
  admin) simply omit them and stay null; only the Stripe webhook path
  stamps them.
- **Webhook — same legacy-coexistence pattern as D, more strongly
  warranted here:** the `paymentLinkId` branch (dues via
  `recordDuesPayment`, campaign/event/general via a Contribution create)
  was ADDED to `/api/webhooks/stripe-connect` for new payment-link
  checkouts, and the OLD platform webhook's identical branch was left in
  place untouched — payment links are the platform's oldest revenue
  feature, so "no pre-existing usage" is a weaker assumption here than for
  C or D even though this audit's finding was the same (zero).
- **Not covered here:** processing-cost coverage on payment-link
  contributions (F — not built for this flow at all yet, one-time/recurring
  giving only), and no refund mechanism exists for `DuesPayment` today
  (confirmed pre-existing gap, not introduced or fixed by this PR — only
  `Contribution` rows support `issueRefund`, and payment-link
  campaign/event Contributions already get that for free via C's own fix
  since `issueRefund` works on any Contribution row regardless of source).
- **Live verification (2026-08-15):** created a real `general`-type payment
  link on Demo Church (Stripe method only, $5.00, no campaign/event
  attribution) via impersonation, then completed the public `/pay/[slug]`
  checkout as an anonymous payer with a real Stripe test card. Confirmed
  end-to-end: (1) the Stripe Checkout page rendered "Demo-church" as the
  merchant and "Pay securely at Demo-church" — proving the session was
  created on the connected account, not the platform; (2) after payment,
  the link's `Total Uses` incremented 0 → 1; (3) a new `Contribution` row
  appeared in Demo Church's ledger with `source: MANUAL` (no
  campaign/eventId, as expected for a general link), payment method
  Stripe, receipt requested (email was supplied), and
  `notes: "Payment link: <id>"` — matching the new connect-webhook branch
  exactly. This is the same public/anonymous-checkout path used for C's
  own live verification, now proven on the E-added `paymentLinkId` branch.

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
- **2026-08-15 (C):** Pulled forward the MINIMUM slice of G's webhook
  separation (new endpoint, new secret, `event.account` tenant resolution)
  into C rather than shipping checkout-side direct charges with no working
  webhook path — an untestable PR would violate the program's own
  per-PR-verified discipline. Full G scope (secret recovery, $5 replay,
  broader D/E event coverage) is unchanged and still deferred.
- **2026-08-15 (C):** `STRIPE_CONNECT_WEBHOOK_SECRET` ships as a single
  TEST-mode secret for now (Demo Church is the only connected account that
  exists). A live-mode counterpart is added whenever the first real org
  completes live Connect onboarding — not preemptively built in C.
- **2026-08-15 (C):** Creating the actual Stripe webhook endpoint (an
  account-configuration change) requires the user's explicit permission —
  code shipped in this PR is inert until that endpoint exists; see the
  PR's own notes for the pending ask.
- **2026-08-15 (D):** Unlike C, the OLD platform webhook's giving-recurring
  branches are NOT removed — D's audit couldn't rule out a pre-existing
  platform-account subscription the way C's audit ruled out pre-existing
  one-time contributions. Both webhooks now carry the giving-recurring
  logic; the connect webhook handles everything created after D ships.
- **2026-08-15 (D):** Products are account-scoped in Stripe, so
  `getOrCreateConnectedGivingProduct` creates a NEW product on the connected
  account rather than reusing any platform-account product id. Cached on
  the existing `OrgSettings.givingStripeProductId` field under the
  assumption of one connected account per org's active lifetime (true today
  per CONNECT-A §26 — accounts are disabled, never replaced).
- **2026-08-15 (E):** Ran the real-usage audit E's own scope demanded
  (payment links predate this whole program) rather than assuming C's
  zero-usage finding carried over. Same conclusion, reached independently:
  no real org has payment-link Stripe revenue today, confirmed via a live
  platform-admin check (not just inference) before proceeding with the
  same hard gate as C/D.
- **2026-08-15 (E):** `DuesPayment` has no refund mechanism at all
  (pre-existing gap) — not built as part of this PR. Only `Contribution`
  rows support `issueRefund`; payment-link campaign/event contributions
  already inherit correct connected-account refund resolution from C's fix
  since that function is source-agnostic.
