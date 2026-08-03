# Customer Support Runbook

How to actually handle a support request today, using the tools that exist right now — not an
aspirational future support-desk process. See `docs/incident-severity.md` for how to size a
problem once you understand it, and `docs/customer-data-request-process.md` specifically for
export/deletion requests.

## Where support requests come in

There is no dedicated support-ticketing system yet. Requests arrive by whatever channel the
organization used to reach APH Technologies directly (email, a call, etc.) — there is no in-app
"contact support" widget or ticket queue as of this writing. Log every real request somewhere
durable (even a plain shared doc) so patterns across organizations are visible over time; do not
rely on memory alone.

## First step for almost everything: reproduce it, don't guess

Before assuming a report is a bug, confirm what's actually happening in that organization's data.
The Platform Admin tools (`/admin/platform`, gated by a `PlatformAccess` `SUPER_ADMIN` grant — see
`docs/platform-identity-architecture.md`) give read access to real operational state across every
organization without needing to log in as the customer:

- `/admin/platform/organizations/[organizationId]` — that organization's operational detail (plan,
  member counts, recent activity).
- `/admin/platform/communications` — SMS/email/push volume and failures, if the report is about a
  message that didn't arrive.
- `/admin/platform/audit` (or the organization's own `/audit-logs` page) — the actual sequence of
  actions that led to the reported state.
- `/admin/platform/health` — whether a real dependency (email, SMS, storage) was down at the
  reported time.

Most "it's not working" reports are resolved by finding the actual error in the audit log or
communications log before ever touching impersonation.

## When you need to see exactly what the customer sees: impersonation

Use `/admin/platform/organizations/[organizationId]` → the impersonation panel only when reading
data isn't enough and you need to reproduce the customer's actual UI state (e.g. "I click Save and
nothing happens" — something only visible by driving their exact screen).

**A reason is now required to start a session** — the field will not submit blank. Write a real,
specific reason (e.g. `"member reported dues payment not showing after import — reproducing"`),
not a placeholder like "support". This is not optional formality: `createAuditEvent()` stamps every
action taken during the session with `impersonatedByUserId`/`impersonatedByEmail` (see
`src/lib/audit.ts`), so the reason is what makes that trail meaningful to someone reviewing it
later, including the customer if they ever ask what was accessed and why.

Rules while impersonating:
- Only look at what's needed to resolve the specific report. This is someone else's account.
- End the session (`/api/admin/impersonate/stop`, or the "Stop impersonating" control in the
  impersonation banner) as soon as you're done — sessions also auto-expire after 4 hours
  (`MAX_DURATION_MS` in `src/lib/impersonation.ts`), but don't rely on that.
- Every session start/end is itself an audit event (`platform.impersonation.started`/`.ended`),
  visible at `/admin/platform/impersonation`. Assume it will be reviewed.

## Common request types and where to look

| Report | Where to look first |
|---|---|
| "A member's invite/reset email never arrived" | `/admin/platform/communications`; confirm `ENABLE_EMAIL_SEND` and Brevo delivery in the SMTP logs; check the member's `commsEmailEnabled` preference isn't off (see `src/lib/communication-campaigns.ts`) |
| "An SMS never sent" | SMS Administration (`/admin/platform/sms`) → that org's message log; a message can be FAILED for opt-out, missing consent, or provider error — the row's `errorMessage` says which |
| "Import didn't bring in a row" | Ask for the exact file if possible; every importer (`src/lib/member-import.ts`, `vertical-import.ts`, `migration-import.ts`) returns a per-row status/error, and malformed emails are now rejected with an explicit reason rather than silently dropped (`src/lib/email.ts`) |
| "A payment/dues charge looks wrong" | `/admin/platform/billing` for subscription-level issues; for a specific member's dues, this needs impersonation or a direct read of that org's dues data via the admin tools |
| "I can't log in" / "MFA is stuck" | Check `/admin/platform/people` for that user's account status; MFA lockouts and session issues are a known class of prior bug (see the auth-guards/organization-required fixes) — confirm which error they actually see before assuming it's the same one |

## Escalation

If a report looks like it could be SEV-1 or SEV-2 (see `docs/incident-severity.md`), stop working
it as an individual support ticket and treat it as an incident — the fix path is different (mitigate
first, individual root-cause after) and other organizations may be silently affected too.

## What this runbook deliberately does not cover

- A formal ticketing/SLA system — doesn't exist yet; don't promise response-time commitments a
  one-person operation can't reliably meet.
- Refunds/billing adjustments — those are business decisions, not support actions; see the
  program's explicit "do not change pricing or billing policy without approval" constraint.
