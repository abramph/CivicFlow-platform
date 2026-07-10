# APH Technologies, LLC — Unestra Stripe Setup

Unestra is a product of **APH Technologies, LLC**. This document is the manual, one-time setup
guide for making APH Technologies' own Stripe account the platform account for all Unestra
billing — SaaS subscriptions (`civicflow-portal`) and desktop license sales
(`civicflow-license-server`).

**Scope of this pass:** platform billing only (APH Technologies as seller of Unestra itself).
Stripe Connect — letting individual Unestra customer organizations (e.g. a future ThrivePath
Mental Health Services org, a union, a nonprofit) collect their own member dues/donations into
their *own* Stripe account — does **not exist in the codebase today** and is out of scope for this
document. See [Future work: Stripe Connect](#future-work-stripe-connect) at the bottom.

## Why this document exists

An audit of the deployed production configuration (`.do/app-secrets.yaml`) found that the live
`STRIPE_SECRET_KEY` currently in use belongs to **ThrivePath Mental Health Services**
(`acct_1T1bVGJqzf3AdclZ`, dashboard name "ThrivePath MHS"), not APH Technologies, LLC. This was
confirmed directly via Stripe's `/v1/account` API, not assumed.

**The good news:** that account has **zero completed charges and zero active subscriptions** tied
to Unestra — every Unestra-related checkout session on it (16 total) is `unpaid`/abandoned. No
customer has ever actually paid through it for Unestra. That means the cutover below can happen
cleanly, with no subscriber migration, no billing-continuity risk, and no need to touch real
customer payment methods.

That account *does* however contain at least one product unrelated to Unestra entirely ("SAS
First Communion Photo Access") — confirming it's ThrivePath's own general-purpose business account,
not one that should be billing on APH Technologies' behalf.

---

## 1. Create the APH Technologies, LLC Stripe account

1. Log into the Stripe Dashboard. If you're inside the same Stripe **Organization** as ThrivePath
   MHS, use the account switcher (top-left) — do not assume the org name is the account. An
   Organization can contain multiple distinct Accounts; you need a *new, separate Account* for APH
   Technologies, LLC, not a relabeling of the ThrivePath account.
2. Dashboard → "+ New account" (or via the account switcher's "Add account"). Business name: **APH
   Technologies, LLC**.
3. **Before copying any key**, confirm you have the right account selected: Dashboard → Settings →
   Account details → Business name should read "APH Technologies, LLC", and the account ID
   (Settings → Account details, or via `GET /v1/account`) should **not** be
   `acct_1T1bVGJqzf3AdclZ` (that's ThrivePath's).

## 2. Complete business verification

1. Settings → Business details: legal business name, EIN, business address, industry (Software).
2. Settings → Public business information: support email (e.g. `support@aphtechgroup.com` — do
   not reuse `abram@thrivepathmhs.com`), support phone (optional), statement descriptor (e.g. `APH
   TECHNOLOGIES` or `CIVICFLOW`, 22-char max, no special chars beyond `.`, `-`, `'`, space).
3. Settings → Bank accounts and scheduling: add APH Technologies' own payout bank account. **Do
   not** reuse ThrivePath's bank account here.
4. Complete identity verification (Stripe will prompt for this once enough business details are
   entered) — required before `charges_enabled` will be `true` in live mode.

## 3. Configure Unestra branding

Settings → Branding:
- Icon/logo: Unestra logo.
- Accent color: match Unestra's brand color.
- Business name shown to customers: keep as "APH Technologies, LLC" (the legal/billing entity) —
  Unestra is the product name, APH Technologies is who's charging the card, and Stripe Checkout
  will show both when `product_data.description` is set (see checkout code — already does this).

Settings → Customer emails: enable "Email customers about successful payments" and "Email
customers about failed payments" so receipts go out automatically with this branding.

## 4. Create Unestra Products & Prices

The live ThrivePath account's catalog has drifted (3 duplicate "Unestra Essential" products, 2
duplicate "Unestra Additional Seat" products). Don't recreate that mess — create exactly this set
under the new APH account. Amounts below are extracted directly from `civicflow-portal/src/lib/plans.ts`
(source of truth) and cross-checked against the currently-live prices, which matched exactly.

### SaaS subscription plans (`civicflow-portal`)

| Product | Price nickname | Amount | Interval | Env var |
| --- | --- | --- | --- | --- |
| Unestra Essential | Essential Monthly | $49.00 | month | `STRIPE_PRICE_ESSENTIAL_MONTHLY` |
| Unestra Essential | Essential Yearly | $539.00 | year | `STRIPE_PRICE_ESSENTIAL_YEARLY` |
| Unestra Elite | Elite Monthly | $99.00 | month | `STRIPE_PRICE_ELITE_MONTHLY` |
| Unestra Elite | Elite Yearly | $1,089.00 | year | `STRIPE_PRICE_ELITE_YEARLY` |
| Additional Seat (Essential) | Essential Seat Monthly | $8.00 | month | `STRIPE_PRICE_ESSENTIAL_SEAT_MONTHLY` |
| Additional Seat (Essential) | Essential Seat Yearly | $88.00 | year | `STRIPE_PRICE_ESSENTIAL_SEAT_YEARLY` |
| Additional Seat (Elite) | Elite Seat Monthly | $5.00 | month | `STRIPE_PRICE_ELITE_SEAT_MONTHLY` |
| Additional Seat (Elite) | Elite Seat Yearly | $55.00 | year | `STRIPE_PRICE_ELITE_SEAT_YEARLY` |

All eight are recurring, USD, no trial configured in Stripe itself (trial handling is done
app-side via `getTrialStatus`, not a Stripe subscription trial period). Tax behavior: set to
"exclusive" unless you've confirmed Stripe Tax registration status — check with whoever handles
APH Technologies' tax filings before enabling Stripe Tax collection.

**SMS add-on (currently missing entirely from production):**

`civicflow-portal/src/lib/sms-pricing.ts` expects `STRIPE_PRICE_SMS_ADDON_MONTHLY`, and this var is
**not set** in the current production secrets at all — the SMS add-on billing flow
(`/api/billing/sms-addon`) would throw `Stripe price not configured for the SMS add-on` if any
organization tried to enable it today. Read `SMS_ADDON` in `sms-pricing.ts` for the current
per-message/overage numbers, create the matching recurring Price, and set
`STRIPE_PRICE_SMS_ADDON_MONTHLY`.

### Desktop license sales (`civicflow-license-server`)

| Product | Price nickname | Amount | Type | Env var |
| --- | --- | --- | --- | --- |
| Unestra Professional Desktop License | 5 seats, perpetual | $599.00 | one-time | `STRIPE_PRICE_ID_PERPETUAL_ESSENTIAL` **and** `STRIPE_PRICE_ID_PERPETUAL_ELITE` (see warning) |
| Unestra Annual Maintenance | annual support renewal | $199.00 | one-time | `STRIPE_PRICE_ID_ANNUAL_ESSENTIAL` **and** `STRIPE_PRICE_ID_ANNUAL_ELITE` (see warning) |
| Unestra Additional Seat | per seat add-on | $99.00 | one-time | `STRIPE_PRICE_ID_ADDITIONAL_SEAT` |

> **Confirmed bug — read before creating these.** In the current ThrivePath deployment,
> `STRIPE_PRICE_ID_PERPETUAL_ESSENTIAL` and `STRIPE_PRICE_ID_PERPETUAL_ELITE` point at the *same*
> Price ID, and likewise `ANNUAL_ESSENTIAL`/`ANNUAL_ELITE` share one ID. `getPriceCatalog()` in
> `civicflow-license-server/stripe-license-service.js` builds a lookup keyed by Price ID — when two
> env vars resolve to the same ID, the second one processed (Elite) silently overwrites the first
> (Essential) in that lookup, so an Essential desktop-license purchase currently risks being
> misclassified as Elite. **When creating the APH catalog, create four genuinely distinct Price
> IDs** — a separate Essential-tier and Elite-tier price for both perpetual and annual — even if the
> dollar amounts end up matching the table above (which only reflects what's live today, not
> necessarily what they *should* be — confirm actual Essential vs. Elite desktop pricing with
> whoever owns that product decision; it isn't documented anywhere else in the codebase).

The legacy single-tier vars (`STRIPE_PRICE_ID_PROFESSIONAL`, `STRIPE_PRICE_ID_ANNUAL_MAINTENANCE`)
are also still read by `getPriceCatalog()` and can coexist with the split Essential/Elite ones if
you want to keep a single "Professional" tier as a fallback — check with product ownership on
whether the split pricing is meant to fully replace it.

## 5. Configure the Customer Portal

Settings → Billing → Customer portal:
- Enable it.
- Business information: confirm it shows APH Technologies, LLC.
- Products: allow switching between Essential/Elite, allow canceling.
- Save, then copy the configuration ID if you want to pin
  `STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID` explicitly (optional — `createBillingPortalSession` in
  `civicflow-portal/src/lib/stripe.ts` currently uses the account's default configuration, which is
  sufficient unless you need multiple portal configurations later).

## 6. Register webhook endpoints

Create **two** endpoints (one per deployable):

1. `civicflow-portal` (SaaS subscriptions):
   URL: `https://app.civicflowapp.com/api/webhooks/stripe`
   Events: `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`,
   `invoice.paid`.
   Copy the signing secret → `STRIPE_WEBHOOK_SECRET` (portal).

   > The currently-registered ThrivePath-account webhook for this app points at
   > `civicflow-portal-iule6.ondigitalocean.app` — DigitalOcean's auto-generated hostname, not the
   > custom domain. Register the new one against the custom domain from the start.

2. `civicflow-license-server` (desktop license purchases):
   URL: `https://api.civicflowapp.com/webhooks/stripe`
   Events: at minimum `checkout.session.completed` (the current ThrivePath-account endpoint only
   has 2 events enabled — confirm with `server.js`/`stripe-license-service.js` whether anything
   else is actually handled before subscribing to more).
   Copy the signing secret → `STRIPE_WEBHOOK_SECRET` (license-server; **this is a separate env var
   value from the portal's**, even though both are named `STRIPE_WEBHOOK_SECRET` in their
   respective `.env` files — they're different processes/deployments).

## 7. Where each value goes

| Value | `civicflow-portal` env | `civicflow-license-server` env |
| --- | --- | --- |
| Secret key | `STRIPE_SECRET_KEY` | `STRIPE_SECRET_KEY` |
| Publishable key | `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | — |
| Webhook secret | `STRIPE_WEBHOOK_SECRET` (portal endpoint) | `STRIPE_WEBHOOK_SECRET` (license-server endpoint) |
| SaaS plan prices | `STRIPE_PRICE_ESSENTIAL_MONTHLY`/`_YEARLY`, `STRIPE_PRICE_ELITE_MONTHLY`/`_YEARLY`, 4x `*_SEAT_*` | — |
| SMS add-on price | `STRIPE_PRICE_SMS_ADDON_MONTHLY` | — |
| Desktop license prices | `STRIPE_PRICE_ID_ANNUAL_ESSENTIAL`, `STRIPE_PRICE_ID_ANNUAL_ELITE`, `STRIPE_PRICE_ID_PERPETUAL_ESSENTIAL`, `STRIPE_PRICE_ID_PERPETUAL_ELITE` (all four, see §4 warning) | same four vars |
| Additional seat price | — | `STRIPE_PRICE_ID_ADDITIONAL_SEAT` |

Yes, the desktop license price IDs need to be set on **both** deployables: `civicflow-portal`'s
`/api/store/checkout` route resolves the price ID from its own env and forwards it to
`civicflow-license-server`, which creates the actual Checkout Session using its own Stripe key —
both must be configured with the same Price IDs for this handoff to work.

See `.env.example` in both `civicflow-portal/` and `civicflow-license-server/`, and
`.do/app.yaml` (repo root) for the full annotated list — all three were updated as part of this
change to document every var actually read by the code.

## 8. Test locally with the Stripe CLI

```bash
# civicflow-portal
cd civicflow-portal
npm run stripe:listen    # prints a whsec_... — paste into .env.local as STRIPE_WEBHOOK_SECRET
stripe trigger checkout.session.completed

# civicflow-license-server
cd civicflow-license-server
stripe listen --forward-to http://127.0.0.1:4000/webhooks/stripe
stripe trigger checkout.session.completed
```

Use APH Technologies' **test-mode** keys for all of this (`sk_test_...`/`pk_test_...`) — never live
keys locally.

## 9. Test-mode verification checklist

Run every item below in test mode before touching live keys:

- [ ] SaaS signup: Essential monthly, Essential yearly, Elite monthly, Elite yearly
- [ ] Additional-seat checkout for each plan/interval
- [ ] Failed subscription payment (Stripe test card `4000000000000341`)
- [ ] Subscription cancellation via Customer Portal
- [ ] Customer Portal opens and shows APH Technologies branding
- [ ] Desktop license: new purchase (Essential, then Elite — confirm they resolve to *different*
      Price IDs post-fix)
- [ ] Desktop license: annual renewal, maintenance renewal, seat add-on
- [ ] Payment-link checkout (dues/donation/event/campaign) — this uses the **same** platform
      account today (no Connect), so verify it lands correctly, but see the Connect section below
      for why this isn't the final architecture for organization-collected money
- [ ] Duplicate webhook delivery (resend the same event from the Stripe Dashboard's webhook log) —
      confirm no duplicate `Contribution` or `Subscription` side effects (this is now guarded by
      the new `StripeWebhookEvent` idempotency table; verify the DB migration ran)
- [ ] Invalid webhook signature is rejected with 400
- [ ] Receipt/invoice emails show APH Technologies as the biller, not ThrivePath

## 10. Replacing the current (ThrivePath) values

Once everything above is verified in test mode:

1. In `.do/app-secrets.yaml` (gitignored, not committed — confirmed), replace:
   `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, and all
   `STRIPE_PRICE_*` / `STRIPE_PRICE_ID_*` values with the new APH Technologies **live** values.
2. Do the same in `civicflow-license-server`'s deployed env (wherever that's hosted —
   confirm with whoever manages that deployment; it wasn't part of this repo's `.do/` config).
3. Redeploy both.
4. Re-register both live-mode webhook endpoints under the APH account (test-mode and live-mode
   webhook endpoints are separate in Stripe — the test ones from step 6 don't carry over).
5. Run one real, low-value live subscription test and one real desktop-license test before
   considering the cutover complete.
6. Only after that succeeds, revoke/deactivate the ThrivePath key's usage for Unestra — do **not**
   delete or disable the ThrivePath Stripe account itself; it remains ThrivePath's own account for
   its own business (including that unrelated "SAS First Communion Photo Access" product).

## 11. Rollback

If the APH cutover causes problems in production:

1. Revert `.do/app-secrets.yaml`'s Stripe values to the previous ThrivePath ones (keep a copy set
   aside before step 10 above — do not rely on git history, since this file is gitignored and was
   never committed).
2. Redeploy.
3. Because there were zero live subscriptions at cutover time, rollback carries no risk of
   orphaning a real paying customer's subscription record — the DB `Subscription` table will simply
   have no rows tied to the APH account yet if you roll back before any real signup completes.

## 12. Confirming separation after cutover

- `GET /v1/account` with the new key should return business name "APH Technologies, LLC", not
  ThrivePath.
- `GET /v1/account` with ThrivePath's original key (kept separately, not in this repo) should still
  work and still show ThrivePath — confirming their account wasn't touched.
- No `civicflow-portal` or `civicflow-license-server` code or env should reference
  `abram@thrivepathmhs.com`, `acct_1T1bVGJqzf3AdclZ`, or any ThrivePath-account Price/Product ID.

---

## Future work: Stripe Connect

Not built in this pass. Today, every organization payment link
(`civicflow-portal/src/app/api/pay/[slug]/checkout/route.ts`) creates a Checkout Session on the
**same platform account** as Unestra's own subscription revenue — there is no per-organization
connected account, no `application_fee_amount`, and no tenant isolation for where the money
actually settles. That means, as built today, a ThrivePath-the-customer-organization's member dues
would land in APH Technologies' own Stripe balance, not a ThrivePath-controlled account — which
does not match the "each organization connects its own Stripe account" model described for the
long-term architecture.

Building that properly is a real feature (Connect account creation, Stripe-hosted onboarding,
`account.updated` webhook handling, connected-account Checkout Sessions, and either splitting or
renaming the `Subscription`-vs-payment-link data model so platform billing and connected-account
payments aren't just distinguished by "has a `paymentLinkId` metadata field or not"). Scope and
schedule it separately.
