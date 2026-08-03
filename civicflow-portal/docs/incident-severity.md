# Incident Severity Definitions

Sized for a single-founder-operated SaaS at pre-first-paying-customer stage (see
`docs/production-deployment.md` and `docs/backup-and-disaster-recovery.md` for the actual
infrastructure this assumes) — not a large on-call rotation. The point of writing this down now,
before there's a real on-call team, is so severity isn't decided in the moment of an actual
incident, and so the definitions are ready to hand to a second person the day one joins.

## Severity levels

### SEV-1 — Critical

Complete outage, data loss/corruption in progress, or a confirmed security breach.

Examples: the app is down for all organizations; the database is unreachable; a bug is actively
double-charging or losing member payment records; evidence of unauthorized cross-tenant data
access; a credential is confirmed leaked/exposed publicly.

Response: drop everything. Fix or mitigate immediately, even with an imperfect stopgap (e.g.
rolling back a bad deploy) before working out the full root cause. Communicate to any affected
organization as soon as there's something concrete to say (not before — see
`docs/customer-support-runbook.md`).

### SEV-2 — High

A core feature is broken for some or all organizations, but the app is otherwise usable and no
data is being lost.

Examples: dues payments can't be recorded for one payment method; CSV import silently fails for a
specific file shape; MFA login is broken for phone-based challenges but not TOTP; a single
organization's data is stuck (not a cross-tenant leak, just broken for them).

Response: fix within the same working day where possible. Communicate to affected organizations if
the issue has been live long enough that they'd reasonably have hit it.

### SEV-3 — Medium

A real bug or gap, but there's a workaround, it affects an edge case, or it's cosmetic-but-notable
(e.g. a confusing error message, a report showing a slightly wrong count).

Response: fix in the normal course of work — no need to interrupt other work in progress. Track it
(see `docs/customer-support-runbook.md`'s bug-intake section) so it doesn't get lost.

### SEV-4 — Low

Cosmetic issues, minor copy problems, non-blocking accessibility gaps, nice-to-have requests.

Response: batch into regular work whenever convenient.

## How to decide severity in the moment

Ask, in order:
1. Is data being lost or exposed right now? → SEV-1, no matter how small the blast radius seems.
2. Is the app usable at all for the affected organization(s)? → No: at least SEV-2.
3. Is there a workaround a reasonable user could find on their own? → Yes: SEV-3 or lower.

When genuinely unsure between two levels, treat it as the more severe one until proven otherwise —
downgrading later costs nothing; discovering a SEV-1 was mistakenly treated as a SEV-3 costs real
data or trust.

## What this doc deliberately does not cover

- Formal SLA response-time commitments to customers — none exist yet; do not promise a specific
  response time in a customer-facing agreement until there's a real support team sized to meet it.
- Automated paging/escalation — see `docs/production-deployment.md`'s "What's not real yet" section
  for exactly what's missing there (no Sentry alerting, no webhook/on-call rotation configured).
  Until that exists, severity is only as good as someone noticing the problem in the first place.
