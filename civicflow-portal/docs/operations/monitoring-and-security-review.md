# Monitoring and Security Review

Last verified: 2026-08-10.

## Monitoring

Detectable today:

- App liveness through `/api/health` and DO health checks.
- Deployment build/run failures through DO deployment logs.
- PostgreSQL connectivity through app errors and direct operator checks. Platform Admin deep health exists in code, but returned a DO upstream timeout during this verification.
- Unhandled API exceptions through `withApiErrorHandling`, console errors, and Sentry if DSN is configured.
- Campaign lifecycle through structured logs:
  - `communication_campaign_created`
  - `communication_recipients_resolved`
  - `communication_campaign_finalized`
  - scheduled/provider/webhook failure logs
- Volunteer lifecycle through structured logs:
  - `pta_volunteer_signup_claimed`
  - `pta_volunteer_signup_manually_assigned`
  - `pta_volunteer_signup_cancelled`
- PTA invite lifecycle through structured logs without raw invite tokens.
- Data consistency through Platform Admin Data Health.

Gaps:

- Sentry DSN was not visible in the readable DO app spec at verification time. Confirm in DO console and Sentry before relying on alerting.
- No verified external uptime monitor or paging channel.
- `/api/health/deep` is Platform Admin only, not wired to an authenticated monitor, and currently needs diagnosis because it returned a DO upstream timeout while `/api/health` stayed healthy.
- No verified alert on missing/stale database backups.
- No verified Spaces versioning/lifecycle alert.
- One App Platform instance limits observability of cross-instance rate limiting and failover.

Minimal recommendations:

1. Confirm `NEXT_PUBLIC_SENTRY_DSN` in DO App Platform and configure Sentry alerts for new issues and error-rate spikes.
2. Add external uptime monitoring for `/api/health`.
3. Diagnose `/api/health/deep`, then add an authenticated periodic check for it or create a narrow shared-secret monitor route.
4. Add a weekly backup freshness check to the operations calendar.
5. Confirm Spaces versioning and lifecycle retention in DO console.

## Security Review

Strengths:

- Server-side auth guards derive tenant context from session, not client input.
- Platform Admin uses `PlatformAccess`, independent of active organization role.
- Impersonation is audited and resolves session identity as the target user while preserving actor metadata.
- Webhooks verify provider signatures or shared secrets.
- Security headers are applied through middleware.
- Rate limiting exists for login and sensitive auth routes.
- Member and PTA invite tokens are hashed, single-use, and expiring.
- Structured production logs avoid raw PII/secrets for the newly added lifecycle events.

Operational concerns:

- `AccountVerificationToken` stores password reset/email verification tokens raw. They are expiring and single-use, but should be hashed like member/PTA invites.
- Rate limiting falls back to process memory if Redis is not configured. This is acceptable with one instance but weak for multi-instance scale.
- Sentry DSN status is ambiguous from readable DO spec.
- Spaces bucket controls were not verified.
- DO app spec redacts secrets; actual secret recovery requires an external vault.
- Stripe account ownership documentation says live keys belonged to a non-final account during prior audit. Reconfirm before paid customer onboarding.
- `STRIPE_PRICE_SMS_ADDON_MONTHLY` was documented as missing in prior SMS/Stripe docs; confirm before selling SMS add-on.

High-risk items:

- Missing external secret vault: high impact for full account recovery.
- Spaces versioning unverified: high impact for object deletion/overwrite.
- Raw password reset tokens: medium/high security hardening item.
- No verified alerting/paging: high operational risk once customers depend on the system.
