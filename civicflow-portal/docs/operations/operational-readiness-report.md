# Operational Readiness Report

Last verified: 2026-08-10.

## Executive Summary

Unestra is ready for controlled onboarding of a small number of real organizations, with conditions. The core product launch PRs are merged, deployed, and verified. Production deployment is automated through GitHub and DigitalOcean App Platform. PostgreSQL backups are enabled, current, and were successfully restored into a temporary database fork. The Data Health tool exists and has already reduced production inconsistencies.

The highest remaining operational risks are not product feature gaps. They are recoverability and monitoring gaps: Spaces versioning is unverified, real secret recovery depends on an external vault, alerting/paging is not fully proven from the app spec, `/api/health/deep` timed out during verification, and the production app runs as a single instance backed by a single small PostgreSQL node.

Classification: READY WITH CONDITIONS.

## Current Strengths

- Production deploy-on-push flow is simple and observable.
- `/api/health` is wired into DO health checks.
- PostgreSQL automatic backups are current.
- Restore-to-temporary-database was validated in 461.9 seconds.
- Prisma migrations are applied automatically at startup via `npm run db:deploy`.
- Tenant authorization and Platform Admin authorization are server-side.
- Platform Admin Data Health gives read-only production consistency diagnostics.
- PR #83 added structured, PII-sanitized lifecycle observability.
- Brevo, Stripe, Twilio, Spaces, Expo Push, Sentry code integration, and GitHub are documented.
- Incident severity, credential rotation, recovery, deployment, launch, onboarding, admin, and support checklists now exist.

## Remaining Risks

Launch blockers recommended before broad or paid onboarding:

1. Confirm or enable DigitalOcean Spaces bucket versioning.
2. Confirm `NEXT_PUBLIC_SENTRY_DSN` and Sentry alert rules in the live DO App Platform environment. The readable app spec did not show the key during this verification.
3. Diagnose `/api/health/deep` timeout or replace it with a reliable authenticated dependency check.
4. Store all real production secrets outside DigitalOcean in a password manager or vault.
5. Reconfirm Stripe account ownership and live webhook endpoint before charging real customers.

Post-launch priorities:

1. Hash password reset and email verification tokens at rest.
2. Add external uptime monitoring for `/api/health`.
3. Diagnose and then add authenticated deep-health monitoring.
4. Configure backup freshness checks.
5. Move rate limiting to Redis before scaling beyond one app instance.
6. Confirm Twilio A2P 10DLC before production SMS usage.
7. Document and test Spaces object restore after versioning is enabled.
8. Add a read replica or higher-availability DB plan before larger customer cohorts.
9. Add source-map upload to Sentry if stack trace quality is insufficient.
10. Formalize customer incident communication templates.

## Top 10 Operational Improvements

1. Enable Spaces versioning and lifecycle policy.
2. Verify Sentry DSN and alert routing with one production test event.
3. Put production secrets in an external vault with owner access recovery.
4. Add external uptime checks for `/api/health`.
5. Diagnose `/api/health/deep`, then add authenticated dependency checks for it.
6. Hash `AccountVerificationToken.token` values.
7. Configure Redis-backed rate limiting.
8. Reconfirm Stripe account ownership and product/price IDs.
9. Schedule quarterly restore drills.
10. Add customer-facing status/incident communication procedure.

## Onboarding Readiness

10 organizations: READY WITH CONDITIONS.

The current architecture can support this if onboarding is controlled, Data Health is run before each go-live, and the operator accepts single-instance/small-DB operational risk.

100 organizations: READY WITH CONDITIONS, but upgrade planning required.

Before reaching this level, add external monitoring, verify Sentry alerting, enable Spaces versioning, move rate limiting to Redis, and consider a larger DB/app tier.

1000 organizations: NOT READY.

Before this level, the platform needs multi-instance readiness, queue/job architecture for high-volume sends/imports, stronger DB capacity/replica strategy, formal incident/on-call coverage, and automated monitoring/alerting.

## Recommended Launch Decision

READY WITH CONDITIONS.

Conditions for first real customer onboarding:

- Sentry alerting verified in production.
- Deep-health timeout is diagnosed or accepted as a known monitoring gap for the first cohort.
- Spaces versioning confirmed or enabled.
- External secret vault populated.
- Data Health run and reviewed for each onboarded organization.
- Paid/SMS customer onboarding waits until Stripe ownership and Twilio compliance are confirmed.
