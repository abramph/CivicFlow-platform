# Unestra Windows Release Guide

## Prerequisites

- Node.js 18+
- npm
- Windows build machine

## 1) Build commands

```bash
npm install
npm run clean
npm run build
npm run dist:win
```

Optional activation API override:

```bash
set ACTIVATION_API_URL=https://your-license-api.example.com
npm run dist:win
```

Installer output:

- `release/Unestra Setup <version>.exe`

## 2) License server (local/dev)

From `civicflow-license-server/`:

```bash
npm install
npm run init
npm start
```

Default local API URL: `http://127.0.0.1:4000`

Production deployment path:

- Deploy `civicflow-license-server/server.js` to Render/Fly/Azure App Service.
- Set environment variables:
  - `PORT` (platform provided)
  - `OFFLINE_GRACE_DAYS` (default `37`)
  - `WARN_AFTER_DAYS` (default `30`)
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

Admin dashboard routes:

- `/admin/login`
- `/admin/licenses`
- `/admin/licenses/:id`
- `/admin/api/licenses`

Stripe webhook route:

- `POST /webhooks/stripe`

To test locally with Stripe CLI:

```bash
cd civicflow-license-server
npm start
stripe listen --forward-to http://127.0.0.1:4000/webhooks/stripe
stripe trigger checkout.session.completed
```

Use the signing secret reported by `stripe listen` for `STRIPE_WEBHOOK_SECRET`.

## 3) Smoke test checklist (installed EXE)

1. Install `Unestra Setup <version>.exe`.
2. Launch Unestra and confirm onboarding appears when no paid license is present.
3. Confirm the welcome step explains trial vs paid activation.
4. Activate online using the customer email and license key from the purchase email.
5. Confirm the success step shows plan, license type, seat allowance, and expiry/support dates.
6. Continue into the app and verify Dashboard, Members, Settings, and Reports load.
7. Open Settings → License and confirm plan, organization, email, offline status, and last validation data appear.
8. Disconnect internet.
9. Relaunch app and confirm a previously validated paid license still works within offline grace.
10. If offline days are near expiration, confirm warning text appears in the license panel.
11. Reconnect internet and click **Check in now**.
12. Confirm last online check updates and warning clears.
13. Deactivate license and confirm the app routes back into activation/onboarding.

## 4) Admin and licensing verification

1. Log into `/admin/login` with the configured admin credentials.
2. Open `/admin/licenses` and verify search/filtering by plan, type, and status.
3. Create one annual license and one perpetual license from the dashboard.
4. Open each detail page and confirm activation history and seat counts render.
5. Revoke a license and confirm activation/refresh calls return the revoked state.
6. Reset activations for a paid license and confirm the device count returns to zero.
7. Extend an annual license and confirm the new expiry is reflected in admin and app refresh.
8. Extend perpetual support and confirm the support expiry is reflected in admin and app refresh.
9. Replay the same Stripe `checkout.session.completed` event twice and confirm only one license is created.
10. Confirm the new-license email path succeeds in an SMTP-enabled environment.

## 5) Packaging verification notes

- Renderer loads from `.vite/renderer/main_window/index.html` in packaged app.
- `base: "./"` is enabled for file:// compatibility in Vite renderer builds.
- Production logs are written to `{userData}/logs/civicflow.log`.
- CSS/script/image load failures are logged from Electron `webRequest` error events.
