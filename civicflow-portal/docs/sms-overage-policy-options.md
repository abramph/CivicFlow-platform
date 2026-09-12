# SMS Overage Billing — Owner Decision (Option A vs. Option B)

Status: **RESOLVED — Option A selected by the owner on 2026-09-08.**
`SMS_OVERAGE_POLICY = "hard_stop"` in `src/lib/sms-pricing.ts`. Sending stops
at the monthly allowance, enforced by a database-atomic reservation
(`reserveSmsAllowance()` in `src/lib/sms-entitlement.ts`) immediately before
every organization-message Twilio call — strict even under concurrent
senders (proven by `sms-quota-reservation.integration.test.ts` at the exact
999-of-1,000 boundary with 20 racers). All customer-facing $0.02/message
overage promises were removed (billing card, usage-threshold emails, billing
API response, docs); the approved customer wording is:

> "$10/month includes up to 1,000 messages. Sending pauses when the monthly
> allowance is reached; contact support to increase your limit."

The `smsOverageRateCents` DB column and the super-admin cost dashboard
remain as internal-only tooling, never presented as billing behavior.
Option B's design below is retained for future reference only.

Background: the 2026-09 audit found overage was metered
(`OrganizationSmsSettings.smsUsedThisPeriod`) but never invoiced — revenue
leakage and a pricing-integrity problem. Two implementation-ready options:

## Option A — hard stop at the included allowance (`"hard_stop"`)

Sending is blocked once `smsUsedThisPeriod >= smsMonthlyLimit` until the
billing period rolls over (the enforcement code already ships in this branch —
selecting A is a one-word constant change plus copy review).

- **Mechanics:** already implemented in `getSmsEntitlement()`; blocked sends
  fail with an auditable "monthly SMS allowance" reason; org admins already
  get 50/80/90/100% usage-threshold emails (`sms-usage-notifications`), so the
  stop is never a surprise.
- **Required follow-ups if selected:** update the `SmsAddOnCard` copy and any
  marketing copy to stop advertising $0.02 overage (owner-approved wording),
  or reframe it as "contact us to raise your limit" (the super-admin endpoint
  can already raise `smsMonthlyLimit` per org, audited).
- **Safety:** fail-closed; zero billing complexity; no risk of surprise
  charges or unbilled usage. **Revenue leakage: none** (no overage exists).
- **Cost:** a legitimate burst (e.g. an emergency notice near month-end) is
  blocked; mitigation is a super-admin limit raise, which is immediate and
  audited.
- **Effort:** ~0 additional engineering.

## Option B — Stripe metered overage invoicing (`"metered_overage"`)

Restore the soft cap and actually bill $0.02/message over the allowance.
Implementation-ready design:

1. **Stripe objects:** add a metered recurring Price (usage_type=metered,
   monthly, $0.02/unit, aggregate=sum) on the existing SMS add-on product; a
   second subscription item alongside the flat $10 item; env binding
   `STRIPE_PRICE_SMS_ADDON_OVERAGE` (schema + fail-closed helper mirroring
   `smsAddOnPriceId`).
2. **Usage reporting:** report only messages beyond the included 1,000 —
   i.e. `max(0, smsUsedThisPeriod - smsMonthlyLimit)` deltas. Report from a
   cron (not per send) with an idempotency scheme: one usage record per
   (org, billing period, high-water mark), `action=set` with
   `timestamp=period` so retries and crashes cannot double-bill; persist the
   last reported mark on `OrganizationSmsSettings` (new column — requires a
   migration).
3. **Segment rules:** decide whether a "message" is a Twilio segment or a
   logical message. Today `smsUsedThisPeriod` counts logical sends; billing
   by segment requires reading segment counts from the delivery webhook and
   a schema addition. Recommendation within B: bill logical messages first
   (matches current metering), revisit segments later.
4. **Failed sends/credits:** decrement nothing automatically; issue manual
   Stripe credit notes for disputed counts (documented support procedure)
   rather than automated refunds in v1.
5. **Failed payment:** overage rides the existing subscription invoice, so
   `invoice.payment_failed` → existing past_due handling; also fix the known
   looseness where `past_due` still allows sending, or dunning orgs keep
   generating new overage.
6. **Webhook reconciliation:** on `invoice.paid`/`customer.subscription.updated`,
   verify the overage item's reported quantity matches the local high-water
   mark; log + platform-ops risk flag on drift.
7. **Visibility:** invoice line items appear in the existing Stripe-hosted
   invoice; surface "overage billed this period" on `SmsAddOnCard` and the
   admin SMS usage dashboard.
8. **Tests:** idempotent-reporting unit tests (crash between report and
   persist; double cron run), period-rollover boundary, webhook drift
   reconciliation, past_due behavior.
- **Safety:** medium — billing code paths, idempotency, and reconciliation
  all must be right; mistakes overcharge real customers.
- **Revenue leakage: none once shipped;** matches advertised pricing exactly.
- **Effort:** meaningful — new Stripe price + env + migration + cron +
  webhook reconciliation + tests (est. several days incl. review).

## Recommendation (as presented before the decision)

**Option A now, Option B later if overage demand materializes.** Rationale:
(1) safety — A is fail-closed and cannot mis-bill anyone; (2) complexity — A
is already implemented, B is a multi-day billing project with real
overcharge risk; (3) revenue — actual overage demand is zero today (no org
has ever sent a message), so B's revenue upside is currently hypothetical
while its leakage-prevention value is moot under A (nothing unbilled exists);
(4) customer clarity — "you used your 1,000 included messages; raise your
limit or wait for renewal" is clearer than a surprise metered line item.
**Outcome:** the owner selected Option A on 2026-09-08 and approved the
hard-stop wording above; the policy constant, enforcement, and copy changes
shipped together on `fix/sms-addon-compliance-and-entitlement` (PR #196).
Moving to Option B later requires a new explicit owner decision AND the
implementation in §Option B first.
