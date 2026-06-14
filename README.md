# Civicflow

Offline desktop app for community organizations. Manages members, events, campaigns, and finances with local SQLite storage and an offline-capable license system.

## Requirements

- Node.js 18+
- npm

## Development

```bash
npm install
npm run dev
```

## Build installers

```bash
npm run dist:win
npm run build:mac
```

Produces:
- **Windows**: `release/CivicFlow Setup <version>.exe`
- **macOS**: `release/CivicFlow-<version>.dmg` (must be built on macOS)

## License system

Civicflow requires a valid license to create, edit, export, or backup data. Viewing existing data is allowed without a license.

Packaged builds use the active license server in `civicflow-license-server/` for activation, refresh, deactivation, renewals, and offline grace. Signed offline keys are now a development-only path unless `CIVICFLOW_ALLOW_SIGNED_LICENSES=1` is explicitly set.

Set the activation server URL for desktop builds using `CIVICFLOW_LICENSE_SERVER_URL` or `ACTIVATION_API_URL`.

Example:

```bash
ACTIVATION_API_URL=https://licenses.civicflowapp.com npm run dist:win
```

### License server setup

From `civicflow-license-server/`:

```bash
npm install
copy .env.example .env
npm run migrate
npm run init
npm start
```

`npm run init` now runs tracked SQL migrations and only seeds demo licenses when `SEED_DEMO_LICENSES=1`.

Required server environment variables:

- `PORT`
- `OFFLINE_GRACE_DAYS`
- `WARN_AFTER_DAYS`
- `ALLOW_SERVER_TRIAL_LICENSES`
- `SEED_DEMO_LICENSES`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_ID_ANNUAL_ESSENTIAL`
- `STRIPE_PRICE_ID_ANNUAL_ELITE`
- `STRIPE_PRICE_ID_PERPETUAL_ESSENTIAL`
- `STRIPE_PRICE_ID_PERPETUAL_ELITE`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`
- `LICENSE_SUPPORT_EMAIL`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `ADMIN_SESSION_SECRET`
- `ADMIN_SESSION_TTL_HOURS`
- `ADMIN_SESSION_SECURE`

Recommended optional environment variables:

- `LICENSE_DB_PATH`
- `APP_BASE_URL`
- `CIVICFLOW_ALLOW_SIGNED_LICENSES`
- `CIVICFLOW_LICENSE_SERVER_URL`
- `ACTIVATION_API_URL`

See [civicflow-license-server/.env.example](/C:/dev/my-cbo-app/civicflow-license-server/.env.example).

### Test and production deployments

Keep test and production fully separate:

- Use a different `LICENSE_DB_PATH` for each deployment.
- Use separate `.env` files.
- Use separate Stripe price IDs.
- Use separate SMTP senders / mailboxes.
- Keep `SEED_DEMO_LICENSES=0` in production.
- Do not copy seeded demo keys into a production database.

### Checkout and renewals

The active server now supports:

- `POST /api/store/checkout`
- `POST /webhooks/stripe`
- `POST /api/license/activate`
- `POST /api/license/refresh`
- `POST /api/license/deactivate`

Stripe checkout supports:

- new annual purchases
- new perpetual purchases
- annual renewals on an existing key
- maintenance renewals on an existing perpetual key

The portal buy page lives at `civicflow-portal/src/app/buy/page.tsx` and posts to `/api/store/checkout`.

### Stripe webhook local testing

Start the server:

```bash
cd civicflow-license-server
npm start
```

Create a checkout session locally:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\stripe-smoke.ps1 `
  -ServerUrl http://127.0.0.1:4000 `
  -PriceId price_REPLACE_ME `
  -PurchaseKind new_purchase `
  -CustomerEmail buyer@example.com `
  -OrganizationName "Example Org"
```

Forward Stripe events:

```bash
stripe listen --forward-to http://127.0.0.1:4000/webhooks/stripe
```

Use the Stripe CLI signing secret as `STRIPE_WEBHOOK_SECRET`.

Inspect the resulting database rows:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify-renewal.ps1 `
  -DbPath .\licenses.db `
  -LicenseKey CF-XXXX-XXXX-XXXX-XXXX
```

### Admin dashboard

With `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `ADMIN_SESSION_SECRET` configured, the admin dashboard supports:

- manual license issuance with environment, plan, seat count, expiry, support expiry, notes, and email delivery
- per-device activation release
- annual renewals
- maintenance renewals
- license reissue with superseding keys
- resending license emails
- purchase history and license event history

JSON admin endpoints are also available behind the same admin session:

- `GET /api/admin/licenses?query=`
- `GET /api/admin/licenses/:licenseKey`
- `POST /api/admin/licenses/:licenseKey/resend`
- `POST /api/admin/licenses/:licenseKey/deactivate-device`
- `GET /api/admin/purchase-events?limit=50`
- `GET /api/admin/license-events?limit=50`

### CLI license management

The existing server-side CLI still reuses the shared license service:

```bash
cd civicflow-license-server
npm run license:create -- --org "Example Org" --email ops@example.com --type annual --plan Essential --days 365
npm run license:inspect -- --license CF-XXXX-XXXX-XXXX-XXXX
npm run license:extend -- --license CF-XXXX-XXXX-XXXX-XXXX --days 30
npm run license:revoke -- --license CF-XXXX-XXXX-XXXX-XXXX
npm run license:reset-activations -- --license CF-XXXX-XXXX-XXXX-XXXX
```

### Activation smoke check

To verify the production activation path without leaving an active seat behind, run the disposable smoke check on the license-server host so it can create and clean up a temporary key in the same database:

```bash
cd civicflow-license-server
npm run smoke:activation -- --server https://api.civicflowapp.com --environment prod
```

By default the script creates a short-lived license, activates it through `/api/licenses/activate`, deactivates it through `/api/licenses/deactivate`, resets any remaining activations, and revokes the license. Use `--keep-license` only when you need to inspect a failed run.

### VPS deployment

Example production deployment for `api.civicflowapp.com` on Ubuntu with PM2 and Nginx:

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2

cd /srv/civicflow/civicflow-license-server
npm install --omit=dev
cp .env.example .env
nano .env
npm run migrate
pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup
```

Recommended production settings:

- `NODE_ENV=production`
- `PORT=4000`
- `LICENSE_DB_PATH=/srv/civicflow/data/licenses-prod.db`
- `SEED_DEMO_LICENSES=0`
- production Stripe secret, webhook secret, and live price IDs
- production SMTP sender and mailbox
- `ADMIN_SESSION_SECURE=1`
- `CIVICFLOW_ALLOW_SIGNED_LICENSES=0`

Nginx reverse proxy example:

```nginx
server {
    listen 80;
    server_name api.civicflowapp.com;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Enable the site and issue the certificate:

```bash
sudo ln -s /etc/nginx/sites-available/civicflow-license-server /etc/nginx/sites-enabled/civicflow-license-server
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d api.civicflowapp.com
```

Production smoke test flow:

1. Check service health:

```bash
curl https://api.civicflowapp.com/health
```

2. Create a checkout session from the portal or directly against the license server:

```bash
curl -X POST https://api.civicflowapp.com/api/store/checkout \
  -H "Content-Type: application/json" \
  -d '{
    "priceId":"price_live_REPLACE_ME",
    "purchaseKind":"new_purchase",
    "customerEmail":"buyer@example.com",
    "organizationName":"Example Org",
    "environment":"prod",
    "successUrl":"https://portal.civicflowapp.com/buy?status=success",
    "cancelUrl":"https://portal.civicflowapp.com/buy?status=cancelled"
  }'
```

3. Complete the Stripe checkout.
4. Confirm the webhook updated `purchase_events` and `license_events`, then confirm the license can activate from the desktop app.

### Activate and deactivate in-app

Activation steps:

1. Open CivicFlow.
2. Choose **Activate License** from onboarding or from Settings.
3. Enter the customer email address and license key from the delivery email.
4. Complete activation while online so the device receives its server-managed activation token.

Offline grace still applies to valid server-issued licenses. Deactivation now waits for the server release to succeed; if the server is unreachable, CivicFlow keeps the local license file and queues the release for retry.

## Data location

- **Windows**: `%APPDATA%/Civicflow/app.db`
- **macOS**: `~/Library/Application Support/Civicflow/app.db`

Logs: `{userData}/logs/civicflow.log`

---

## Repository architecture

This monorepo contains four deployable units:

| Directory | Purpose | Stack |
|---|---|---|
| `/` (root) | **Desktop app** | Electron 40, React 19, Vite 5, better-sqlite3 |
| `civicflow-license-server/` | **License API** (VPS, current) | Node/Express, SQLite, Stripe, PM2 |
| `cloud-api/` | **Payment webhook API** | Node/Express, better-sqlite3 |
| `civicflow-portal/` | **SaaS portal** (active) | Next.js 16, Prisma, NextAuth |

### Desktop app
The Electron app is **self-contained and offline-capable**. All member, finance, and event data is stored in a local SQLite database on the user's machine. A license key (issued by the license server) is required to write data.

### License server
Runs on a VPS behind nginx, managed by PM2. Handles license activation, refresh, deactivation, Stripe checkout, and webhook processing. See `civicflow-license-server/.env.example` for all required environment variables.

### SaaS portal
`civicflow-portal/` is the hosted CivicFlow SaaS application on Next.js + Prisma/PostgreSQL. Legacy UnionFlow schema/routes/scripts have been removed from the portal so it can migrate cleanly to PostgreSQL.

See [DEPLOYMENT.md](DEPLOYMENT.md) for full deployment instructions.  
See [SECURITY.md](SECURITY.md) for secret handling and production safety guidance.

