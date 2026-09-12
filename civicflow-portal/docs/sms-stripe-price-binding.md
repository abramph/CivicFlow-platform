# SMS add-on — production Stripe price binding (PREPARED, NOT APPLIED)

This documents the **later, separately-authorized** production action that turns
on paid self-serve SMS-add-on purchasing. Nothing here has been applied. The
super-admin billing-exempt enrollment path (this PR) does **not** depend on it.

## What was verified first (read-only, 2026-09-12)

Against the **live** Stripe account (APH Technologies, LLC, `livemode: true`):

- Product **"Unestra SMS Add-On"** — active, live.
- Exactly **one** price on it — active, **USD**, **$10.00** (`unit_amount: 1000`),
  **monthly** recurring (`interval: month`, `interval_count: 1`),
  **licensed / non-metered** (`recurring.usage_type: licensed`), `per_unit`.
- No duplicate active SMS price.
- Masked price ID: **`price_1TrU0d…ao5mj`** (the exact ID is held in a secure
  local record for the operator performing the binding; it is intentionally not
  reproduced in this doc, the PR, or chat).

No Stripe object was created, changed, archived, or deleted; no
checkout/customer/subscription/invoice/payment was initiated.

## The production action (do NOT run until separately authorized)

1. Add the environment variable to the **DigitalOcean production** App Platform
   spec for `civicflow-portal`:

   - **Name:** `STRIPE_PRICE_SMS_ADDON_MONTHLY`
   - **Value:** the verified existing live price ID above (paste the exact ID
     from the secure record).
   - **Scope:** RUN_AND_BUILD_TIME, **encrypted**.

   Do **not** create a new Stripe price — bind the existing one.

2. Treat this as a **production redeployment** (the App Platform re-deploys on
   spec change). Wait for the deployment to reach **ACTIVE**.

### Why this is safe

- The variable is **server-only**. It has no `NEXT_PUBLIC_` prefix, so Next.js
  never inlines it into a browser bundle, and it is not referenced by any mobile
  build. It is read only in server code (`src/lib/stripe.ts` →
  `smsAddOnPriceId()`), used to attach a subscription **item** to an org's
  existing paid subscription in `POST /api/billing/sms-addon`.
- Binding the value **does nothing on its own**: it creates no checkout, no
  subscription, no invoice, no entitlement, and sends no SMS. It only makes the
  existing paid purchase route stop failing closed (`smsAddOnPriceId()` currently
  throws because the var is unset). A purchase still requires an org owner to
  click "Add SMS add-on" in Settings → Billing on an org with an active paid
  subscription.
- The price ID is **never returned to clients**: `GET /api/billing/sms-addon`
  returns only `monthlyPriceCents` / `includedMessagesPerMonth` / usage, never
  the Stripe price or subscription-item id.

### Rollback

Remove `STRIPE_PRICE_SMS_ADDON_MONTHLY` from the DO production spec and redeploy.
The purchase route returns to failing closed; no data unwind is needed.

## Post-binding smoke checks (read-only unless noted)

- [ ] Production deployment reaches **ACTIVE** on the new spec.
- [ ] `GET`/`POST /api/billing/sms-addon` remain **authenticated** (401/403 when
      unauthenticated) — no route became public.
- [ ] An **eligible paid org** owner (active paid subscription, add-on not yet
      active) sees the **$10/month SMS add-on** option in Settings → Billing.
- [ ] A **billing-exempt** org does **not** enter the Stripe purchase path (its
      SMS is managed by the super-admin exempt-enrollment flow only).
- [ ] The server **never returns the Stripe price ID** to any client
      (inspect the billing endpoint response — price id absent).
- [ ] **No checkout session** is created during smoke testing (do not click
      "buy" unless a live purchase is separately authorized).
- [ ] **No organization becomes enrolled automatically** — enrollment still
      requires an explicit owner action (paid) or super-admin action (exempt).
- [ ] **Unestra Demo Community** enrollment is unchanged: still Enabled,
      billing-exempt, **1 / 1,000** used, no Stripe subscription item.

## Explicitly out of scope for the binding

Merging the super-admin UI PR, exercising a real paid purchase/checkout,
enrolling any additional organization, and sending any SMS all remain
separately authorization-gated.
