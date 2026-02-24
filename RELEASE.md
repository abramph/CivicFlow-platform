# CivicFlow Windows Release Guide

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

- `release/CivicFlow Setup <version>.exe`

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

## 3) Smoke test checklist (installed EXE)

1. Install `CivicFlow Setup <version>.exe`.
2. Launch CivicFlow and confirm UI is styled (Tailwind/layout/fonts loaded).
3. Navigate: Dashboard, Members, Settings, Reports.
4. Open Settings → License.
5. Activate online using valid key + optional email.
6. Confirm plan and offline days remaining appear.
7. Disconnect internet.
8. Relaunch app: confirm app still works while within offline grace window.
9. If offline days are near expiration, confirm warning text appears in License panel.
10. Reconnect internet and click **Check in now**.
11. Confirm last online check updates and warning clears.
12. Deactivate license and confirm app returns to activation-required state.

## 4) Packaging verification notes

- Renderer loads from `.vite/renderer/main_window/index.html` in packaged app.
- `base: "./"` is enabled for file:// compatibility in Vite renderer builds.
- Production logs are written to `{userData}/logs/civicflow.log`.
- CSS/script/image load failures are logged from Electron `webRequest` error events.
