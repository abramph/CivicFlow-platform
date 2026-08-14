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

## 3. CORE-GIVE-C design — Saved Payment Methods & Recurring Giving

### The §10 provider decision: Stripe Subscriptions own recurring execution

Two candidate architectures were evaluated:

1. **App-scheduled off-session PaymentIntents** (own scheduler charges saved
   methods): full control, but Unestra owns scheduling, timezone math,
   retries, and scheduler idempotency — and the repo audit shows /api/cron/*
   endpoints have NO in-repo scheduler invoking them. A recurring-money
   engine cannot depend on a scheduler that does not reliably fire.
2. **Stripe Subscriptions with inline `price_data`** (CHOSEN): Stripe owns
   the billing cycle, off-session charging, Smart Retries, and dunning
   state; Unestra owns meaning and the schedule record. **Retry authority =
   Stripe, exclusively** (§17: exactly one retry authority; our webhook only
   mirrors state, never re-charges).

Price-sprawl control (§10): one Stripe Product PER ORGANIZATION
("<org> — Recurring Contribution"), lazily created and cached on
`OrgSettings.givingStripeProductId`; every subscription uses inline
`price_data` referencing that product with the member's chosen
`unit_amount` + interval. No per-amount Price precreation, no orphan
products. Frequency map: WEEKLY {week,1}, BIWEEKLY {week,2}, MONTHLY
{month,1}, QUARTERLY {month,3}, ANNUALLY {year,1}.

Amount changes (D) will use subscription-item updates with
`proration_behavior: "none"` — voluntary contribution schedules must never
generate surprise prorations (§12).

### Member-level Stripe Customers (the boundary, enforced)

New `GivingCustomer` model: `@@unique([organizationId, userId])` →
`stripeCustomerId`. Member customers are created ONLY through
`src/lib/giving/giving-stripe.ts`; `getOrCreateStripeCustomer` (SaaS) is
untouched and the two can never resolve each other's customers. Payment
methods are collected exclusively by Stripe Checkout (subscription mode) —
no card data ever touches Unestra (§8); the schedule stores the provider
payment-method id + safe display descriptor only. Full method management
(add/replace/default) is CORE-GIVE-D scope with "change payment method".

### The SaaS/giving webhook split — THE regression risk, handled explicitly

Today `customer.subscription.*` and `invoice.*` are SaaS-only. Giving
subscriptions carry `metadata.paymentType = "giving-recurring"` (+
scheduleId/organizationId/fundId), and EVERY relevant webhook branch now
checks it FIRST:
- `checkout.session.completed` with a subscription: giving metadata → link
  `providerSubscriptionId` to the schedule and activate; otherwise the
  legacy SaaS upsert runs exactly as before.
- `customer.subscription.updated/deleted`: giving → mirror schedule status
  (paused/cancelled); SaaS path untouched otherwise.
- `invoice.paid`: giving → record a Contribution **idempotent on the
  invoice id**, stamp schedule success state + next date from the period
  end; SaaS path otherwise.
- `invoice.payment_failed`: giving → schedule PAYMENT_FAILED /
  PAYMENT_ACTION_REQUIRED + failureCount, member notification copy is
  §16-safe ("could not be processed" — NEVER "you owe"); SaaS otherwise.
A giving event must never touch the `Subscription` table (test-asserted).

### §50 cross-checks for recurring
Webhook handlers resolve the schedule BY ID from metadata and verify it
belongs to the metadata organization AND (for invoices) that the paid
amount matches the schedule amount within the invoice's own line data —
mismatches mirror nothing and log a security-safe event.

### Scope & consent
- Create + view in C: member picks fund/amount/frequency; §91 consent copy
  (amount, frequency, fund, start, cancel-anytime) shown before redirect;
  §92 duplicate-schedule guard server-side (409 unless explicitly
  confirmed). Change/pause/resume/cancel/self-service = D (per §105).
- Currency: USD only in v1, enforced explicitly (§77).
- Statuses: PENDING_SETUP → ACTIVE → (PAYMENT_ACTION_REQUIRED |
  PAYMENT_FAILED → recovery via D) | PAUSED (D) | CANCELLED | COMPLETED.

### Payment-flow security review (§72, pre-recurring — this PR)
- Cross-tenant: schedules/customers resolved org+user-scoped in every query;
  webhook metadata cross-checked against the schedule row (never trusted
  alone); GivingCustomer unique per (org,user).
- IDOR/takeover: schedule ids never accepted from clients for mutation in C
  (no mutation surface yet); list APIs query-scope to the session user.
- Amount/fund/currency manipulation: the charge amount comes from the
  server-validated schedule row at session creation; metadata carries ids
  only; invoice recording uses provider-truth amounts and re-verifies the
  schedule linkage; currency pinned USD.
- Webhook forgery/replay: signature verification + StripeWebhookEvent dedup
  + invoice-id contribution idempotency (triple layer).
- Secrets: publishable/secret keys server-side only; Checkout URLs are the
  only thing the browser sees; no raw card data anywhere (§111.14/15).
- Voluntary invariant: failure paths set schedule state and notify — they
  never create DuesCharge rows, arrears, or member-status changes
  (§112/§113; test-asserted).
Findings: no critical/high items open; MEDIUM noted — org-level Stripe
Products are platform-account-visible across orgs in the Stripe dashboard
(inherent to the no-Connect architecture, accepted and documented).

## 4. CORE-GIVE-D design — Member Recurring Self-Service

Every action is member-owned and provider-first:
`authorizeOwnSchedule(org, user, scheduleId)` resolves the schedule ONLY when
`contributorUserId` matches the session user inside the session org (§111.5 —
foreign schedules answer 404); the Stripe mutation runs first, and the
schedule row updates only after provider success (a provider failure changes
nothing locally). Every change is audited with before/after and emails the
member (§61) via the existing transactional mail path.

- **Change amount (§12)**: subscription item updated with new inline
  `price_data` (same product/interval) + `proration_behavior: "none"` — the
  new amount applies at the NEXT scheduled contribution; the UI says exactly
  that before confirmation. Audit carries old/new/effective framing.
- **Change frequency (§13)**: same item-replacement with the new interval,
  `proration_behavior: "none"`, billing anchor unchanged — the already-
  scheduled next date stays; the gap AFTER it uses the new frequency. The
  UI states this before mutation; no duplicate charges are possible because
  nothing is invoiced at change time.
- **Change payment method (§8)**: a Stripe Checkout SETUP-mode session for
  the member's giving customer (card data never touches Unestra); the
  webhook (`mode=setup`, `paymentType=giving-method-update`) attaches the
  new method as the subscription default, updates the stored descriptor,
  and — if the schedule was in a failed state — leaves recovery to Stripe's
  retries plus the explicit Try Again action.
- **Pause (§14)**: `pause_collection { behavior: "void" }` — skipped periods
  are VOIDED, never accumulated, so resuming cannot surprise-charge for
  missed time. v1 is pause-indefinitely (documented choice). Membership and
  dues are untouched by construction.
- **Resume**: clears pause_collection, re-reads the subscription for the
  real next date, shows it. No immediate charge.
- **Cancel (§15)**: immediate provider cancel — "no future contribution will
  be scheduled" is literally true; history preserved; reason OPTIONAL from
  the fixed list; zero retention patterns.
- **Try Again (§16)**: pays the latest open invoice for the schedule's own
  subscription; success flows through the normal invoice.paid recording.
  Failure copy never says "you owe".

Retry authority remains Stripe alone (§17) — Try Again is a member-initiated
payment of an existing open invoice, not a second retry engine.

## 5. CORE-GIVE-E design — Pledges & Campaigns

A pledge is a STATED INTENTION, never enforceable debt (§22): the UI says
"Remaining toward pledge", progress is computed live from credited
contributions, and nothing anywhere converts an unpaid pledge balance into
arrears, dues, or delinquency.

- **`Pledge`**: org/fund/contributor-scoped intention with pledgedAmount,
  optional campaign + target date, status ACTIVE/FULFILLED/CANCELLED/
  EXPIRED/ARCHIVED. Members create their own pledges on pledge-enabled
  funds (`fund.allowPledges`); officers with `contributions:pledges:manage`
  can record one for a member. Progress = SUM of non-void contributions
  carrying `pledgeId` — never stored, never double-counted.
- **Allocation (§23), no-double-count by construction**: one contribution
  credits AT MOST one pledge via `Contribution.pledgeId`. v1 supports
  EXPLICIT designation only (give-toward-pledge at checkout, or a recurring
  schedule pinned to a pledge via new `RecurringContributionSchedule.pledgeId`
  — every invoice contribution inherits it). Auto-allocation and split
  allocation are deliberately deferred (§41): explicit is auditable and
  cannot surprise anyone.
- **§50 for pledges**: checkout validates the pledge belongs to the caller,
  the org, and the SAME fund; the webhook re-verifies that linkage — a
  mismatched pledge id records the contribution WITHOUT pledge credit (the
  money is real; the credit is not) and logs a security-safe event.
- **Fulfillment**: when a recorded credit crosses the pledged amount the
  status flips to FULFILLED once, audited — display always derives from the
  live sum regardless.
- **Campaigns (§24)**: additive `Campaign.fundId` links a campaign to its
  designated fund; pledges may reference a campaign; campaign totals
  (pledged / received toward pledges) are computed endpoints. Existing
  campaign raised-math is untouched — zero regression surface on the legacy
  fundraising flow. Public per-donor exposure unchanged (none).
- **Member surface**: My Pledges cards (Pledged / Contributed / **Remaining
  toward pledge** / progress bar), pledge creation on pledge-enabled funds,
  and "Give toward pledge" prefilling Give Now. Officer surface: pledge
  list + campaign pledge totals on the giving setup page (full reporting
  arrives in K).
