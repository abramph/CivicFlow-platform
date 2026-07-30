# Unestra — Windows Development

This is the primary place to look for local development going forward, now that development is based on Windows and Apple-specific builds run through GitHub-hosted macOS runners.

## Real gaps this closes

Two real, previously-undocumented gaps were found and fixed by the scripts in `scripts/windows/`:

1. **`civicflow-portal/.env.local` points at the live production database.** `DATABASE_URL` in that file is a real DigitalOcean managed Postgres connection string for the production cluster — every local `npm run dev` / `prisma` command was running directly against production. `setup-dev.ps1` provisions a genuinely local `civicflow_dev` Postgres database and writes `civicflow-portal/.env.development.local`, which Next.js's env-loading order (`.env.development.local` > `.env.local` > `.env`) prefers automatically in dev mode — **without deleting or modifying your existing `.env.local`**. Your production-pointing config is preserved untouched as a fallback; it's just no longer what dev mode actually uses.
2. **`civicflow-mobile/.env` points `EXPO_PUBLIC_API_BASE_URL` at the production portal.** `start-mobile.ps1` writes a `civicflow-mobile/.env.development.local` pointing at your machine's LAN IP instead, so Expo Go on a device or the Android emulator talks to your locally running portal, not production.

Neither of the new `.env.development.local` files is committed to git (both projects' `.gitignore` already covers `.env*.local`).

## Prerequisites

- **Node.js**: developed and verified against v24.x on this machine. No `engines` field or `.nvmrc` currently pins a version in this repo.
- **npm**: ships with Node.
- **PostgreSQL**: only needed for `civicflow-portal`. This machine has PostgreSQL 14 installed (`C:\Program Files\PostgreSQL\14\bin`) with password (scram-sha-256) auth — there is no Docker alternative currently available in this environment, so `setup-dev.ps1` talks to a real local PostgreSQL install directly rather than a container.
- `cloud-api` and `civicflow-license-server` use file-based SQLite (`better-sqlite3`) — no separate database service needed for either.
- The Electron desktop app has its own local SQLite storage and an offline-license dev path (see `README.md`'s `CIVICFLOW_ALLOW_SIGNED_LICENSES`) — it doesn't need `cloud-api` or `civicflow-license-server` running for ordinary UI development.

## One-time setup

```powershell
scripts\windows\setup-dev.ps1
```

This installs dependencies in every unit (`civicflow-portal`, `civicflow-mobile`, `cloud-api`, `civicflow-license-server`, and the root Electron app), provisions the local `civicflow_dev` Postgres database, runs Prisma migrations against it, and seeds fictional demo data (Pine Grove PTA, Riverdale, etc.). It will prompt for your local PostgreSQL password (not echoed) unless you pass `-PgPassword` as a `SecureString`.

The script **refuses to run against anything other than `localhost`/`127.0.0.1`** — see `scripts/windows/common.ps1`'s `Assert-LocalDatabaseUrl`, which every database-touching script in this suite calls first.

## Day to day

| Script | What it does |
|---|---|
| `scripts\windows\start-portal.ps1` | Starts the Next.js dev server for `civicflow-portal`. |
| `scripts\windows\start-mobile.ps1` | Starts the Expo dev server for `civicflow-mobile`, auto-detecting your LAN IP for the local API base URL. |
| `scripts\windows\start-desktop.ps1` | Starts the Electron desktop app (renderer + main process). |
| `scripts\windows\start-all.ps1` | Launches all three of the above, each in its own PowerShell window. |
| `scripts\windows\reset-demo-db.ps1` | Drops, recreates, migrates, and reseeds the local `civicflow_dev` database. Prompts for confirmation (type `reset`) before proceeding. Never touches anything but the local database. |
| `scripts\windows\run-validation.ps1` | Runs the full local check battery: portal/mobile typecheck, lint, tests, Prisma schema validation, `expo-doctor`, and a dependency audit. Reports a pass/fail summary at the end rather than stopping at the first failure. |

## Branch workflow

- Feature work happens on `agent/*` or `feature/*` branches off `main`.
- `main` has branch protection: force-pushes and branch deletion are blocked (added this pass — see `docs/production-release-process.md`).
- Merging to `main` triggers DigitalOcean's automatic production deploy (`deploy_on_push: true` in `.do/app.yaml`) — **there is currently no staging environment or required-checks gate**, so treat every merge to `main` as an immediate production deploy. See `docs/production-release-process.md` for what to check before merging.

## Production-release restrictions

- Never point a local script's `DATABASE_URL` at the production host. If you need to inspect production data, do it through the DigitalOcean console or a read-only tool — not through any script in `scripts/windows/`.
- Don't commit `.env`, `.env.local`, `.env.development.local`, or any `.p8`/`.p12`/`.pem`/provisioning-profile/keychain file.
- The signed macOS release pipeline (`.github/workflows/macos-signing-notarization.yml`) and the iOS App Store submission are independent of local Windows development — nothing in this document affects either.
