# Launch Checklists

Last verified: 2026-08-10.

## Launch Checklist

- Production app is `ACTIVE`.
- `/api/health` returns `ok: true`.
- Latest PostgreSQL backup is less than 24 hours old.
- Restore procedure has been tested against a temporary cluster.
- Spaces versioning confirmed enabled, or launch risk accepted.
- Sentry DSN verified in DO app spec/console and one real event observed.
- Brevo sending domain verified and test email delivered.
- Stripe live webhook endpoint verified.
- Twilio A2P 10DLC complete before SMS launch.
- Platform Admin Data Health has no critical findings.
- Known data-health warnings have owner and correction plan.
- Customer support runbook is available.
- Emergency rollback owner and credentials are known.

## Customer Onboarding Checklist

Before inviting a customer:

- Create organization with correct vertical.
- Assign owner/admin user.
- Confirm owner can sign in and select organization.
- Configure billing/subscription status.
- Confirm contact domain/sender expectations.
- Import members/households through supported import workflow.
- Run Data Health.
- Fix missing primary contacts and billing identities through product UI.
- Confirm communication recipient preview.
- Confirm one safe email/invite path.
- Train admin on member/household edits, dues, communications, reports, and support escalation.

## Administrator Checklist

For each organization admin:

- Login works.
- Role is correct.
- MFA guidance provided.
- Can access expected vertical dashboard.
- Can manage only permitted areas.
- Can find support/contact path.
- Understands that product UI, not SQL, is the correction path for customer data.
- Understands communication campaign review before send.
- Understands Data Health findings if Platform Admin shares them.

## Support Escalation Checklist

Collect:

- Organization.
- User role.
- Approximate time.
- Action attempted.
- Error text or screenshot.
- Affected resource ID when visible.
- Whether issue affects one user, one organization, or all orgs.

Do not collect:

- Passwords.
- Auth/session cookies.
- Invite/password reset tokens.
- Full payment card data.

Escalate to engineering immediately for:

- Security or tenant isolation concern.
- Payment duplication/loss.
- Data Health critical finding.
- Provider webhook sustained failure.
- App-wide outage.
