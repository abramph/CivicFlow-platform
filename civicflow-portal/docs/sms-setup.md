# SMS Add-On Setup (Twilio)

SMS is a paid subscription add-on, not a free feature of any plan. An organization can only send
SMS when both of these are true:

1. `OrganizationSmsSettings.smsAddOnActive` is `true` for that org (enabled via `/settings/billing`
   or synced from Stripe).
2. The org's `Subscription.status` is `active`, `trialing`, or `past_due`.

Every send is re-checked live against these two conditions at send time
(`src/lib/sms-entitlement.ts`) — nothing is cached, so disabling the add-on or a subscription
lapsing takes effect on the very next send attempt.

## 1. Environment variables

These are read directly via `process.env` and are **deliberately excluded** from the strict
`getServerEnv()` schema in `src/lib/env.ts`. Leaving them unset does not crash the app — SMS
sending simply reports "SMS delivery is not configured." instead of attempting delivery.

| Variable | Required for | Example |
| --- | --- | --- |
| `SMS_PROVIDER` | Selecting the provider adapter | `twilio` |
| `TWILIO_ACCOUNT_SID` | Twilio auth | `ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` |
| `SMS_API_KEY` | Twilio auth token; also the HMAC secret for verifying inbound webhook signatures | `your-twilio-auth-token` |
| `SMS_FROM_NUMBER` | The Twilio number messages are sent from, in E.164 format | `+15555550100` |
| `STRIPE_PRICE_SMS_ADDON_MONTHLY` | The Stripe Price ID for the SMS add-on subscription item | `price_xxxxxxxxxxxxx` |

Only `SMS_PROVIDER=twilio` is currently implemented. Any other value (or none) causes `sendSms()`
to no-op with a descriptive `reason`.

## 2. Member phone number format

Member `phone` fields are free text (manual entry or CSV import) and are rarely stored in E.164.
`sendMemberSms()` (`src/lib/sms-service.ts`) normalizes via `normalizeToE164()`
(`src/lib/phone.ts`) before validating or sending: a 10-digit number is assumed North American and
prefixed `+1`; an 11-digit number starting with `1` gets a `+` prefix; anything already in E.164 is
left as-is. Numbers that don't fit one of those shapes (missing digits, non-US numbers without a
`+`, non-numeric junk) fail with "Invalid phone number." and are never sent to Twilio. This does
**not** normalize the stored `OrgMember.phone` value itself — only the number used for the send —
so the inbound STOP/START webhook's `where: { phone: from }` lookup (an exact string match against
Twilio's always-E.164 `From`) can still miss a member whose phone is on file in a different format
than what they texted from. Normalizing `OrgMember.phone` storage itself is a larger, separate
data-migration task, not covered by this feature.

## 3. Twilio account setup

1. Create a Twilio account and a phone number capable of SMS in the region you'll send to.
2. Copy the Account SID and Auth Token from the Twilio Console into `TWILIO_ACCOUNT_SID` and
   `SMS_API_KEY`.
3. Set `SMS_FROM_NUMBER` to the purchased number in E.164 format (e.g. `+15555550100`).
4. **US traffic / A2P 10DLC**: Twilio requires brand and campaign registration (A2P 10DLC) for
   application-to-person SMS traffic to US numbers, or messages may be filtered or blocked by
   carriers. Register the brand/campaign in the Twilio Console (Messaging → Regulatory Compliance)
   before sending production traffic to US recipients. This is a Twilio/carrier requirement, not
   something this codebase can bypass.
5. **Inbound STOP/START webhook**: in the Twilio Console, open the phone number's configuration
   and set "A message comes in" to a `POST` webhook pointing at:
   ```
   https://<your-domain>/api/webhooks/twilio/inbound
   ```
   This endpoint verifies Twilio's `X-Twilio-Signature` header (HMAC-SHA1 using `SMS_API_KEY` as
   the signing secret) before trusting any request — an unsigned or mismatched request gets a 403
   and is never processed. On a verified `STOP`/`STOPALL`/`UNSUBSCRIBE`/`CANCEL`/`END`/`QUIT`, every
   `OrgMember` row with that phone number gets `commsSmsEnabled=false, smsOptedOutAt=<now>`. A
   verified `START`/`YES`/`UNSTOP` clears both fields. This is an application-level second layer —
   Twilio's own carrier-level Advanced Opt-Out is a separate mechanism and should also stay
   enabled.

## 4. DigitalOcean App Platform environment variables

In the DO App Platform dashboard for the `civicflow-portal` app: Settings → App-Level Environment
Variables (or the specific component's environment variables) → add each of the five variables
above as **encrypted** values, then trigger a redeploy (or let the next push deploy them). Do not
commit real values to the repo or to `.env` files tracked by git.

## 5. Stripe: SMS add-on product/price

The SMS add-on is billed as a separate Stripe Subscription Item on the org's existing subscription,
not a new checkout flow:

1. In the Stripe Dashboard, create a recurring Product (e.g. "CivicFlow SMS Add-On") with a
   monthly Price matching `SMS_ADDON.monthlyPriceCents` in `src/lib/sms-pricing.ts` (currently
   $10.00/month, 1,000 included messages, $0.02/message overage — all three values live in that
   one file so pricing changes don't need to be hunted down across the codebase).
2. Copy the Price ID (`price_...`) into `STRIPE_PRICE_SMS_ADDON_MONTHLY`.
3. `POST /api/billing/sms-addon` calls `addSmsAddOnToSubscription()`
   (`stripe.subscriptionItems.create`) to attach that price to the org's existing subscription;
   `DELETE /api/billing/sms-addon` calls `removeSmsAddOnFromSubscription()`
   (`stripe.subscriptionItems.del`) to remove it. Both require `billing:manage` permission.
4. The Stripe webhook handler (`src/app/api/webhooks/stripe/route.ts`) also detects this line item
   on `customer.subscription.updated`/`created` events via `isSmsAddOnPriceId()`, so the add-on
   stays in sync even if changed directly in the Stripe Dashboard (e.g. during dunning or a manual
   support action) rather than through the app's own buttons. `customer.subscription.deleted`
   deactivates the add-on.

Overage (usage past `smsMonthlyLimit` in a billing period) is currently a **soft cap**: sends are
never blocked for being over the limit, only tracked (`SmsMessage.costEstimateCents`,
`OrganizationSmsSettings.smsUsedThisPeriod`) for future invoicing. There is no automated overage
invoicing yet — the Platform Admin dashboard's "Est. Overage Revenue" figure is for visibility, not
an automated charge.

## 6. Testing checklist

Run before any production rollout:

- [ ] `npx vitest run src/lib/__tests__/sms-entitlement.test.ts src/lib/__tests__/sms-service.test.ts src/lib/__tests__/twilio-inbound-webhook.test.ts src/lib/__tests__/communication-campaigns-sms-gate.test.ts`
- [ ] With `SMS_PROVIDER`/`TWILIO_ACCOUNT_SID`/`SMS_API_KEY`/`SMS_FROM_NUMBER` all unset, confirm
      sending an SMS campaign fails gracefully with "SMS delivery is not configured." and does not
      throw a 500.
- [ ] Enable the add-on for a test org (`/settings/billing`), confirm the SMS/Email+SMS channel
      options become selectable in the campaign form, and a real Twilio send succeeds in a Twilio
      test/trial account.
- [ ] Disable the add-on (or let the subscription go `canceled`), confirm SMS is blocked again at
      both the UI level (options greyed out) and the API level (`ValidationError` on
      `POST /api/communications/campaigns`).
- [ ] Send a real STOP reply from a test phone to the configured Twilio number, confirm the
      matching `OrgMember.commsSmsEnabled` flips to `false` and `smsOptedOutAt` is set, and that a
      subsequent campaign send to that member is skipped with "Member opted out of SMS."
- [ ] Send START from the same phone, confirm the member becomes eligible again.
- [ ] Confirm `/admin/platform`'s SMS section reflects real counts after the above sends.

## 7. Production rollout checklist

- [ ] A2P 10DLC brand/campaign registration complete (if sending to US numbers).
- [ ] Production Twilio Account SID/Auth Token/From Number set as DO encrypted env vars (not the
      trial-account credentials used in testing).
- [ ] Twilio phone number's inbound webhook points at the production domain, not a staging URL.
- [ ] `STRIPE_PRICE_SMS_ADDON_MONTHLY` set to the **live-mode** Stripe Price ID (not a test-mode
      price).
- [ ] Stripe webhook endpoint for the production domain includes the subscription
      created/updated/deleted events this feature depends on.
- [ ] Spot-check a real production org's `/settings/billing` page shows accurate limit/used/
      remaining figures before broadly announcing the feature.
