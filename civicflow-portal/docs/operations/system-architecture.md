# System Architecture

Last verified: 2026-08-10.

## Overview

Unestra is a Next.js SaaS portal and companion mobile app for community organizations, PTAs, HOAs, and unions. The production web portal is deployed as `civicflow-portal` on DigitalOcean App Platform. PostgreSQL is the system of record; DigitalOcean Spaces stores uploaded objects; provider integrations handle email, SMS, billing, push notifications, and error monitoring.

## Components

| Component | Purpose | Source of Truth |
| --- | --- | --- |
| Next.js portal | Staff/admin/member web application and API routes | GitHub `main`, DO App Platform |
| PostgreSQL | Organizations, users, members, PTA/HOA/union data, audit logs, communication state | DO Managed PostgreSQL `civicflowprod` |
| Spaces | Attachments, receipts, imports, documents | DO Spaces bucket from `DO_SPACES_BUCKET` |
| Brevo SMTP | Transactional and campaign email delivery | Brevo account + SMTP env vars |
| Twilio | SMS send/inbound opt-out webhooks | Twilio account + platform SMS settings/env vars |
| Stripe | SaaS billing, payment links, checkout/webhooks | Stripe account + app webhooks |
| Expo Push | Mobile push notifications | Expo service + stored device tokens |
| Sentry | Error capture when DSN is configured | Sentry project + `NEXT_PUBLIC_SENTRY_DSN` |
| GitHub | Code, PR review, deployment trigger | `abramph/CivicFlow-platform` |
| Hostinger DNS | Public DNS for `getunestra.com` | Hostinger nameservers |

## Request Flow

1. Browser/mobile client requests `app.getunestra.com`.
2. Hostinger DNS resolves `app.getunestra.com` to the DO App Platform hostname.
3. DO routes traffic to the single `web` service.
4. Next.js middleware applies security headers, rate limiting, legacy-domain redirects, public/private route gating, and MFA routing.
5. API routes use server-side guards:
   - `requireOrganization` for active tenant context.
   - `requirePermission` for tenant RBAC.
   - `requireSuperAdmin` for Platform Admin surfaces.
6. Prisma reads/writes PostgreSQL.
7. Integrations call Brevo, Twilio, Stripe, Expo, Spaces, and Sentry as needed.

## Tenant Model

Tenant isolation is enforced server-side. Organization ID is derived from session context or verified invite/token records, not trusted from arbitrary client input. Platform Admin access is global and independent of active organization role via `PlatformAccess`.

PTA household adults may intentionally have app login access through `PtaHouseholdAdult.userId` without a normal `OrganizationMembership` or `OrgMember` row. This is valid architecture and should not be treated as corruption.

## Security Boundaries

- Platform Admin routes require `PlatformAccess` with `SUPER_ADMIN`.
- Organization routes require active organization session plus permission checks.
- Webhooks authenticate independently:
  - Stripe uses webhook signature secret.
  - Twilio inbound uses Twilio signature validation.
  - Cron routes require `CRON_SECRET`.
- Member/PTA invite tokens are stored hashed and are single-use/expiring.
- Password reset/email verification tokens are expiring/single-use but currently stored raw; this should be hardened post-launch.

## Data Classification

High-sensitivity data:

- User passwords and password reset tokens.
- Auth/session secrets.
- Payment provider secrets and webhook secrets.
- Invite tokens in URLs.
- Member contact details and payment history.

Operational logs should contain IDs/counts/statuses only for lifecycle observability. PR #83 added structured observability with PII sanitization for campaign/volunteer/provider/invite lifecycle logs.

## Known Scaling Limits

- One App Platform instance.
- In-memory rate limiter fallback is acceptable for one instance but not multiple instances.
- No job queue for large synchronous diagnostics or background work; cron/worker routes exist but are not a full queue system.
- PostgreSQL is one small managed node.
- Campaign sending uses synchronous batches and cron resumption, suitable for current scale but not large customer bases.
