# Stripe Setup

CivicFlow's SaaS portal bills organizations via Stripe Subscriptions. Production is confirmed
running in **live mode** (`STRIPE_PUBLISHABLE_KEY` is `pk_live_...`), with all plan/seat price IDs
configured as real Stripe Price objects — not placeholders.

> **Account ownership note:** the live key currently deployed belongs to ThrivePath Mental Health
> Services' Stripe account, not APH Technologies, LLC (CivicFlow's actual owner/operator). Zero
> completed charges or active subscriptions exist on it for CivicFlow, so cutover to a proper APH
> Technologies account is low-risk. See
> [`docs/APH_TECHNOLOGIES_STRIPE_SETUP.md`](../../docs/APH_TECHNOLOGIES_STRIPE_SETUP.md) at the repo
> root for the full cutover plan.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `STRIPE_SECRET_KEY` | Server-side API key (live mode in production) |
| `STRIPE_WEBHOOK_SECRET` | Verifies `POST /api/webhooks/stripe` signatures |
| `STRIPE_PRICE_ESSENTIAL_MONTHLY` / `STRIPE_PRICE_ESSENTIAL_YEARLY` | Essential plan pricing |
| `STRIPE_PRICE_ELITE_MONTHLY` / `STRIPE_PRICE_ELITE_YEARLY` | Elite plan pricing |
| `STRIPE_PRICE_ESSENTIAL_SEAT_MONTHLY` / `STRIPE_PRICE_ESSENTIAL_SEAT_YEARLY` | Additional portal-user seat pricing, Essential |
| `STRIPE_PRICE_ELITE_SEAT_MONTHLY` / `STRIPE_PRICE_ELITE_SEAT_YEARLY` | Additional portal-user seat pricing, Elite |
| `STRIPE_PRICE_SMS_ADDON_MONTHLY` | SMS add-on subscription item — see [`sms-setup.md`](./sms-setup.md). **Confirmed missing entirely from production** as of this audit — the SMS add-on billing flow will throw at runtime until this is set. |

`STRIPE_PRICE_ESSENTIAL_MONTHLY`/`STRIPE_PRICE_ELITE_MONTHLY` are the only two of these considered
optional by `src/lib/env.ts`'s schema; all others are read directly via `process.env` in
`src/lib/stripe.ts` and `src/lib/sms-pricing.ts` rather than the strict schema, so a missing value
fails only the specific checkout/add-on flow that needs it rather than the whole app.

**Note**: the DO app spec for this environment also carries `STRIPE_PRICE_ID_PERPETUAL_*`,
`STRIPE_PRICE_ID_ANNUAL_*`, and `STRIPE_PRICE_ID_ADDITIONAL_SEAT` variables — confirmed these are
read by `civicflow-portal/src/app/api/store/checkout/route.ts`, which resolves the price ID here and
forwards it to `civicflow-license-server`'s own `/api/store/checkout`, which creates the actual
Stripe Checkout Session for desktop license sales using its own Stripe key. Not dead — both
deployables need matching values for this handoff to work. See
[`docs/APH_TECHNOLOGIES_STRIPE_SETUP.md`](../../docs/APH_TECHNOLOGIES_STRIPE_SETUP.md) §4 for a
confirmed bug in how these are currently configured (Essential/Elite sharing one Price ID).

## Stripe account setup

1. **Products & Prices**: create a Product per plan (Essential, Elite) with monthly and yearly
   recurring Prices, plus a "seat" Price per plan for additional portal users beyond the included
   count (`PLANS.essential.includedSeats` / `PLANS.elite.includedSeats` in `src/lib/plans.ts`).
   Copy each Price ID into the matching env var above.
2. **Webhook endpoint**: Stripe Dashboard → Developers → Webhooks → add an endpoint for
   `https://app.civicflowapp.com/api/webhooks/stripe` (the custom domain — the currently-registered
   endpoint on the live ThrivePath account points at the DO-generated
   `civicflow-portal-iule6.ondigitalocean.app` hostname instead; use the custom domain for the new
   one). Subscribe to at minimum: `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed` (used
   to reflect `past_due` status), and `invoice.paid` (renewal confirmation — now handled). Copy the
   endpoint's signing secret into `STRIPE_WEBHOOK_SECRET`. The handler is idempotent: each event is
   recorded in the `StripeWebhookEvent` table before processing, so a Stripe-redelivered event is a
   no-op on replay rather than double-processing.
3. **Billing portal**: enable the Stripe Customer Billing Portal (Dashboard → Settings → Billing →
   Customer portal) — `ManageBillingButton` (`src/components/app/BillingActions.tsx`) creates a
   portal session for orgs with an active subscription so they can update payment methods, view
   invoices, or cancel without a custom UI for each of those flows.
4. **Subscription Items API** (used for the SMS add-on specifically): no separate setup beyond
   creating the add-on Price — `addSmsAddOnToSubscription`/`removeSmsAddOnFromSubscription`
   (`src/lib/stripe.ts`) attach/detach it as a line item on the org's existing subscription via
   `stripe.subscriptionItems.create`/`.del`, rather than a new checkout session.

## Verifying it's working

- `/settings/billing` for an org with an active subscription should show real plan/status/period
  data pulled from the local `Subscription` table, which is kept in sync by the webhook handler.
- Trigger a test event from the Stripe Dashboard's webhook page ("Send test webhook") and confirm
  `doctl apps logs 6e4f35b1-ad49-4c92-b025-97b7d12d7ace --type run` shows no
  `[api-route] Unhandled error` around that timestamp.
- The `/pricing` page and `/settings/billing`'s plan cards both render from the single
  `PLANS` config in `src/lib/plans.ts` — pricing/copy changes only need to happen in one place.
