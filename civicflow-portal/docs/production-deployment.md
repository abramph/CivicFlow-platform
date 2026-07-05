# Production Deployment Guide

CivicFlow's SaaS portal (`civicflow-portal`) runs on DigitalOcean App Platform, backed by a
DigitalOcean Managed PostgreSQL database and DigitalOcean Spaces for file storage.

- **App Platform app ID**: `6e4f35b1-ad49-4c92-b025-97b7d12d7ace`
- **Production URL**: `https://civicflow-portal-iule6.ondigitalocean.app`
- **Database cluster**: `civicflowprod` (managed PostgreSQL, region `nyc3`)
- **Repo**: `github.com/abramph/CivicFlow-platform`, `main` branch
- **Deploy trigger**: `deploy_on_push: true` — every push to `main` triggers a build + deploy
  automatically. There is no separate manual "promote to production" step.

## Deployment workflow

1. Make code changes, run the full verification pass locally before pushing:
   ```
   npm run typecheck
   npm run lint
   npx vitest run
   npm run build
   ```
2. If the change includes a Prisma schema change, generate the migration via the diff-only
   workflow (do not run `prisma migrate dev` against the production `DATABASE_URL` in
   `.env.local` — it will fail non-interactively and risks drifting from a real dev history):
   ```
   git show HEAD:prisma/schema.prisma > /tmp/schema_before.prisma
   npx prisma migrate diff --from-schema-datamodel /tmp/schema_before.prisma \
     --to-schema-datamodel ./prisma/schema.prisma --script
   ```
   Save the output SQL under `prisma/migrations/<timestamp>_<name>/migration.sql`, review it for
   safety (additive vs. destructive), and only run `npx prisma migrate deploy` against production
   after that review — never apply an unreviewed diff.
3. Commit and push to `main`.
4. Check deployment status:
   ```
   doctl apps list-deployments 6e4f35b1-ad49-4c92-b025-97b7d12d7ace --format ID,Phase,Progress,Cause --no-header
   ```
   A deployment goes `PENDING_BUILD` → `BUILDING` → `DEPLOYING` → `ACTIVE`. If progress appears
   stuck at the same step for an unusually long time, check build logs before assuming it's hung:
   ```
   doctl apps logs 6e4f35b1-ad49-4c92-b025-97b7d12d7ace --deployment <deployment-id> --type build
   ```
5. Runtime (application) logs, for debugging live errors:
   ```
   doctl apps logs 6e4f35b1-ad49-4c92-b025-97b7d12d7ace --type run --tail 200
   ```

## Environment variables

All environment variables are managed in the DO App Platform app spec (`doctl apps spec get
6e4f35b1-ad49-4c92-b025-97b7d12d7ace`), not in a committed `.env` file. Secret-typed values are
encrypted at rest and redacted from `spec get` output.

### Strictly required (app throws on startup/first request if missing in production)

Enforced by the Zod schema in `src/lib/env.ts` — `getServerEnv()` throws `Invalid server
environment: ...` if any of these are missing when `NODE_ENV=production`, which surfaces to users
as a generic 500 on whatever request path first touches it.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `NEXTAUTH_SECRET` | NextAuth JWT signing secret |
| `NEXTAUTH_URL` | Canonical app URL, used for auth callbacks and email links |
| `STRIPE_SECRET_KEY` | Stripe API secret key |
| `STRIPE_WEBHOOK_SECRET` | Verifies `POST /api/webhooks/stripe` signatures |
| `DO_SPACES_ENDPOINT`, `DO_SPACES_REGION`, `DO_SPACES_BUCKET`, `DO_SPACES_ACCESS_KEY_ID`, `DO_SPACES_SECRET_ACCESS_KEY` | File storage (attachments, receipts, imports) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `FROM_EMAIL` | Transactional email (see [Brevo setup](./brevo-setup.md)) |

**Caution**: since these are validated as a group, adding a new *required* field to this schema
without also setting its value in the DO app spec breaks every request that touches
`getServerEnv()` — not just the feature the new field is for. This has happened before in this
project (a `MOBILE_JWT_SECRET` incident). Prefer adding new integration secrets as optional /
read-directly-via-`process.env` (see the SMS/Twilio/Stripe-add-on variables below) unless the
whole app should genuinely refuse to start without them.

### Optional (feature-gated, safe defaults if unset)

| Variable | Purpose | Behavior if unset |
| --- | --- | --- |
| `ENABLE_EMAIL_SEND` | Must be `"1"` or `"true"` to actually send email | Emails silently no-op (`skipped: true`) — safe for non-production environments |
| `STRIPE_PRICE_ESSENTIAL_MONTHLY`, `STRIPE_PRICE_ELITE_MONTHLY` | Stripe Price IDs for plan checkout (see [Stripe setup](./stripe-setup.md)) | Checkout for that plan fails with a clear error |
| `MOBILE_JWT_SECRET` | Mobile app bearer-token signing secret | Any mobile auth route throws its own explicit error, rather than breaking unrelated requests |
| `MOBILE_APP_WEB_BASE_URL`, `MOBILE_APP_WEB_HOST` | Universal link web-fallback domain (`app.civicflowapp.com`) | Falls back to the portal's own URL |
| `APPLE_APP_ID`, `ANDROID_PACKAGE_NAME`, `ANDROID_SHA256_CERT_FINGERPRINTS` | Universal link / app link verification files (`/.well-known/apple-app-site-association`, assetlinks.json) | Verification files serve placeholder/empty associations — universal links won't open the native app until these are set |
| `CIVICFLOW_USE_MEMORY_RATE_LIMITER`, `RATE_LIMIT_REDIS_URL`, `RATE_LIMIT_REDIS_TOKEN` | Rate limiter backend | Falls back to an in-memory limiter (see Known Issues: this does **not** work correctly across multiple server instances) |
| `CRON_SECRET` | Authenticates scheduled `/api/cron/*` requests | Cron endpoints reject all requests without it — must be set for reminders/report/campaign cron jobs to run |
| `NEXT_PUBLIC_SENTRY_DSN` | Error monitoring | **Not currently set in production** — `Sentry.captureException()` calls throughout the codebase are no-ops; errors are only visible via `doctl apps logs --type run`. See Monitoring below. |

### SMS / Twilio / SMS-add-on billing (deliberately outside the strict schema)

See [`sms-setup.md`](./sms-setup.md) for full detail: `SMS_PROVIDER`, `TWILIO_ACCOUNT_SID`,
`SMS_API_KEY`, `SMS_FROM_NUMBER`, `STRIPE_PRICE_SMS_ADDON_MONTHLY`.

## Monitoring

- **Application errors**: `@sentry/nextjs` is integrated in code (`sentry.server.config.ts`,
  `sentry.client.config.ts`, and every API route's `withApiErrorHandling` calls
  `Sentry.captureException`), but **`NEXT_PUBLIC_SENTRY_DSN` is not currently configured in
  production**, so Sentry is inert (`enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN` evaluates to
  `false`). Until a DSN is set, the only way to see server errors is `doctl apps logs
  6e4f35b1-ad49-4c92-b025-97b7d12d7ace --type run`, which is not real-time alerting — someone has
  to go looking. Setting up a real Sentry project (or equivalent) and wiring the DSN in is the
  single highest-leverage monitoring improvement available.
- **Deployment health**: `doctl apps list-deployments ... --format ID,Phase,Progress,Cause` after
  every push; DO App Platform also exposes basic CPU/memory graphs in its web console.
- **Database health**: DO Managed Database dashboard shows connection count, CPU, disk usage, and
  slow query insights for the `civicflowprod` cluster.

## Mobile deployment

See existing project notes on Windows/macOS Electron desktop app signing (separate deployable
unit, not part of this web portal). For the companion mobile app's web-fallback / universal link
configuration, see the `APPLE_APP_ID`/`ANDROID_PACKAGE_NAME`/`ANDROID_SHA256_CERT_FINGERPRINTS`
variables above — until real values are set, universal links (`https://app.civicflowapp.com/...`)
will not open the native app on either platform; they'll only serve the `/m/*` web-fallback pages.

## Backups and disaster recovery

See [`backup-and-disaster-recovery.md`](./backup-and-disaster-recovery.md).
