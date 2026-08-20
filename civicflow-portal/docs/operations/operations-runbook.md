# Operations Runbook

Last verified: 2026-08-10.

## Daily Checks

1. Check production health:
   ```powershell
   curl https://app.getunestra.com/api/health
   ```
   Expected: `{"ok":true,...}`.
2. Check current deployment:
   ```powershell
   doctl apps list-deployments 6e4f35b1-ad49-4c92-b025-97b7d12d7ace --format ID,Phase,Progress,Cause --no-header
   ```
3. Review recent runtime errors:
   ```powershell
   doctl apps logs 6e4f35b1-ad49-4c92-b025-97b7d12d7ace --type run --tail 200
   ```
4. Confirm the latest PostgreSQL backup is current:
   ```powershell
   doctl databases backups 02f47c72-4bdb-4b6f-9105-a92502246128 --format Size,Created --no-header
   ```

## Weekly Checks

- Open Platform Admin Data Health: `/admin/platform/data-health`.
- Export Data Health CSV and verify no unexpected critical/warning growth.
- Confirm Brevo delivery/errors for recent transactional and campaign email.
- Confirm Stripe webhooks have no sustained failures.
- Confirm Twilio inbound webhook health if SMS is active.
- Confirm Sentry receives events if `NEXT_PUBLIC_SENTRY_DSN` is configured.
- Verify object upload/download with a non-sensitive test object or known safe attachment path.
- Re-check `/api/health/deep` from a Platform Admin session. On 2026-08-10 it returned a DO upstream timeout while `/api/health` was healthy, so do not treat it as reliable monitoring until diagnosed.

## Provider Runbooks

### Brevo

Symptoms:

- Password reset or invite emails not arriving.
- Runtime logs show `brevo_request_*` failures or SMTP errors.

Checks:

- `ENABLE_EMAIL_SEND` must be `1`.
- SMTP credentials must be valid.
- `FROM_EMAIL` domain must be verified in Brevo.
- Brevo account must not be over daily send limits.

### Twilio

Symptoms:

- SMS campaign sends fail.
- STOP/START replies do not update member consent.

Checks:

- SMS add-on active for the org.
- Twilio credentials configured in Platform SMS settings or env.
- A2P 10DLC registration complete for US production traffic.
- Inbound webhook points to `/api/webhooks/twilio/inbound`.

### Stripe

Symptoms:

- Checkout fails.
- Billing portal fails.
- Subscription status is stale.

Checks:

- Live secret key and webhook secret configured.
- Webhook endpoint points to `https://app.getunestra.com/api/webhooks/stripe`.
- Required events are enabled.
- `StripeWebhookEvent` records show event receipt and idempotency.

### Spaces

Symptoms:

- Attachments/receipts/imports fail to upload or download.

Checks:

- `DO_SPACES_*` env vars present.
- Bucket exists in `nyc3`.
- App can upload a private object and read it through a signed URL.
- Versioning should be enabled.

### Sentry

Symptoms:

- Runtime logs show errors but no Sentry issue appears.

Checks:

- `NEXT_PUBLIC_SENTRY_DSN` exists in the DO App Platform component env vars.
- Redeploy occurred after setting the DSN.
- CSP permits Sentry ingest if client-side events are expected.
- Sentry alert rules are configured inside Sentry.

## Emergency Commands

Health:

```powershell
curl https://app.getunestra.com/api/health
```

Deployments:

```powershell
doctl apps list-deployments 6e4f35b1-ad49-4c92-b025-97b7d12d7ace --format ID,Phase,Progress,Cause --no-header
```

Runtime logs:

```powershell
doctl apps logs 6e4f35b1-ad49-4c92-b025-97b7d12d7ace --type run --tail 200
```

Build logs:

```powershell
doctl apps logs 6e4f35b1-ad49-4c92-b025-97b7d12d7ace --deployment <deployment-id> --type build
```

Database backups:

```powershell
doctl databases backups 02f47c72-4bdb-4b6f-9105-a92502246128
```

## Escalation

Escalate immediately for:

- App unavailable for all customers.
- Database unavailable or data corruption suspected.
- Cross-tenant data exposure.
- Payment double-charge or lost payment records.
- Credential exposure.
- Missing PostgreSQL backups.

Use `incident-response.md` for severity handling and communication.
