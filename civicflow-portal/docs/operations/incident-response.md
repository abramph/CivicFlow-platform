# Incident Response

Last verified: 2026-08-10.

## Severity

Use the existing severity definitions in `incident-severity.md`:

- SEV-1: outage, active data loss/corruption, security breach.
- SEV-2: core feature broken with no data loss.
- SEV-3: bug with workaround or limited edge case.
- SEV-4: cosmetic/minor issue.

## First 15 Minutes

1. Declare incident severity.
2. Assign one incident lead.
3. Capture current time, deployment ID, main SHA, and symptoms.
4. Check `/api/health`.
5. Check DO deployment phase and runtime logs.
6. If deploy-related, identify last good deployment.
7. If data-related, stop writes where practical before repair attempts.
8. Communicate only facts: scope, impact, next update time.

## Diagnosis Checklist

- Is the app container healthy?
- Did a new deployment just go live?
- Did `prisma migrate deploy` apply a migration?
- Is PostgreSQL reachable?
- Are provider webhooks failing?
- Is DNS resolving to DO?
- Are provider credentials valid?
- Are logs showing structured errors with IDs/counts?
- Are Sentry issues present?

## Mitigation Order

1. Roll back bad app deployment if no incompatible migration is involved.
2. Disable or pause affected feature if a narrow provider path is failing.
3. Restore database to a new cluster only for data loss/corruption or destructive migration.
4. Rotate leaked credentials immediately, one provider at a time.
5. Preserve evidence before deleting logs, clusters, or provider records.

## Customer Communication

Do not speculate. Send:

- What is affected.
- Who is affected.
- When it started, if known.
- Current mitigation.
- Next update time.

Do not include raw member data, provider secrets, stack traces, or internal credentials.

## Post-Incident

Within one business day:

- Write root cause.
- Record timeline.
- Record customer impact.
- Record what detection worked and what did not.
- Add one or two concrete prevention tasks.
- Confirm all temporary access, debug logging, test clusters, and emergency env vars are removed.
