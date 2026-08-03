# Credential Rotation Runbook

Every secret Unestra depends on in production, where it lives, and the exact steps to rotate it —
written so an on-call responder (not just whoever originally wired it up) can act during a real
compromise or scheduled rotation without reverse-engineering the app spec first.

## Where secrets live

Two different storage mechanisms, and rotation looks different for each:

1. **DigitalOcean App Platform environment variables** (`doctl apps spec get <app-id>`, or the DO
   console → App Platform → Unestra → Settings → App-Level Environment Variables). Changing one of
   these requires a redeploy to take effect (`doctl apps update <app-id> --spec <file>`, or editing
   directly in the console, which redeploys automatically).
2. **Database-stored, app-encrypted secrets** — currently only Twilio/SMS credentials
   (`PlatformSmsSettings`, encrypted at rest with `SMS_CREDENTIAL_ENCRYPTION_KEY` via
   `src/lib/crypto-secrets.ts`). Rotated through the product UI itself
   (`/admin/platform/sms` → SMS Administration), not by editing the database directly, and not by a
   redeploy.

## Rotation procedures, by credential

### Database (`DATABASE_URL`)

DigitalOcean Managed PostgreSQL connection string, including the `doadmin` password.

1. In the DO console: Databases → `civicflowprod` → Connection Details → **Reset Password** (or
   rotate via a dedicated DB user if one is later split out from `doadmin`).
2. Update `DATABASE_URL` in the App Platform app spec with the new password.
3. Redeploy. Prisma's connection pool picks up the new value on next connection; no code change
   needed since `src/lib/prisma.ts` reads `DATABASE_URL` at process start.
4. Confirm `/api/health/deep` (platform-admin-only) reports `database: { ok: true }` post-deploy.

### Stripe (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`)

1. Stripe Dashboard → Developers → API keys → **Roll key** for the secret key (publishable key
   rotation is optional/rarely needed — it's not sensitive by design).
2. If the webhook signing secret is also being rotated: Developers → Webhooks → the endpoint → Roll
   secret.
3. Update all three values in the App Platform app spec and redeploy.
4. Stripe keeps the old secret key valid for a short overlap window after rolling — confirm the new
   deploy is live and processing a real webhook (e.g. trigger a test event from the Stripe dashboard)
   before the old key's grace period ends, so no billing events are dropped mid-rotation.
5. `StripeWebhookEvent`'s unique constraint on `stripeEventId` (see `prisma/schema.prisma`) makes
   webhook redelivery safe if Stripe retries during the cutover — no risk of duplicate processing.

### Object storage (`DO_SPACES_ACCESS_KEY_ID`, `DO_SPACES_SECRET_ACCESS_KEY`)

1. DO console → API → Spaces Keys → generate a new key pair.
2. Update both values in the App Platform app spec and redeploy.
3. Revoke the old key pair only after confirming the new deploy can read/write (`/api/health/deep`
   reports `objectStorage: { ok: true }` — note this only checks that the env vars are *present*,
   not that the credentials actually authenticate, so also manually verify a real upload/download,
   e.g. viewing an existing member document, before revoking the old key).

### Outbound email (`SMTP_HOST`/`SMTP_USER`/`SMTP_PASS`, Brevo)

1. Brevo dashboard → SMTP & API → generate a new SMTP key (do not reuse the old password — Brevo
   issues a distinct credential per rotation).
2. Update `SMTP_PASS` (and `SMTP_USER` if the sending identity also changed) in the app spec and
   redeploy.
3. Send a real test email through the app (e.g. trigger a password-reset) and confirm delivery
   before revoking the old Brevo SMTP key.

### Auth session signing (`NEXTAUTH_SECRET`)

This is the most disruptive rotation — changing it invalidates **every** existing session and MFA
challenge token immediately (next-auth signs/verifies all JWTs with this single secret; there is no
dual-key/overlap support).

1. Generate a new value (`openssl rand -base64 32` or equivalent).
2. Update `NEXTAUTH_SECRET` in the app spec and redeploy.
3. Every signed-in user is logged out on their next request and must sign in again — treat this as a
   deliberate, communicated maintenance action (see `docs/customer-support-runbook.md`), not a
   silent rotation, since it will generate support inquiries otherwise.
4. Only rotate this outside of a confirmed session-token compromise if there's a specific reason —
   the blast radius (forced re-login for every active user) is real and immediate.

### Twilio / SMS (`TWILIO_ACCOUNT_SID`, `SMS_API_KEY`/auth token, `SMS_FROM_NUMBER`)

Unlike every credential above, this one is **not** rotated via the app spec in normal operation —
`getEffectiveTwilioCredentials()` (`src/lib/sms-credentials.ts`) prefers database-stored, encrypted
credentials over the legacy flat env vars, and production has credentials configured that way.

1. Twilio Console → generate a new Auth Token (or a new API Key/Secret pair, the currently
   preferred Twilio-recommended approach over the primary Auth Token).
2. As a Platform Admin, go to `/admin/platform/sms` (SMS Administration) and enter the new
   credentials there — this writes through `updatePlatformSmsCredentials()`, re-encrypting with
   `SMS_CREDENTIAL_ENCRYPTION_KEY` before storing. No redeploy needed; takes effect on the next SMS
   send.
3. Use the module's own "Test Connection" action (`/api/admin/sms/test-connection`) to confirm the
   new credentials work before revoking the old ones in the Twilio console.
4. Only rotate the legacy env vars (`TWILIO_ACCOUNT_SID` etc. in the app spec) if the organization
   has never configured database-stored credentials yet — check `PlatformSmsSettings` first via the
   SMS Administration screen to see which path is actually active.

### Secrets-at-rest encryption key (`SMS_CREDENTIAL_ENCRYPTION_KEY`)

Rotating this key without a migration step **breaks decryption of every already-stored Twilio
credential** (`decryptSecret()` in `src/lib/crypto-secrets.ts` has no key-versioning — it always
decrypts with whatever this env var currently holds).

1. Before changing this value, re-enter the current Twilio/SMS credentials via `/admin/platform/sms`
   immediately **after** the key rotation and redeploy — this re-encrypts them under the new key.
   There is no automated re-encryption path today; treat this as a manual, two-step
   change-then-immediately-re-save operation, not a plain env var swap.
2. If this key is ever lost without a fallback/backup copy, every stored Twilio credential becomes
   permanently unrecoverable and must be re-entered from Twilio's own dashboard (the account SID and
   auth token themselves are recoverable from Twilio; nothing about this app's own data is lost
   beyond the stored copy).

## General principles

- Rotate one credential at a time, confirm it works in production, *then* revoke the old value at
  its source. Revoking before confirming the new value works risks a self-inflicted outage.
- After any rotation touching the app spec, confirm via `/api/health/deep` (platform-admin-only)
  that the relevant integration still reports healthy, and check the DO deployment logs for the
  redeploy actually succeeding — a bad app-spec edit can fail to deploy silently if not watched.
- Keep the *current* real values of every env-var-based secret in a password manager or sealed
  vault outside of DigitalOcean (see `docs/backup-and-disaster-recovery.md`'s "Environment
  variables / secrets" section) — this is what makes an emergency full-app recreation possible at
  all, since a redacted `doctl apps spec get` dump cannot be used to restore actual secret values.
