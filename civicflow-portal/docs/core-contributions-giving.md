# Unestra Core — Contributions, Giving & General Organization 2.0

Program doc (brief §110). Started 2026-08-14, after PTA Vertical 2.0 completed.
Staged PRs CORE-GIVE-A … CORE-GIVE-L; each merged + deployed + production-verified
before the next.

## 0. Audit of the existing payment architecture (§120.1–12)

### The two financial domains as they exist today

**A. Platform billing (organization pays Unestra/APH):**
- `Subscription` model: `stripeCustomerId`, `stripeSubscriptionId`, plan/seats/
  SMS-add-on state. `src/lib/stripe.ts` is entirely this domain: env-configured
  Prices for the essential/elite plans, seat prices, SMS add-on,
  `getOrCreateStripeCustomer(organizationId…)` — **the Stripe Customer today is
  the ORGANIZATION** (stored on Subscription), used exclusively for SaaS billing.
- `billingExempt` on Organization (reviewer/demo orgs) — must remain untouched.

**B. Member money (member/guest pays their organization):**
- `Contribution` (Decimal amount, memberId?/campaignId?/eventId?, contributionDate,
  `ContributionSource` MEMBER_PROFILE/CAMPAIGN_PAGE/EVENT_PAGE/MANUAL/IMPORT,
  void/lock/correction machinery, `ContributionReceipt` + receipt delivery).
- `DuesAccount`/`DuesCharge`/`DuesPayment`: the REQUIRED-OBLIGATION engine —
  balances, due dates, PENDING/PARTIAL/PAID, delinquency automation
  (delinquentAfterMonths etc. on OrgSettings). Already exactly the brief's
  "required dues" model.
- `PaymentLink` (+ methods, offline reports): public `/pay/[slug]` page; card
  payments via **one-time Stripe Checkout Sessions with dynamic `price_data`** —
  no Product/Price sprawl; metadata carries organizationId/paymentLinkId/
  paymentType/campaignId/eventId. Offline methods self-report via
  `PaymentLinkOfflineReport` with officer review.
- `PaymentReport` (member-reported offline dues payments + officer approval),
  `PaymentMethodConfig` (org-configured offline methods), payment-reconciliation
  lib, receipts, Expenditure/BudgetLine/ReimbursementRequest (PTA-H).
- Mobile: `/api/mobile/{dues,payment-history,payment-link,payment-methods,
  report-payment}` — read + report + link handoff; no card entry in-app.

### Where the domains couple today (§120.12)

1. **One Stripe account, one webhook.** `/api/webhooks/stripe` verifies
   signature, dedupes via `StripeWebhookEvent` (unique stripeEventId), then
   branches: `checkout.session.completed` with `session.subscription` → SaaS
   subscription upsert; with `metadata.paymentLinkId` → member money (creates
   `Contribution` or `DuesPayment`). `customer.subscription.*` / `invoice.*`
   are SaaS-only.
2. **No Stripe Connect.** Member payments settle to the platform Stripe account
   and are attributed to organizations by metadata. This is the established
   architecture; CORE-GIVE keeps it and does NOT introduce Connect.
3. **`payment == dues` assumption:** only inside the payment-link webhook branch
   (`paymentType === "dues"` applies to oldest outstanding charge) — correctly
   scoped, not global.
4. **`StripeCustomer == organization`:** true today and SaaS-only. Member-level
   recurring giving (CORE-GIVE-C) will create MEMBER-level Stripe Customers on
   the same platform account, stored on new giving models — NEVER on
   `Subscription`, never resolved through `getOrCreateStripeCustomer` (that
   helper stays SaaS-only; a new `giving-stripe.ts` owns member customers).
5. **`subscription == SaaS`:** holds everywhere today. Recurring giving will NOT
   use `Subscription` rows; schedule state lives on
   `RecurringContributionSchedule` (CORE-GIVE-C).

### Capability matrix

| Capability | Existing | Partial | Missing | Decision |
|---|---|---|---|---|
| Required dues engine (balance/due/delinquency) | ✅ Dues* models + automation | | | Reuse untouched |
| Member-money transaction record | ✅ `Contribution` | lacks fund/program/provider/anonymity/statement fields | | **Extend additively** (no parallel model — one financial history) |
| Contribution receipts | ✅ ContributionReceipt + delivery | | | Reuse |
| One-time card payments | ✅ payment links (dynamic price_data) | not fund-aware; guest-oriented | | Extend in B (member Give Now + fund metadata) |
| Webhook idempotency | ✅ StripeWebhookEvent | | | Reuse pattern |
| Funds | | | ❌ | **New: `Fund` (A)** |
| Contribution programs / obligation nature | | | ❌ | **New: `ContributionProgram` (A)** |
| Voluntary-vs-required server distinction | | dues vs Contribution implies it | not explicit | **Explicit `ObligationNature` (A)** |
| Contribution numbers | | | ❌ | **New allocator CTR-YYYY-NNNNNN (A; stamped on new-module creates from B on)** |
| Saved payment methods (member) | | | ❌ | C |
| Recurring giving schedules | | | ❌ | C (member-level Stripe Customer + app-owned schedule; provider decision in C) |
| Self-service change/pause/resume/cancel | | | ❌ | D |
| Pledges/campaign goals | ✅ Campaign (goal/raised) | no pledges | | E extends Campaign + new Pledge |
| Offline entry | ✅ manual Contribution + PaymentReport | not fund-aware, mixed perms | | F |
| Reconciliation view | ✅ payment-reconciliation lib | dues-centric | | F |
| Annual statements | | receipts only | ❌ statements | G |
| Household attribution/privacy | ✅ PTA households | PTA-specific | generic policy | H |
| Org types beyond 4 verticals | ✅ `OrganizationVertical` (COMMUNITY/UNION/HOA/PTA) | | church/cultural/… | **Deferred to I** (presentation-layer; exhaustive vertical maps make enum widening an I-scope change; flags — not type — gate features per §2) |
| Terminology config | ✅ getVerticalTerminology | | giving labels | A adds `contributionTerminology` setting; I applies presets |
| Public giving page | ✅ /pay/[slug] | link-scoped, not org page | | J |
| Financial RBAC granularity | ✅ contributions:read/write (legacy, broad — STAFF holds them) | | 14 §44 capabilities | **A adds new capability set; legacy perms keep gating legacy surfaces only** |
| Feature flags | ✅ OrgSettings pattern (PtaProfile precedent) | | contributionsEnabled | **A: `OrgSettings.contributionsEnabled` default false** |
| Data Health / observability | ✅ platform data-health + structured logs | | giving checks | K |
| Mobile giving | ✅ dues/report endpoints | | give/recurring | L (store release frozen) |

## 1. CORE-GIVE-A design

**Scope (§105-A):** Fund, ContributionProgram, additive Contribution extension,
explicit obligation nature, capability RBAC, module flag, audit events,
contribution-number allocator. **No charging changes, no member UI, no webhook
changes.** Admin surface: Settings → Contributions & Giving (flag + funds +
programs) — the module's primary admin workflow, complete (§114).

### Schema (all additive)

- `enum GivingModuleStatus { DRAFT ACTIVE INACTIVE CLOSED ARCHIVED }` (shared by
  Fund + ContributionProgram).
- `Fund`: org-scoped designation (§4 fields; `@@unique([organizationId, name])`;
  `onDelete: Restrict` org FK; archivedAt; NEVER hard-deleted — status machine
  with CLOSED/ARCHIVED preventing new use, history preserved).
- `enum ContributionProgramType { DUES VOLUNTARY_CONTRIBUTION SUGGESTED_CONTRIBUTION ONE_TIME_GIVING PLEDGE_CAMPAIGN FUNDRAISER SPECIAL_OFFERING SPONSORSHIP OTHER }`
- `enum ObligationNature { REQUIRED VOLUNTARY }`
- `ContributionProgram`: fundId (Restrict), type, **obligationNature — server
  rule: REQUIRED permitted ONLY when type = DUES; everything else is forced
  VOLUNTARY** (the §5 non-negotiable, enforced in lib, tested). Frequencies as
  string list (WEEKLY/BIWEEKLY/MONTHLY/QUARTERLY/ANNUALLY), suggested/default
  amounts, visibility (MEMBERS/PUBLIC/HIDDEN), receipt/tax config fields.
- `enum TaxDeductibilityClassification { DEDUCTIBILITY_NOT_CONFIGURED ORGANIZATION_MARKED_POTENTIALLY_DEDUCTIBLE NOT_DEDUCTIBLE PARTIALLY_DEDUCTIBLE REQUIRES_REVIEW }` (§31)
- `enum ContributionAnonymityMode { NONE PUBLICLY_ANONYMOUS }` (§20 —
  ORGANIZATION_ANONYMOUS deliberately not offered; provider records identify
  payers and we do not promise impossible anonymity).
- `Contribution` additive columns (all nullable/defaulted; legacy rows valid):
  `fundId?`, `contributionProgramId?`, `contributionNumber?` (unique
  [organizationId, contributionNumber]), `contributorUserId?`, `currency`
  default "USD", `providerPaymentIntentId?`, `providerChargeId?`,
  `providerInvoiceId?` (indexed; today's webhook stores session ids in notes —
  new flows use real columns), `anonymityMode` default NONE,
  `statementEligible` default true, `taxDeductibilityClassification` default
  DEDUCTIBILITY_NOT_CONFIGURED, `goodsServicesValue?`, `pledgeId?` +
  `recurringScheduleId?` reserved-null until E/C ship their tables — NOT added
  in A (no dangling FKs); added by the PR that owns the referenced table.
- `OrgSettings`: `contributionsEnabled` default false, `contributionTerminology?`
  (display label: "Giving", "Contributions", "Support"; null = "Contributions").

### Migration/backfill

Additive only (4 enums, 2 tables, ~10 nullable/defaulted columns, indexes).
No backfill: legacy Contribution rows keep null fund/number (statements code in
G treats null fund as "General (unassigned)"); contribution numbers are stamped
on rows created by the new module only. Index builds are on new/empty or small
columns — no long locks expected. Verified against dev DB before merge.

### Provider ownership (§7, unchanged in A)

Stripe = source of truth for payment execution state; Unestra = source of truth
for meaning/designation/attribution/reporting. Single platform account, no
Connect, metadata attribution, `StripeWebhookEvent` dedup. Member-level
customers/payment methods/recurring: designed in C, absent in A.

### RBAC matrix (new capabilities; §44)

| Capability | OWNER | ORG_ADMIN | FINANCE | STAFF | READ_ONLY |
|---|---|---|---|---|---|
| contributions:summary:view | ✅ | ✅ | ✅ | | |
| contributions:individual:view | ✅ | ✅ | ✅ | | |
| contributions:module:manage | ✅ | ✅ | ✅ | | |
| contributions:offline:create | ✅ | ✅ | ✅ | | |
| contributions:refund | ✅ | ✅ | ✅ | | |
| contributions:export | ✅ | ✅ | ✅ | | |
| contributions:statements:generate | ✅ | ✅ | ✅ | | |
| contributions:recurring:manage | ✅ | ✅ | ✅ | | |
| contributions:pledges:view/manage | ✅ | ✅ | ✅ | | |
| contributions:funds:manage | ✅ | ✅ | ✅ | | |
| contributions:programs:manage | ✅ | ✅ | ✅ | | |
| contributions:reconciliation:view | ✅ | ✅ | ✅ | | |
| contributions:segment | ✅ | ✅ | | | |

Notes: STAFF deliberately gets NONE of the new giving capabilities (§73 least
privilege; §59) even though legacy `contributions:read/write` remain on STAFF
for the existing fundraising surfaces — documented asymmetry, revisited when
legacy surfaces migrate. Separation-of-duties (§46) is organizations trimming
these defaults via the existing OrgRolePermissionSet override system — the
capability granularity exists precisely to allow Financial-Secretary vs
Treasurer splits. `contributions:segment` withheld from FINANCE by default
(communications-adjacent; §43).

### Security & regression risks (A)

- Regression: none expected — no existing write path is modified; webhook,
  dues, payment links untouched. Risk is additive-schema only.
- Enum widening on shared `Contribution` model requires prisma generate
  everywhere it's read (typecheck covers).
- New admin routes must enforce org scoping (standard requirePermission) —
  tenant-isolation tests included.
- Voluntary/required misconfiguration risk handled by server-side rule + test.

### Test plan (A)

Obligation-nature enforcement (REQUIRED↔DUES only, forced VOLUNTARY otherwise);
fund lifecycle (no hard delete; CLOSED/ARCHIVED refuse program attach; archived
fund refuses ACTIVE programs); program-fund tenant isolation; contribution
number format CTR-YYYY-NNNNNN + P2002 retry; flag default-off gating routes
(403 when disabled); RBAC spot checks (STAFF denied); OrgSettings flag write
gated to funds:manage.

## Decisions log

- **2026-08-14 (A):** Extend existing `Contribution` rather than a parallel
  model — one durable financial history, legacy rows stay valid (§69: no
  reclassification; new fields nullable).
- **2026-08-14 (A):** No Stripe Connect; keep platform-account + metadata
  architecture (§7 "use existing architecture").
- **2026-08-14 (A):** Org-type enum expansion deferred to CORE-GIVE-I;
  capabilities/flags — not organization type — gate features (§2).
- **2026-08-14 (A):** ORGANIZATION_ANONYMOUS not offered (§20 honesty rule).
- **2026-08-14 (A):** `pledgeId`/`recurringScheduleId` columns land with their
  owning PRs (E/C), not as dangling columns in A.

## 2. CORE-GIVE-B design — One-Time Giving

**Scope (§105-B):** member Give Now on the `/m` member surface, fund
selection, custom amounts, provider flow, webhook recording, receipts,
contribution history, idempotency. **Guest giving deferred to J** (the public
giving page owns the guest experience; /pay/[slug] links continue serving
guests today) — documented deferral, not architecture debt.

- **Checkout** (`POST /api/giving/checkout`): mirrors the proven
  member-dues-checkout pattern — `requireMemberWebSession`, rate limit,
  server-side validation (module enabled; fund org-scoped + ACTIVE +
  allowOneTime; amount within fund min/max; when a program is chosen it must
  be ACTIVE, belong to the fund, and if `allowCustomAmount=false` the amount
  must be one of its suggested amounts), then a one-time Checkout Session
  with dynamic `price_data`. Metadata is stamped SERVER-SIDE from the
  authenticated session (`paymentType:"giving"`, organizationId, fundId,
  programId, memberId, contributorUserId, anonymityMode, memo) — client
  input is never trusted for attribution (§64 rule applied to web too).
- **Recording** happens ONLY in the webhook (§7: never trust the redirect).
  New `paymentType === "giving"` branch in `checkout.session.completed`,
  ahead of the legacy paymentLinkId branch:
  1. §50 cross-check: the metadata fund must exist IN the metadata
     organization and not be CLOSED/ARCHIVED — mismatch logs a
     security-safe observability event and records nothing;
  2. idempotency belt beyond event-id dedup: skip if a Contribution already
     holds this payment_intent;
  3. create via `withContributionNumber` — fund/program/member/contributor
     attribution, amount+currency from the session, source MEMBER_PROFILE,
     `providerPaymentIntentId`, anonymityMode, program tax classification,
     receipt record via existing `createReceiptForContribution`.
- **Success page** `/m/giving/success` confirms server-side (retrieves the
  session from Stripe; shows the recorded contribution or a
  webhook-still-processing state) — the browser redirect alone never marks
  anything paid.
- **Member surface** `/m/giving`: Give Now (funds with suggested-amount
  chips + custom entry) + contribution history (own rows only, year filter,
  contribution numbers) + link into success/receipt view. Shell nav follows
  the existing static-list convention (page renders a friendly not-enabled
  state, like Violations does for non-HOA).
- **History API** `GET /api/giving/my-contributions`: rows where the caller
  is the member OR the contributor — query-scoped, never filtered client-side.

Decisions: source reuses MEMBER_PROFILE (accurate; no enum widening);
email receipt delivery reuses the existing receipt machinery — the §33
immediate receipt is the success page + history entry + receipt record.
