# Administrative Seat — Capability Classification Audit (CLOUD-SEAT-A)

Companion to `docs/unestra-cloud-pricing-architecture.md`. This document is the audit
required before any administrative-seat enforcement is written: which of the platform's
129 RBAC permissions (`src/lib/rbac.ts`) represent "material organization-management
authority" (consumes one administrative seat) versus ordinary participation or read-only
visibility (consumes none).

## The rule, and why it's grounded in the existing system rather than invented

**A permission consumes an administrative seat unless it is already part of `READ_ONLY`'s
own default permission bundle.**

This is not an arbitrary line — `READ_ONLY` is the codebase's own pre-existing definition
of "an officer viewing without editing rights" (see its doc comment in `rbac.ts`), and it
is already composed entirely of `*_READ`/`*_VIEW` permissions with zero write, manage,
approve, resolve, close, decide, terminate, refund, publish, or export capability anywhere
in it. Reusing it as the seat-exempt baseline means the classification is derived from a
decision the system's own designers already made per-permission, not a new judgment call
layered on top, and it stays in sync automatically if `READ_ONLY`'s bundle ever changes.

**Classification is by effective, resolved permissions — never by role label.** An org can
customize `ORG_ADMIN`/`FINANCE`/`STAFF`/`READ_ONLY`'s actual permission set per-organization
via `OrgRolePermissionSet` (`src/lib/role-permissions.ts`'s `getEffectivePermissions()`,
already the platform's single authoritative permission resolver, used by
`requirePermission()`/`auth-guards.ts`). If an org trims a nominally-`STAFF` custom role
down to pure read access, that assignment correctly consumes **zero** seats — the
classification follows what the role can actually do in that specific org, not its display
name. `SUPER_ADMIN`/`ORG_OWNER` always resolve to the full owner bundle regardless of any
override (existing hard safety rail in `getEffectivePermissions`), so they always consume a
seat when held as a real `OrganizationMembership` — consistent with owners/admins being the
clearest case of seat-consuming authority. `MEMBER` always resolves to zero permissions
(existing hard safety rail), so it never consumes a seat.

## Non-seat-consuming permissions (28) — READ_ONLY's own bundle

Ordinary read/view access to organizational information. Holding any of these — and
*only* these — does not consume an administrative seat.

| Category | Permissions |
| --- | --- |
| Members / dues / giving | `members:read`, `dues:read`, `contributions:read`, `receipts:read` |
| Operations (read) | `campaigns:read`, `events:read`, `communications:read`, `attendance:read`, `meetings:read` |
| Finance (read) | `expenditures:read`, `budget:read` |
| Directory / reporting | `contacts:read`, `reports:read`, `reminders:read`, `messages:read`, `audit_logs:read` |
| Documents / governance | `documents:read`, `governance:read` |
| PTA (read) | `pta:directory:read`, `pta:analytics:read`, `pta:board:view` |
| HOA (read) | `hoa:properties:read`, `hoa:residents:read`, `hoa:violations:read`, `hoa:architectural-requests:read` |
| Imports / Union / Intake (read) | `imports:read`, `union:cases:read`, `memberIntake:view` |

## Seat-consuming permissions (101)

Everything else — every write, manage, approve, resolve, close, decide, terminate,
refund, publish, export, or connect/manage-financial-infrastructure capability across
every module. Grouped below with the shared reason each group falls on the seat-consuming
side.

| Category | Permissions | Reason |
| --- | --- | --- |
| Member lifecycle | `members:write`, `members:delete`, `members:terminate` | Directly changes or removes another person's record; termination additionally suspends their platform login (materially larger blast radius, per `rbac.ts`'s own comment). |
| Dues / receipts / reimbursements | `dues:write`, `receipts:write`, `budget:manage`, `reimbursements:submit`, `reimbursements:manage`, `expenditures:write` | Creates or authorizes financial obligations/records on the organization's behalf. |
| Contributions & Giving (CORE-GIVE) | `contributions:write`, `contributions:summary:view`, `contributions:individual:view`, `contributions:module:manage`, `contributions:offline:create`, `contributions:refund`, `contributions:export`, `contributions:statements:generate`, `contributions:recurring:manage`, `contributions:pledges:view`, `contributions:pledges:manage`, `contributions:funds:manage`, `contributions:programs:manage`, `contributions:reconciliation:view`, `contributions:segment` | Manages the organization's giving program, or views/exports individually-identifiable donor financial data — sensitive PII access beyond ordinary participation, not just an operational task. |
| Payment link review | `payment_link_reports:review` | Approves a payer's self-reported payment against the organization's records. |
| Campaigns / events / communications / attendance / meetings | `campaigns:write`, `events:write`, `communications:write`, `attendance:write`, `meetings:write`, `meetings:minutes:review`, `meetings:minutes:approve` | Creates or authorizes organization-facing content/records on behalf of the org. |
| Contacts | `contacts:write` | Manages the org's vendor/contact directory. |
| Groups | `groups:view`, `groups:manage`, `groups:members:manage` | Org-wide group administration (distinct from a group leader's own per-group authority, which isn't a permission at all). `groups:view` is included here (not the non-seat list) because it is *administrative* visibility into every group org-wide, not a participant's view of their own group. |
| Stripe / payments infrastructure | `payments:stripe:view`, `payments:stripe:refresh`, `payments:stripe:connect`, `payments:stripe:manage` | Visibility into or control over the organization's real financial infrastructure. |
| Reporting export / reminders | `reports:export`, `reminders:send` | Exporting data or sending organization-wide communications. |
| Organization settings / users / billing | `org_settings:read`, `org_settings:write`, `users:read`, `users:manage`, `billing:read`, `billing:manage` | Core administrative control surface — even the read-only members of this group (`org_settings:read`, `users:read`, `billing:read`) are staff-facing administrative visibility, not participant-facing information. |
| Messaging (officer-initiated) | `messages:write` | Initiating direct officer-to-member conversations on the org's behalf. |
| SMS consent audit | `sms_consent:read` | Compliance/audit visibility into consent records — administrative oversight, not ordinary participation. |
| Documents / governance (write) | `documents:write`, `governance:write` | Publishing or superseding the organization's governing documents. |
| Labs / Meeting Intelligence | `labs:read`, `meetingIntelligence:read`, `meetingIntelligence:create`, `meetingIntelligence:review`, `meetingIntelligence:approve`, `meetingIntelligence:delete` | Internal/experimental platform administration surface, never customer-facing today. |
| PTA operations & governance | `pta:households:manage`, `pta:students:manage`, `pta:dues:manage`, `pta:events:manage`, `pta:volunteers:manage`, `pta:volunteers:checkin`, `pta:volunteer-hours:approve`, `pta:committees:manage`, `pta:fundraising:manage`, `pta:announcements:publish`, `pta:documents:manage`, `pta:minutes:review`, `pta:minutes:approve`, `pta:board:manage`, `pta:school-years:manage` | Managing PTA operational/financial/governance records or the board roster itself. |
| PTA Concerns & Elections | `pta:concerns:view`, `pta:concerns:manage`, `pta:concerns:assign`, `pta:concerns:resolve`, `pta:concerns:export`, `pta:elections:view`, `pta:elections:manage` | Sensitive case/election administration — deliberately granted to no role bundle below `ORG_ADMIN` today, the platform's own strongest signal that this is elevated authority. `pta:concerns:view` is included here (not the non-seat list) because — unlike ordinary read permissions — no default role bundle holds it at all; only `ORG_ADMIN`/`ORG_OWNER` do, confirming it is not participant-facing visibility. |
| HOA Violations & Architectural Requests (write tiers) | `hoa:properties:write`, `hoa:residents:write`, `hoa:violations:write`, `hoa:violations:review`, `hoa:violations:resolve`, `hoa:architectural-requests:write`, `hoa:architectural-requests:review`, `hoa:architectural-requests:decide` | Compliance enforcement and property/resident record administration. |
| Resumable Import Program | `imports:create`, `imports:review`, `imports:resume`, `imports:cancel`, `imports:resolve-duplicates` | Bulk data operations affecting the whole organization's member records. |
| Union Case Center | `union:cases:manage`, `union:cases:notes:internal`, `union:cases:deadlines:manage`, `union:cases:close` | Grievance/representation case administration — steward/board-level authority. |
| Member Intake | `memberIntake:manage`, `memberIntake:publish`, `memberIntake:review`, `memberIntake:export` | Defines what PII a public form collects, publishes it, reviews submissions, or bulk-exports freshly-collected PII. |

## What this audit deliberately does not yet do

This document and `src/lib/admin-seat-policy.ts` (the centralized
`requiresAdministrativeSeat()` policy this audit backs) are CLOUD-SEAT-A only: the
classification and the single decision function. Seat *counting*, *enforcement*,
*reservation for pending invitations*, *overrides*, *grandfathering*, and *UI* are
separate, later milestones (CLOUD-SEAT-B through F) — see
`docs/unestra-cloud-pricing-architecture.md` for the full program sequencing once those
sections are added.
