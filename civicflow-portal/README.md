# CivicFlow Portal (SaaS)

Next.js SaaS portal for CivicFlow multi-tenant operations.

Legacy UnionFlow schema models, scripts, and routes have been removed so the portal is PostgreSQL-focused and CivicFlow-only.

## Stack
- Next.js App Router
- Prisma ORM (PostgreSQL)
- NextAuth
- Stripe Billing (SaaS webhook integration)
- DigitalOcean Spaces (S3-compatible object storage integration)

## Environment
Copy [.env.example](.env.example) to `.env.local` and provide values.

Environment strategy:
- Local development: `.env.local` is the primary local secrets file.
- Prisma CLI: loaded via [prisma.config.ts](prisma.config.ts), which uses Next-style env loading and picks up `.env.local`.
- Next.js runtime: loads `.env.local` in development.
- Production: set secrets directly in DigitalOcean App Platform environment variables.
- `.env` is optional fallback only and not required for local development.

Required in production:
- `DATABASE_URL`
- `DATABASE_POOL_URL` (recommended for Next.js runtime queries)
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `DO_SPACES_ENDPOINT`
- `DO_SPACES_REGION`
- `DO_SPACES_BUCKET`
- `DO_SPACES_ACCESS_KEY_ID`
- `DO_SPACES_SECRET_ACCESS_KEY`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `FROM_EMAIL`

Optional:
- `ENABLE_EMAIL_SEND=1` to enable actual SMTP sends
- `RATE_LIMIT_REDIS_URL` and `RATE_LIMIT_REDIS_TOKEN` for production rate limiting backend

## Local setup
```bash
npm install
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

## Migration readiness
The Prisma schema is PostgreSQL-ready.

Database connection strategy:
- `DATABASE_URL` is the direct PostgreSQL connection and is used by Prisma CLI migration/deploy commands.
- `DATABASE_POOL_URL` is the PgBouncer/pooled connection used by the Next.js runtime when present.
- Do not use `DATABASE_POOL_URL` for migrations; keep migration commands on `DATABASE_URL`.

Local migration commands:
```bash
npm run db:migrate
npm run db:seed
npm run db:studio
```

Production migration command:
```bash
npm run db:deploy
```

Run migrations before first production launch.

## Build validation
```bash
npm run db:generate
npm run lint
npm run typecheck
npm run build
```

## Workers
Reminder and report export workers are manual jobs for Phase 3:
```bash
npm run worker:reminders
npm run worker:reports
```

Use a DigitalOcean worker/service schedule in production later.

## Security notes
- Protected API routes derive `organizationId` from server session, never from client body.
- Write routes require permission checks.
- Money fields are validated and stored as Decimal in Prisma.
- Errors are sanitized in production responses.
- Secrets are server-only and must not be exposed to client code.
