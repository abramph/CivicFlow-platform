# Brevo (Email/SMTP) Setup

Unestra sends transactional email (verification, password reset, receipts, reminders,
communication campaigns) via SMTP through `nodemailer` (`src/lib/mail.ts`) — there is no direct
Brevo transactional-API integration, only SMTP relay.

## Environment variables

| Variable | Example | Notes |
| --- | --- | --- |
| `SMTP_HOST` | `smtp-relay.brevo.com` | Brevo's SMTP relay hostname |
| `SMTP_PORT` | `587` | STARTTLS port. `src/lib/mail.ts` sets `secure: true` only when the port is exactly `465` — for `587`, `nodemailer` upgrades via STARTTLS automatically |
| `SMTP_USER` | your Brevo SMTP login (an email address, shown in Brevo's SMTP & API settings) | |
| `SMTP_PASS` | your Brevo SMTP key (not your Brevo account password) | Generate under Brevo → SMTP & API → SMTP tab |
| `FROM_EMAIL` | `Unestra Notifications <notifications@getunestra.com>` | Must be a **verified sender** in Brevo (see below) or Brevo will reject/bounce the send |
| `ENABLE_EMAIL_SEND` | `"1"` | Safety switch — without this set to `"1"`/`"true"`, `sendEmail()` no-ops (`skipped: true`) instead of attempting delivery. Useful for staging/dev; must be `"1"` in production or no email of any kind (including password reset) will ever send. |

## Brevo account setup

1. **Verify the sending domain** (Brevo → Senders, Domains & Dedicated IPs → Domains): add
   `getunestra.com` (or whatever domain `FROM_EMAIL` uses), and add the SPF/DKIM DNS records
   Brevo provides at your DNS host. **This must happen before `FROM_EMAIL` is switched to
   `notifications@getunestra.com` in production** — an unverified sending domain is the most
   common cause of emails being silently dropped, bounced, or landing in spam even though the
   SMTP transaction itself reports success — nodemailer/SMTP only confirms the message was
   *accepted* by Brevo's relay, not that it was actually delivered to the recipient's inbox.
   `civicflowapp.com` should stay verified in Brevo in parallel until the new domain is confirmed
   working end-to-end.
2. **Verify the sender address** itself (Brevo → Senders) if using single-sender verification
   instead of full domain verification.
3. **Get SMTP credentials**: Brevo → SMTP & API → SMTP tab shows the SMTP login (usually your
   Brevo account email) and lets you generate an SMTP key (this is `SMTP_PASS`, not your account
   login password).
4. **Authorized IPs / security settings**: Brevo accounts can have an "Authorized IPs" security
   feature that blocks API/SMTP access from IPs not on an allowlist. If this is enabled on the
   account, DigitalOcean App Platform's outbound IP(s) must be added, or SMTP authentication will
   fail. Check Brevo → Security settings if sends are failing with an authentication error in
   `doctl apps logs ... --type run` (search for `[api-route] Unhandled error` or
   `[forgot-password] Failed to send`).
5. **Sending limits**: Brevo's free/lower tiers cap daily send volume — check the account's plan
   limits if campaign sends to large recipient lists start failing partway through.

## Verifying it's working

```
curl -X POST https://civicflow-portal-iule6.ondigitalocean.app/api/auth/forgot-password \
  -H "Content-Type: application/json" -d '{"email":"you@example.org"}'
```
This always returns `{"ok":true,...}` regardless of whether the email exists or whether sending
succeeded (by design — see the security note in `forgot-password/route.ts`). To actually confirm
delivery, check the real inbox, or check runtime logs for a `[forgot-password] Failed to send
password reset email:` line, which only appears when the underlying SMTP send throws.

## Known gap

Email send failures are logged (`console.error` + `Sentry.captureException`) but, since
`NEXT_PUBLIC_SENTRY_DSN` is not currently configured in production (see
[`production-deployment.md`](./production-deployment.md)), there is no active alerting on send
failures today — someone has to go looking in `doctl apps logs`.
