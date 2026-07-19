# Unestra — Deployment Guide

This repository contains three deployable units:

| Unit | Path | Runtime | Current Host |
|---|---|---|---|
| Desktop app | `/` (root) | Electron + React/Vite | Distributed installer |
| License server | `civicflow-license-server/` | Node/Express + SQLite | VPS (PM2) |
| Cloud API | `cloud-api/` | Node/Express + SQLite | VPS or cloud |
| Portal (SaaS) | `civicflow-portal/` | Next.js 16 | Planned: DigitalOcean |
| Mobile app | `civicflow-mobile/` | Expo / React Native | App Store / Google Play (see `MOBILE_DEPLOYMENT.md`) |

---

## 1. Desktop App

**Build for Windows:**
```bash
npm install
npm run dist:win
# Output: release/Unestra Setup <version>.exe
```

**Build for macOS** (must run on macOS):
```bash
npm run build:mac
# Output: release/Unestra-<version>.dmg
```

**Environment variables** (desktop, set before building or at runtime):
| Variable | Purpose | Default |
|---|---|---|
| `CIVICFLOW_LICENSE_SERVER_URL` | License activation endpoint | `https://api.civicflowapp.com` |
| `STRIPE_SECRET_KEY` | Stripe Connect / webhook | — |
| `STRIPE_PUBLISHABLE_KEY` | Stripe client-side | — |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook verification | — |

Copy `.env.example` → `.env` and fill in values before building.

---

## 2. License Server — VPS (Current)

Deployed on a VPS using **PM2**.

### Prerequisites
- Node.js 18+
- PM2 installed globally: `npm install -g pm2`

### Setup
```bash
cd civicflow-license-server
npm install
cp .env.example .env
# Edit .env with real values
npm run init        # initialize DB and run migrations
pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup
```

### Key environment variables
| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (default 4000) |
| `LICENSE_DB_PATH` | SQLite DB file path |
| `APP_BASE_URL` | Public base URL of the license server |
| `OFFLINE_GRACE_DAYS` | Days app works offline without check-in (default 37) |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signature secret |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Admin UI credentials |
| `ADMIN_SESSION_SECRET` | Long random secret for session cookies |
| `SMTP_*` | Email delivery for license receipts |
| `SENTRY_DSN` | Optional — Sentry DSN for error tracking |

See `civicflow-license-server/.env.example` for the full list.

### Nginx reverse proxy (recommended)
```nginx
server {
    listen 443 ssl;
    server_name api.civicflowapp.com;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Database backups
```bash
npm run backup:db
```
Backups are written to `civicflow-license-server/backups/`. Do not commit backup files.

---

## 3. Cloud API — VPS

```bash
cd cloud-api
npm install
cp .env.example .env
# Edit .env
node server.js          # or: npx nodemon server.js
```

Runs on port `8787` by default. Serve behind nginx or expose directly.

---

## 4. Portal / SaaS Platform — DigitalOcean App Platform

The portal is the Unestra SaaS application (Next.js + Prisma/PostgreSQL) and is maintained without legacy UnionFlow models, scripts, or routes.

### Local environment file strategy
- Use `civicflow-portal/.env.local` as the primary local secrets file.
- Keep `civicflow-portal/.env.example` as placeholders only.
- Prisma CLI reads local env through `civicflow-portal/prisma.config.ts` (which loads Next-style env files, including `.env.local`).
- Do not commit real credentials.

### Requirements
- DigitalOcean App Platform (Node.js buildpack or Dockerfile)
- DigitalOcean Managed PostgreSQL cluster
- DigitalOcean Spaces bucket (S3-compatible) for file uploads
- Custom domain + Let's Encrypt TLS (managed by DO App Platform)

### App Platform settings

**Build command:**
```bash
cd civicflow-portal && npm install && npm run db:generate && npm run build
```

**Run command:**
```bash
cd civicflow-portal && npm run db:deploy && npm run start
```

> `npm run db:deploy` (`prisma migrate deploy`) applies pending migrations on every deploy and is safe to run repeatedly.
> Migrations must run before first production launch.

### Required environment variables (App Platform → Settings → Env Vars)

| Variable | Description |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | PostgreSQL connection string — **must include `?sslmode=require`** |
| `NEXTAUTH_URL` | Public URL, e.g. `https://app.civicflowapp.com` |
| `NEXTAUTH_SECRET` | Long random secret — `openssl rand -base64 32` |
| `STRIPE_SECRET_KEY` | Stripe live secret key (`sk_live_…`) |
| `STRIPE_WEBHOOK_SECRET` | Stripe live webhook signing secret (`whsec_…`) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe live publishable key (`pk_live_…`) |
| `DO_SPACES_ENDPOINT` | e.g. `https://nyc3.digitaloceanspaces.com` |
| `DO_SPACES_REGION` | e.g. `nyc3` |
| `DO_SPACES_BUCKET` | Spaces bucket name |
| `DO_SPACES_ACCESS_KEY_ID` | Spaces access key |
| `DO_SPACES_SECRET_ACCESS_KEY` | Spaces secret |
| `SMTP_HOST` | SMTP server hostname |
| `SMTP_PORT` | SMTP port (e.g. `587`) |
| `SMTP_USER` | SMTP username |
| `SMTP_PASS` | SMTP password |
| `FROM_EMAIL` | Sender address, e.g. `Unestra <noreply@civicflowapp.com>` |
| `ENABLE_EMAIL_SEND` | `1` to enable real email sends (default safe mode is off) |
| `CRON_SECRET` | Long random secret for authenticating cron endpoint calls |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry DSN for error tracking (portal client + server) |
| `RATE_LIMIT_REDIS_URL` | Optional Redis URL for production rate limiting |
| `RATE_LIMIT_REDIS_TOKEN` | Optional token/secret for Redis provider |
| `SENTRY_AUTH_TOKEN` | Optional — enables source map uploads to Sentry at build time |
| `SENTRY_ORG` | Optional — Sentry org slug (only needed with `SENTRY_AUTH_TOKEN`) |
| `SENTRY_PROJECT` | Optional — Sentry project slug (only needed with `SENTRY_AUTH_TOKEN`) |

### DigitalOcean Managed PostgreSQL connection string format
```
postgresql://USER:PASSWORD@HOST:PORT/DBNAME?sslmode=require
```
Found in: DO Console → Databases → your cluster → Connection Details → URI.

### Seed the database (first deploy only)
```bash
cd civicflow-portal && npm run db:seed
```
Change all placeholder passwords immediately after seeding.

### Run migrations locally
```bash
cd civicflow-portal
npm install
npm run db:generate  # generates Prisma client
npm run db:migrate   # creates and applies migrations
npm run db:seed      # seeds starter data
npm run db:studio    # inspect data
```

### Scheduled workers (cron endpoints)

Workers are exposed as authenticated HTTP endpoints and triggered on a schedule by an external cron service.

**Endpoints:**
| Endpoint | Purpose | Recommended schedule |
|---|---|---|
| `POST /api/cron/reminders` | Send queued email reminders | Every 10 minutes |
| `POST /api/cron/reports` | Process queued CSV report exports | Every 5 minutes |
| `POST /api/cron/meeting-intelligence` | Submit queued Meeting Intelligence recordings for transcription; poll in-flight transcriptions and generate draft minutes | Every 5 minutes — only needed once Meeting Intelligence is enrolled for a pilot org (internal-only, see docs/meeting-intelligence.md) |
| `POST /api/cron/meeting-intelligence-retention` | Delete recording objects (not transcripts/minutes) for settled Meeting Intelligence jobs older than 30 days | Once daily — same activation condition as above |

**Authentication:** `Authorization: Bearer <CRON_SECRET>`

**Required env var:** `CRON_SECRET` — a long random string (e.g. `openssl rand -base64 32`). Add it to DO App Platform env vars alongside the other secrets.

**Concurrency note:** none of these endpoints are DigitalOcean-scheduled jobs — there is no worker/job component in `.do/app.yaml`, only the single `web` service (`instance_count: 1`). They rely entirely on an external scheduler (cron-job.org or equivalent) POSTing to the endpoint on an interval, with no platform-level guarantee against two overlapping calls if one run takes longer than the interval. `/api/cron/meeting-intelligence` defends against this itself (an atomic per-job claim before any vendor submission — see `worker.ts`'s `claimQueuedJob`), so a duplicate/overlapping trigger is safe, not free of cost (a lost race just skips that job for the tick). The other endpoints (`reminders`, `reports`) do not have the same protection — avoid scheduling them faster than they can reliably complete.

**Recommended: cron-job.org (free)**
1. Create a free account at cron-job.org
2. Add jobs (only the first two are required by default; add the Meeting Intelligence pair once that internal pilot is enrolled):
   - URL: `https://app.getunestra.com/api/cron/reminders`, Method: POST, Header: `Authorization: Bearer <CRON_SECRET>`
   - URL: `https://app.getunestra.com/api/cron/reports`, Method: POST, Header: `Authorization: Bearer <CRON_SECRET>`
   - URL: `https://app.getunestra.com/api/cron/meeting-intelligence`, Method: POST, Header: `Authorization: Bearer <CRON_SECRET>`
   - URL: `https://app.getunestra.com/api/cron/meeting-intelligence-retention`, Method: POST, Header: `Authorization: Bearer <CRON_SECRET>`
3. Set schedules per the table above

**Alternative: run manually during development**
```bash
cd civicflow-portal
npm run worker:reminders
npm run worker:reports
npm run worker:meeting-intelligence
npm run worker:meeting-intelligence-retention
```

### File uploads and exports: DigitalOcean Spaces (Phase 3 foundation)
- S3-compatible helper added using `@aws-sdk/client-s3`
- Private object uploads by default
- Signed URL generation helper available
- Receipt PDFs and CSV report exports upload to Spaces

### Production deployment checklist
- [ ] All secrets set as **encrypted** env vars in DO App Platform (never in code)
- [ ] `NODE_ENV=production`
- [ ] `DATABASE_URL` includes `?sslmode=require`
- [ ] `NEXTAUTH_SECRET` is a securely generated random value (≥ 32 bytes)
- [ ] Stripe live keys used (not test keys)
- [ ] Stripe webhook endpoint: `https://app.civicflowapp.com/api/webhooks/stripe`
- [ ] Configure Stripe webhook events:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_succeeded`
  - `invoice.payment_failed`
- [ ] CORS origin locked to production domain
- [ ] Production Redis-backed rate limiting configured (Upstash / DO Managed Redis)
- [ ] `CRON_SECRET` set and cron jobs configured (cron-job.org or equivalent)
- [ ] `NEXT_PUBLIC_SENTRY_DSN` set in DO App Platform env vars
- [ ] DO Managed PostgreSQL automated backups enabled
- [ ] Spaces bucket is private; files served via presigned URLs only
- [ ] Seed passwords changed after first deploy
- [ ] `prisma migrate deploy` runs on every production deploy

---

## 5. Recommended Repository Structure (Future)

When this project grows into a full monorepo, consider:

```
/apps
  /desktop        ← Electron app (current root)
  /web            ← Next.js SaaS portal (civicflow-portal/)
  /license-server ← License server API (civicflow-license-server/)
  /cloud-api      ← Payment webhook API (cloud-api/)
/packages
  /shared         ← Shared types, validation schemas (Zod), utilities
```

This migration can be done incrementally with symlinks or workspace packages.
No restructuring is needed before the first SaaS deployment.
