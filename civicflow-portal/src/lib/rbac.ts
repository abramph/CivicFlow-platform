/**
 * Unestra SaaS — Role-Based Access Control (RBAC)
 *
 * This file defines the canonical roles and permissions for the multi-tenant
 * SaaS platform. It is intentionally kept as pure data (no framework deps)
 * so it can be imported by both server-side middleware and client-side UI.
 *
 * Usage:
 *   import { canDo, ROLES } from '@/lib/rbac';
 *   if (!canDo(session.user.role, 'members:write')) { return forbidden(); }
 */

// ─── Roles ───────────────────────────────────────────────────────────────────

export const ROLES = {
  // Legacy organization role. No longer confers platform-wide access —
  // platform authorization is exclusively PlatformAccess (see
  // src/lib/platform-access.ts) and is entirely independent of any
  // organization membership. Kept here only for type/historical-data
  // compatibility (old AuditEvent rows, etc.); functionally identical to
  // ORG_OWNER within a single org. No membership should be assigned this
  // role going forward — the Users & Roles UI already excludes it.
  SUPER_ADMIN: "SUPER_ADMIN",
  ORG_OWNER:   "ORG_OWNER",    // Organization owner — full access within their org
  ORG_ADMIN:   "ORG_ADMIN",    // Organization admin — manage settings and users
  FINANCE:     "FINANCE",      // Finance officer — dues, contributions, expenditures
  STAFF:       "STAFF",        // General staff — events, campaigns, communications
  READ_ONLY:   "READ_ONLY",    // View-only access — no writes
  MEMBER:      "MEMBER",       // Mobile app member — no staff permissions; scoped to own data via mobile guards only
} as const;

export type Role = keyof typeof ROLES;

// ─── Permissions ─────────────────────────────────────────────────────────────

/**
 * Permission format: "<resource>:<action>"
 * Actions: read | write | delete | manage
 */
export const PERMISSIONS = {
  // Members
  MEMBERS_READ:   "members:read",
  MEMBERS_WRITE:  "members:write",
  MEMBERS_DELETE: "members:delete",
  // Deliberately separate from MEMBERS_WRITE: terminating a member cascades
  // into suspending their platform login access in this org (see
  // docs/member-lifecycle-termination.md), a materially larger blast radius
  // than an ordinary field edit. Mirrors the write/decide separation used
  // for HOA Violations and Architectural Requests.
  MEMBERS_TERMINATE: "members:terminate",

  // Dues
  DUES_READ:  "dues:read",
  DUES_WRITE: "dues:write",

  // Contributions
  CONTRIBUTIONS_READ:  "contributions:read",
  CONTRIBUTIONS_WRITE: "contributions:write",

  // Reviewing a public payer's self-reported offline payment against a
  // Payment Link (see docs/flexible-payment-links.md). Distinct from
  // DUES_WRITE (which gates the member-facing PaymentReport approval) since
  // a payment-link report isn't necessarily dues-related; granted to the
  // same roles that already review PaymentReport for consistency.
  PAYMENT_LINK_REPORTS_REVIEW: "payment_link_reports:review",

  // Receipts
  RECEIPTS_READ:  "receipts:read",
  RECEIPTS_WRITE: "receipts:write",

  // Campaigns
  CAMPAIGNS_READ:  "campaigns:read",
  CAMPAIGNS_WRITE: "campaigns:write",

  // Events
  EVENTS_READ:  "events:read",
  EVENTS_WRITE: "events:write",

  // Communications
  COMMUNICATIONS_READ:  "communications:read",
  COMMUNICATIONS_WRITE: "communications:write",

  // Attendance
  ATTENDANCE_READ:  "attendance:read",
  ATTENDANCE_WRITE: "attendance:write",

  // Meetings
  MEETINGS_READ:  "meetings:read",
  MEETINGS_WRITE: "meetings:write",
  // Meeting minutes approval workflow: deliberately separate from
  // MEETINGS_WRITE (drafting) so a Secretary can draft/submit minutes
  // without also holding review or approval authority, and separate from
  // each other so a reviewer can request changes without being able to
  // give final approval. Mirrors the PTA_MINUTES_REVIEW/APPROVE naming
  // below, which was already reserved for exactly this purpose but never
  // wired up to any real code path.
  MEETINGS_MINUTES_REVIEW:  "meetings:minutes:review",
  MEETINGS_MINUTES_APPROVE: "meetings:minutes:approve",

  // Expenditures
  EXPENDITURES_READ:  "expenditures:read",
  EXPENDITURES_WRITE: "expenditures:write",

  // Finance Lite (PTA-H): budget-vs-actual and the reimbursement workflow.
  // reimbursements:submit is deliberately STAFF-level — chairs and officers
  // file their own requests; approval/payment stays with finance roles, and
  // the lib additionally forbids approving your own request regardless of
  // permissions.
  BUDGET_READ:           "budget:read",
  BUDGET_MANAGE:         "budget:manage",
  REIMBURSEMENTS_SUBMIT: "reimbursements:submit",
  REIMBURSEMENTS_MANAGE: "reimbursements:manage",

  // Institutional contact directory & vendor history (PTA-I) — the org's
  // contacts belong to the organization, not an outgoing officer.
  CONTACTS_READ:  "contacts:read",
  CONTACTS_WRITE: "contacts:write",

  // CORE-GIVE-A (docs/core-contributions-giving.md): the Contributions &
  // Giving capability set. Deliberately granular so organizations can build
  // Financial-Secretary/Treasurer separation-of-duties via OrgRolePermissionSet
  // (§46). Individual giving history is sensitive (§73): NONE of these are
  // granted to STAFF even though the legacy contributions:read/write remain
  // there for the pre-existing fundraising surfaces. Legacy perms gate legacy
  // surfaces; these gate the new module.
  CONTRIBUTIONS_SUMMARY_VIEW:       "contributions:summary:view",
  CONTRIBUTIONS_INDIVIDUAL_VIEW:    "contributions:individual:view",
  CONTRIBUTIONS_MODULE_MANAGE:      "contributions:module:manage",
  CONTRIBUTIONS_OFFLINE_CREATE:     "contributions:offline:create",
  CONTRIBUTIONS_REFUND:             "contributions:refund",
  CONTRIBUTIONS_EXPORT:             "contributions:export",
  CONTRIBUTIONS_STATEMENTS_GENERATE:"contributions:statements:generate",
  CONTRIBUTIONS_RECURRING_MANAGE:   "contributions:recurring:manage",
  CONTRIBUTIONS_PLEDGES_VIEW:       "contributions:pledges:view",
  CONTRIBUTIONS_PLEDGES_MANAGE:     "contributions:pledges:manage",
  CONTRIBUTIONS_FUNDS_MANAGE:       "contributions:funds:manage",
  CONTRIBUTIONS_PROGRAMS_MANAGE:    "contributions:programs:manage",
  CONTRIBUTIONS_RECONCILIATION_VIEW:"contributions:reconciliation:view",
  CONTRIBUTIONS_SEGMENT:            "contributions:segment",

  // CORE-GIVE-I (§40/§41): core groups (ministries/committees/chapters).
  // DELIBERATELY disjoint from every contributions:* capability — group
  // leadership grants zero financial visibility (§111.3); per-group leader
  // powers come from the caller's own OrgGroupMember.isLeader row, not from
  // these org-wide capabilities.
  GROUPS_VIEW:           "groups:view",
  GROUPS_MANAGE:         "groups:manage",
  GROUPS_MEMBERS_MANAGE: "groups:members:manage",

  // CONNECT-A (docs/stripe-connect-architecture.md §6): the organization's
  // Stripe connected account. view/refresh are finance-visible; connect and
  // manage (incl. the controlled disconnect workflow, §26) are org-officer
  // authority — ordinary finance viewers must never reconfigure Stripe.
  PAYMENTS_STRIPE_VIEW:    "payments:stripe:view",
  PAYMENTS_STRIPE_REFRESH: "payments:stripe:refresh",
  PAYMENTS_STRIPE_CONNECT: "payments:stripe:connect",
  PAYMENTS_STRIPE_MANAGE:  "payments:stripe:manage",

  // Reports
  REPORTS_READ:   "reports:read",
  REPORTS_EXPORT: "reports:export",

  // Reminders
  REMINDERS_READ: "reminders:read",
  REMINDERS_SEND: "reminders:send",

  // Organization settings
  ORG_SETTINGS_READ:  "org_settings:read",
  ORG_SETTINGS_WRITE: "org_settings:write",

  // User management (within an org)
  USERS_READ:   "users:read",
  USERS_MANAGE: "users:manage",

  // Billing / subscription
  BILLING_READ:   "billing:read",
  BILLING_MANAGE: "billing:manage",

  // Messaging (officer-to-member direct conversations)
  MESSAGES_READ:  "messages:read",
  MESSAGES_WRITE: "messages:write",

  // Audit logs
  AUDIT_LOGS_READ: "audit_logs:read",

  // SMS consent audit
  SMS_CONSENT_READ: "sms_consent:read",

  // PTA Vertical 2.0, PR PTA-D — core Document Center + Governance Library
  // (see docs/pta-vertical-2.md §10-11). Core permissions, not pta:* —
  // every vertical owns documents and governing rules. Governance write is
  // deliberately NOT granted to STAFF: publishing or superseding bylaws is
  // board-level authority, same reasoning as MEETINGS_MINUTES_APPROVE.
  DOCUMENTS_READ:   "documents:read",
  DOCUMENTS_WRITE:  "documents:write",
  GOVERNANCE_READ:  "governance:read",
  GOVERNANCE_WRITE: "governance:write",

  // Unestra Labs (organization-facing, read-only today — see docs/unestra-labs.md)
  LABS_READ: "labs:read",

  // Meeting Intelligence (Unestra Labs, internal APH pilot — see docs/meeting-intelligence.md).
  // Gated additionally by requireOrganizationLabFeature() — holding one of
  // these permissions is necessary but never sufficient by itself.
  MEETING_INTELLIGENCE_READ:    "meetingIntelligence:read",
  MEETING_INTELLIGENCE_CREATE:  "meetingIntelligence:create",
  MEETING_INTELLIGENCE_REVIEW:  "meetingIntelligence:review",
  MEETING_INTELLIGENCE_APPROVE: "meetingIntelligence:approve",
  MEETING_INTELLIGENCE_DELETE:  "meetingIntelligence:delete",

  // Unestra for PTA — a first-class vertical (see docs/pta-access-architecture.md).
  // Gated additionally by requirePtaAccess()'s primaryVertical === "PTA"
  // check — holding one of these permissions is necessary but never
  // sufficient by itself. Kept granular (directory vs. households vs.
  // students vs. dues, etc.) so an org can map PTA officer titles
  // (President, Treasurer, ...) onto different bundles via the existing
  // OrgRolePermissionSet override system rather than needing new Role enum
  // values.
  PTA_DIRECTORY_READ:     "pta:directory:read",
  PTA_HOUSEHOLDS_MANAGE:  "pta:households:manage",
  PTA_STUDENTS_MANAGE:    "pta:students:manage",
  PTA_DUES_MANAGE:        "pta:dues:manage",
  PTA_EVENTS_MANAGE:      "pta:events:manage",
  PTA_VOLUNTEERS_MANAGE:  "pta:volunteers:manage",
  // Volunteer-hours tracking: deliberately separate from PTA_VOLUNTEERS_MANAGE
  // (creating opportunities/shifts) so an org can, in principle, let a
  // coordinator manage shifts without also being the one who checks people in
  // or approves hours — though today every role bundle below grants them
  // together. Treasurer (FINANCE) deliberately does NOT receive these, per
  // the volunteer-management feature's explicit role guidance — hours are
  // not dues/payments and are not a Treasurer's job by default.
  PTA_VOLUNTEERS_CHECKIN:      "pta:volunteers:checkin",
  PTA_VOLUNTEER_HOURS_APPROVE: "pta:volunteer-hours:approve",
  PTA_COMMITTEES_MANAGE:  "pta:committees:manage",
  PTA_FUNDRAISING_MANAGE: "pta:fundraising:manage",
  PTA_ANNOUNCEMENTS_PUBLISH: "pta:announcements:publish",
  PTA_DOCUMENTS_MANAGE:   "pta:documents:manage",
  PTA_MINUTES_REVIEW:     "pta:minutes:review",
  PTA_MINUTES_APPROVE:    "pta:minutes:approve",
  PTA_ANALYTICS_READ:     "pta:analytics:read",
  // PTA Vertical 2.0, PR PTA-A (see docs/pta-vertical-2.md): board & school-year
  // foundation. view/manage split so a treasurer or secretary can always SEE
  // the board roster and leadership history, while changing positions or
  // assigning officers stays board-level authority. School-year management
  // (creating the next year, flipping the current one) is its own permission —
  // it re-scopes what "current" means for households/volunteers/classrooms
  // org-wide, which is bigger than any single feature's manage right.
  PTA_BOARD_VIEW:          "pta:board:view",
  PTA_BOARD_MANAGE:        "pta:board:manage",
  PTA_SCHOOL_YEARS_MANAGE: "pta:school-years:manage",
  // PTA Vertical 2.0, PR PTA-E — Concerns & Grievances. Deliberately granted
  // to NO role bundle below ORG_ADMIN: a case must never be visible merely
  // because someone helps run events or finances. Even holders of these
  // permissions cannot read a case marked restricted unless they are
  // explicitly assigned to it (see src/lib/labs/pta/concerns.ts).
  PTA_CONCERNS_VIEW:    "pta:concerns:view",
  PTA_CONCERNS_MANAGE:  "pta:concerns:manage",
  PTA_CONCERNS_ASSIGN:  "pta:concerns:assign",
  PTA_CONCERNS_RESOLVE: "pta:concerns:resolve",
  PTA_CONCERNS_EXPORT:  "pta:concerns:export",

  // PTA Vertical 2.0, PR PTA-L — elections. Granted to NO bundle below
  // ORG_ADMIN; voting itself is linkage-gated (snapshotted household
  // adults), never a permission. The whole surface is additionally dark
  // until PtaProfile.electionsEnabled is switched on per org.
  PTA_ELECTIONS_VIEW:   "pta:elections:view",
  PTA_ELECTIONS_MANAGE: "pta:elections:manage",

  // Volunteer Hour Requirements & Buyout program (docs/pta-volunteer-hours.md).
  // Dark until PtaProfile.ptaVolunteer*Enabled + the platform env kill-switch
  // are on (see labs/pta/volunteer-hours/guard.ts) — holding one of these is
  // necessary but never sufficient. Split mirrors the existing "hours aren't
  // a Treasurer's job" rule (see PTA_VOLUNTEERS_CHECKIN comment above):
  // requirements/assessment authority sits with STAFF/board roles, while the
  // money side (pricing, payments, refunds, financial reports) sits with
  // FINANCE — the two overlap only through reports:view/export, which both
  // hold. "View reports" is deliberately separate from "view FINANCIAL
  // reports" so a coordinator can see hours without seeing dollars.
  PTA_VOLUNTEER_REQUIREMENTS_VIEW:         "pta:volunteer-requirements:view",
  PTA_VOLUNTEER_REQUIREMENTS_MANAGE:       "pta:volunteer-requirements:manage",
  PTA_VOLUNTEER_REQUIREMENTS_ADJUST_FAMILY: "pta:volunteer-requirements:adjust-family",
  PTA_VOLUNTEER_BUYOUT_PRICING_MANAGE:     "pta:volunteer-buyout-pricing:manage",
  PTA_VOLUNTEER_REPORTS_VIEW:              "pta:volunteer-reports:view",
  PTA_VOLUNTEER_REPORTS_EXPORT:            "pta:volunteer-reports:export",
  PTA_VOLUNTEER_FINANCIAL_REPORTS_VIEW:    "pta:volunteer-financial-reports:view",
  PTA_VOLUNTEER_ASSESSMENTS_PREVIEW_POST:  "pta:volunteer-assessments:preview-post",
  PTA_VOLUNTEER_PAYMENTS_RECORD_OFFLINE:   "pta:volunteer-payments:record-offline",
  PTA_VOLUNTEER_PAYMENTS_REFUND:           "pta:volunteer-payments:refund",
  PTA_VOLUNTEER_AUDIT_VIEW:                "pta:volunteer-audit:view",

  // Unestra for HOA — Property/Resident foundation (PR #43, see
  // docs/hoa-domain-model.md and docs/hoa-navigation-proposal.md). Gated
  // additionally by requireHoaCapability()'s primaryVertical === "HOA"
  // check — holding one of these permissions is necessary but never
  // sufficient by itself. Read/write split (not PTA's read/manage
  // convention) deliberately matches the base Community permission
  // naming (MEMBERS_READ/WRITE, DUES_READ/WRITE, ...) above, since HOA
  // reuses far more of the generic surface than PTA did — see
  // docs/hoa-navigation-proposal.md's "key architectural recommendation."
  HOA_PROPERTIES_READ:  "hoa:properties:read",
  HOA_PROPERTIES_WRITE: "hoa:properties:write",
  HOA_RESIDENTS_READ:   "hoa:residents:read",
  HOA_RESIDENTS_WRITE:  "hoa:residents:write",

  // Unestra for HOA — Violations MVP. Four separate actions (not just
  // read/write, unlike Properties/Residents above) because the workflow
  // itself has distinct authority levels: creating/editing a draft is a
  // lower bar than deciding to move a violation through officer review, and
  // resolving/dismissing it (the terminal, compliance-record-closing
  // action) is higher-authority still than either. Gated additionally by
  // requireHoaCapability()'s "violations" flag (see
  // src/lib/vertical-capabilities.ts) — holding one of these is necessary
  // but never sufficient by itself. A resident's own read access to their
  // own property's violations does NOT go through this permission set at
  // all — see requireHoaViolationResidentAccess() in
  // src/lib/hoa/violations-guard.ts, mirroring the documented pattern
  // above for parent/household self-service.
  HOA_VIOLATIONS_READ:    "hoa:violations:read",
  HOA_VIOLATIONS_WRITE:   "hoa:violations:write",
  HOA_VIOLATIONS_REVIEW:  "hoa:violations:review",
  HOA_VIOLATIONS_RESOLVE: "hoa:violations:resolve",

  // Architectural Requests -- same four-tier authority shape as Violations
  // just above, for the same reason: submitting/editing a draft is a lower
  // bar than moving a request through review, and deciding it (approve/
  // conditionally-approve/deny, the terminal action) is higher-authority
  // still. Gated additionally by requireHoaCapability()'s
  // "architecturalRequests" flag. A resident's own read/write access to
  // their own submissions does NOT go through this permission set at all
  // -- see requireArchitecturalRequestResidentAccess() in
  // src/lib/hoa/architectural-requests-guard.ts, mirroring
  // requireHoaViolationResidentAccess()'s pattern.
  HOA_ARCHITECTURAL_REQUESTS_READ:   "hoa:architectural-requests:read",
  HOA_ARCHITECTURAL_REQUESTS_WRITE:  "hoa:architectural-requests:write",
  HOA_ARCHITECTURAL_REQUESTS_REVIEW: "hoa:architectural-requests:review",
  HOA_ARCHITECTURAL_REQUESTS_DECIDE: "hoa:architectural-requests:decide",

  // Resumable Import Program (PR A) — six tiers rather than the usual
  // read/write pair because uploading a file, deciding what to do with a
  // possible duplicate, resuming a plan-limit-paused batch, and canceling
  // one are meaningfully different authority levels (mirrors HOA
  // Violations/Architectural Requests' multi-tier shape just above).
  // Combined with the existing members:write/checkMemberLimit-style guards
  // at the route layer -- holding one of these is necessary but never
  // sufficient by itself.
  IMPORTS_READ:               "imports:read",
  IMPORTS_CREATE:              "imports:create",
  IMPORTS_REVIEW:               "imports:review",
  IMPORTS_RESUME:               "imports:resume",
  IMPORTS_CANCEL:                "imports:cancel",
  IMPORTS_RESOLVE_DUPLICATES:    "imports:resolve-duplicates",

  // Union Case Center (UNION-CASE-A) — grievance & representation case
  // management. Five tiers rather than the usual read/write pair: viewing
  // the org's cases, general case administration (triage/assign/reassign/
  // status/member-visible updates/contract references), adding INTERNAL
  // (union-staff-only) notes, and managing deadlines are all meaningfully
  // different authority levels, and closing/resolving is the terminal,
  // record-closing action reserved for board-level authority — same
  // multi-tier reasoning as HOA Violations/Architectural Requests above.
  // Gated additionally by requireUnionCaseCapability()'s "caseManagement"
  // flag (see src/lib/vertical-capabilities.ts) — holding one of these is
  // necessary but never sufficient by itself. A member's own submit/view of
  // their own case does NOT go through this permission set at all — see
  // requireUnionCaseMemberAccess() in src/lib/union/cases-guard.ts,
  // mirroring requireArchitecturalRequestResidentAccess()'s pattern.
  UNION_CASES_READ:             "union:cases:read",
  UNION_CASES_MANAGE:           "union:cases:manage",
  UNION_CASES_NOTES_INTERNAL:   "union:cases:notes:internal",
  UNION_CASES_DEADLINES_MANAGE: "union:cases:deadlines:manage",
  UNION_CASES_CLOSE:            "union:cases:close",

  // Member Intake & Profile Update (MEMBER-QR-A) — a shared platform
  // capability (QR/link-based public forms that create or update members),
  // never forked per vertical. view/review are the day-to-day operational
  // tier (mirrors STAFF's MEMBERS_WRITE-level authority); manage/publish/
  // export are reserved for ORG_ADMIN+ since they define what PII a
  // public, unauthenticated surface collects and control bulk export of
  // freshly-submitted PII — a materially bigger blast radius than
  // reviewing one submission at a time. Deliberately NO grant to FINANCE:
  // membership intake is an ops/membership function, not a financial one,
  // same reasoning as FINANCE holding zero UNION_CASES_* permission above.
  MEMBER_INTAKE_VIEW:    "memberIntake:view",
  MEMBER_INTAKE_MANAGE:  "memberIntake:manage",
  MEMBER_INTAKE_PUBLISH: "memberIntake:publish",
  MEMBER_INTAKE_REVIEW:  "memberIntake:review",
  MEMBER_INTAKE_EXPORT:  "memberIntake:export",
} as const;

// Parent/household-adult self-service (view own household, RSVP, pay own
// dues, claim a volunteer slot) is deliberately NOT modeled as a Permission
// here — it goes through a dedicated guard scoped to the caller's own linked
// PtaHouseholdAdult.userId (see src/lib/labs/pta/guard.ts's requirePtaHouseholdSelfAccess()),
// mirroring the existing mobile/member-portal pattern documented on
// ROLE_PERMISSIONS.MEMBER below: "All mobile/member data access goes through
// dedicated ... guards scoped to the caller's own linked ... record, never
// through canDo()/requirePermission()." A MEMBER-role user must continue to
// hold zero entries in ROLE_PERMISSIONS — self-service PTA access is
// authorized by household linkage, not by any permission grant.

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// ─── Role → Permission map ────────────────────────────────────────────────────

// SUPER_ADMIN's org-scoped permissions equal ORG_OWNER's exactly — this
// role must never carry any permission ORG_OWNER doesn't already have.
// Cross-org ("platform") reach comes exclusively from PlatformAccess and is
// never modeled as an entry in this org-scoped Permission set.
const ORG_OWNER_PERMISSIONS: Permission[] = [
  PERMISSIONS.MEMBERS_READ,
  PERMISSIONS.MEMBERS_WRITE,
  PERMISSIONS.MEMBERS_DELETE,
  PERMISSIONS.MEMBERS_TERMINATE,
  PERMISSIONS.DUES_READ,
  PERMISSIONS.DUES_WRITE,
  PERMISSIONS.CONTRIBUTIONS_READ,
  PERMISSIONS.CONTRIBUTIONS_WRITE,
  PERMISSIONS.PAYMENT_LINK_REPORTS_REVIEW,
  PERMISSIONS.RECEIPTS_READ,
  PERMISSIONS.RECEIPTS_WRITE,
  PERMISSIONS.CAMPAIGNS_READ,
  PERMISSIONS.CAMPAIGNS_WRITE,
  PERMISSIONS.EVENTS_READ,
  PERMISSIONS.EVENTS_WRITE,
  PERMISSIONS.COMMUNICATIONS_READ,
  PERMISSIONS.COMMUNICATIONS_WRITE,
  PERMISSIONS.ATTENDANCE_READ,
  PERMISSIONS.ATTENDANCE_WRITE,
  PERMISSIONS.MEETINGS_READ,
  PERMISSIONS.MEETINGS_WRITE,
  PERMISSIONS.MEETINGS_MINUTES_REVIEW,
  PERMISSIONS.MEETINGS_MINUTES_APPROVE,
  PERMISSIONS.EXPENDITURES_READ,
  PERMISSIONS.EXPENDITURES_WRITE,
  PERMISSIONS.BUDGET_READ,
  PERMISSIONS.BUDGET_MANAGE,
  PERMISSIONS.REIMBURSEMENTS_SUBMIT,
  PERMISSIONS.REIMBURSEMENTS_MANAGE,
  PERMISSIONS.CONTACTS_READ,
  PERMISSIONS.CONTACTS_WRITE,
  PERMISSIONS.CONTRIBUTIONS_SUMMARY_VIEW,
  PERMISSIONS.CONTRIBUTIONS_INDIVIDUAL_VIEW,
  PERMISSIONS.CONTRIBUTIONS_MODULE_MANAGE,
  PERMISSIONS.CONTRIBUTIONS_OFFLINE_CREATE,
  PERMISSIONS.CONTRIBUTIONS_REFUND,
  PERMISSIONS.CONTRIBUTIONS_EXPORT,
  PERMISSIONS.CONTRIBUTIONS_STATEMENTS_GENERATE,
  PERMISSIONS.CONTRIBUTIONS_RECURRING_MANAGE,
  PERMISSIONS.CONTRIBUTIONS_PLEDGES_VIEW,
  PERMISSIONS.CONTRIBUTIONS_PLEDGES_MANAGE,
  PERMISSIONS.CONTRIBUTIONS_FUNDS_MANAGE,
  PERMISSIONS.CONTRIBUTIONS_PROGRAMS_MANAGE,
  PERMISSIONS.CONTRIBUTIONS_RECONCILIATION_VIEW,
  PERMISSIONS.CONTRIBUTIONS_SEGMENT,
  PERMISSIONS.GROUPS_VIEW,
  PERMISSIONS.GROUPS_MANAGE,
  PERMISSIONS.GROUPS_MEMBERS_MANAGE,
  PERMISSIONS.PAYMENTS_STRIPE_VIEW,
  PERMISSIONS.PAYMENTS_STRIPE_REFRESH,
  PERMISSIONS.PAYMENTS_STRIPE_CONNECT,
  PERMISSIONS.PAYMENTS_STRIPE_MANAGE,
  PERMISSIONS.REPORTS_READ,
  PERMISSIONS.REPORTS_EXPORT,
  PERMISSIONS.REMINDERS_READ,
  PERMISSIONS.REMINDERS_SEND,
  PERMISSIONS.ORG_SETTINGS_READ,
  PERMISSIONS.ORG_SETTINGS_WRITE,
  PERMISSIONS.USERS_READ,
  PERMISSIONS.USERS_MANAGE,
  PERMISSIONS.BILLING_READ,
  PERMISSIONS.BILLING_MANAGE,
  PERMISSIONS.MESSAGES_READ,
  PERMISSIONS.MESSAGES_WRITE,
  PERMISSIONS.AUDIT_LOGS_READ,
  PERMISSIONS.SMS_CONSENT_READ,
  PERMISSIONS.LABS_READ,
  PERMISSIONS.MEETING_INTELLIGENCE_READ,
  PERMISSIONS.MEETING_INTELLIGENCE_CREATE,
  PERMISSIONS.MEETING_INTELLIGENCE_REVIEW,
  PERMISSIONS.MEETING_INTELLIGENCE_APPROVE,
  PERMISSIONS.MEETING_INTELLIGENCE_DELETE,
  PERMISSIONS.PTA_DIRECTORY_READ,
  PERMISSIONS.PTA_HOUSEHOLDS_MANAGE,
  PERMISSIONS.PTA_STUDENTS_MANAGE,
  PERMISSIONS.PTA_DUES_MANAGE,
  PERMISSIONS.PTA_EVENTS_MANAGE,
  PERMISSIONS.PTA_VOLUNTEERS_MANAGE,
  PERMISSIONS.PTA_VOLUNTEERS_CHECKIN,
  PERMISSIONS.PTA_VOLUNTEER_HOURS_APPROVE,
  PERMISSIONS.PTA_COMMITTEES_MANAGE,
  PERMISSIONS.PTA_FUNDRAISING_MANAGE,
  PERMISSIONS.PTA_ANNOUNCEMENTS_PUBLISH,
  PERMISSIONS.PTA_DOCUMENTS_MANAGE,
  PERMISSIONS.PTA_MINUTES_REVIEW,
  PERMISSIONS.PTA_MINUTES_APPROVE,
  PERMISSIONS.PTA_ANALYTICS_READ,
  PERMISSIONS.PTA_BOARD_VIEW,
  PERMISSIONS.PTA_BOARD_MANAGE,
  PERMISSIONS.PTA_SCHOOL_YEARS_MANAGE,
  PERMISSIONS.PTA_CONCERNS_VIEW,
  PERMISSIONS.PTA_CONCERNS_MANAGE,
  PERMISSIONS.PTA_CONCERNS_ASSIGN,
  PERMISSIONS.PTA_CONCERNS_RESOLVE,
  PERMISSIONS.PTA_CONCERNS_EXPORT,
  PERMISSIONS.PTA_ELECTIONS_VIEW,
  PERMISSIONS.PTA_ELECTIONS_MANAGE,
  PERMISSIONS.PTA_VOLUNTEER_REQUIREMENTS_VIEW,
  PERMISSIONS.PTA_VOLUNTEER_REQUIREMENTS_MANAGE,
  PERMISSIONS.PTA_VOLUNTEER_REQUIREMENTS_ADJUST_FAMILY,
  PERMISSIONS.PTA_VOLUNTEER_BUYOUT_PRICING_MANAGE,
  PERMISSIONS.PTA_VOLUNTEER_REPORTS_VIEW,
  PERMISSIONS.PTA_VOLUNTEER_REPORTS_EXPORT,
  PERMISSIONS.PTA_VOLUNTEER_FINANCIAL_REPORTS_VIEW,
  PERMISSIONS.PTA_VOLUNTEER_ASSESSMENTS_PREVIEW_POST,
  PERMISSIONS.PTA_VOLUNTEER_PAYMENTS_RECORD_OFFLINE,
  PERMISSIONS.PTA_VOLUNTEER_PAYMENTS_REFUND,
  PERMISSIONS.PTA_VOLUNTEER_AUDIT_VIEW,
  PERMISSIONS.DOCUMENTS_READ,
  PERMISSIONS.DOCUMENTS_WRITE,
  PERMISSIONS.GOVERNANCE_READ,
  PERMISSIONS.GOVERNANCE_WRITE,
  PERMISSIONS.HOA_PROPERTIES_READ,
  PERMISSIONS.HOA_PROPERTIES_WRITE,
  PERMISSIONS.HOA_RESIDENTS_READ,
  PERMISSIONS.HOA_RESIDENTS_WRITE,
  PERMISSIONS.HOA_VIOLATIONS_READ,
  PERMISSIONS.HOA_VIOLATIONS_WRITE,
  PERMISSIONS.HOA_VIOLATIONS_REVIEW,
  PERMISSIONS.HOA_VIOLATIONS_RESOLVE,
  PERMISSIONS.HOA_ARCHITECTURAL_REQUESTS_READ,
  PERMISSIONS.HOA_ARCHITECTURAL_REQUESTS_WRITE,
  PERMISSIONS.HOA_ARCHITECTURAL_REQUESTS_REVIEW,
  PERMISSIONS.HOA_ARCHITECTURAL_REQUESTS_DECIDE,
  PERMISSIONS.IMPORTS_READ,
  PERMISSIONS.IMPORTS_CREATE,
  PERMISSIONS.IMPORTS_REVIEW,
  PERMISSIONS.IMPORTS_RESUME,
  PERMISSIONS.IMPORTS_CANCEL,
  PERMISSIONS.IMPORTS_RESOLVE_DUPLICATES,
  PERMISSIONS.UNION_CASES_READ,
  PERMISSIONS.UNION_CASES_MANAGE,
  PERMISSIONS.UNION_CASES_NOTES_INTERNAL,
  PERMISSIONS.UNION_CASES_DEADLINES_MANAGE,
  PERMISSIONS.UNION_CASES_CLOSE,
  PERMISSIONS.MEMBER_INTAKE_VIEW,
  PERMISSIONS.MEMBER_INTAKE_MANAGE,
  PERMISSIONS.MEMBER_INTAKE_PUBLISH,
  PERMISSIONS.MEMBER_INTAKE_REVIEW,
  PERMISSIONS.MEMBER_INTAKE_EXPORT,
];

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SUPER_ADMIN: ORG_OWNER_PERMISSIONS,

  ORG_OWNER: ORG_OWNER_PERMISSIONS,

  ORG_ADMIN: [
    PERMISSIONS.MEMBERS_READ,
    PERMISSIONS.MEMBERS_WRITE,
    PERMISSIONS.MEMBERS_TERMINATE,
    PERMISSIONS.DUES_READ,
    PERMISSIONS.DUES_WRITE,
    PERMISSIONS.CONTRIBUTIONS_READ,
    PERMISSIONS.CONTRIBUTIONS_WRITE,
    PERMISSIONS.PAYMENT_LINK_REPORTS_REVIEW,
    PERMISSIONS.RECEIPTS_READ,
    PERMISSIONS.RECEIPTS_WRITE,
    PERMISSIONS.CAMPAIGNS_READ,
    PERMISSIONS.CAMPAIGNS_WRITE,
    PERMISSIONS.EVENTS_READ,
    PERMISSIONS.EVENTS_WRITE,
    PERMISSIONS.COMMUNICATIONS_READ,
    PERMISSIONS.COMMUNICATIONS_WRITE,
    PERMISSIONS.ATTENDANCE_READ,
    PERMISSIONS.ATTENDANCE_WRITE,
    PERMISSIONS.MEETINGS_READ,
    PERMISSIONS.MEETINGS_WRITE,
    PERMISSIONS.MEETINGS_MINUTES_REVIEW,
    PERMISSIONS.MEETINGS_MINUTES_APPROVE,
    PERMISSIONS.EXPENDITURES_READ,
    PERMISSIONS.EXPENDITURES_WRITE,
    PERMISSIONS.BUDGET_READ,
    PERMISSIONS.BUDGET_MANAGE,
    PERMISSIONS.REIMBURSEMENTS_SUBMIT,
    PERMISSIONS.REIMBURSEMENTS_MANAGE,
    PERMISSIONS.CONTACTS_READ,
    PERMISSIONS.CONTACTS_WRITE,
    PERMISSIONS.CONTRIBUTIONS_SUMMARY_VIEW,
    PERMISSIONS.CONTRIBUTIONS_INDIVIDUAL_VIEW,
    PERMISSIONS.CONTRIBUTIONS_MODULE_MANAGE,
    PERMISSIONS.CONTRIBUTIONS_OFFLINE_CREATE,
    PERMISSIONS.CONTRIBUTIONS_REFUND,
    PERMISSIONS.CONTRIBUTIONS_EXPORT,
    PERMISSIONS.CONTRIBUTIONS_STATEMENTS_GENERATE,
    PERMISSIONS.CONTRIBUTIONS_RECURRING_MANAGE,
    PERMISSIONS.CONTRIBUTIONS_PLEDGES_VIEW,
    PERMISSIONS.CONTRIBUTIONS_PLEDGES_MANAGE,
    PERMISSIONS.CONTRIBUTIONS_FUNDS_MANAGE,
    PERMISSIONS.CONTRIBUTIONS_PROGRAMS_MANAGE,
    PERMISSIONS.CONTRIBUTIONS_RECONCILIATION_VIEW,
    PERMISSIONS.CONTRIBUTIONS_SEGMENT,
    PERMISSIONS.GROUPS_VIEW,
    PERMISSIONS.GROUPS_MANAGE,
    PERMISSIONS.GROUPS_MEMBERS_MANAGE,
    PERMISSIONS.PAYMENTS_STRIPE_VIEW,
    PERMISSIONS.PAYMENTS_STRIPE_REFRESH,
    PERMISSIONS.PAYMENTS_STRIPE_CONNECT,
    PERMISSIONS.PAYMENTS_STRIPE_MANAGE,
    PERMISSIONS.REPORTS_READ,
    PERMISSIONS.REPORTS_EXPORT,
    PERMISSIONS.REMINDERS_READ,
    PERMISSIONS.REMINDERS_SEND,
    PERMISSIONS.ORG_SETTINGS_READ,
    PERMISSIONS.ORG_SETTINGS_WRITE,
    PERMISSIONS.USERS_READ,
    PERMISSIONS.USERS_MANAGE,
    PERMISSIONS.BILLING_READ,
    PERMISSIONS.MESSAGES_READ,
    PERMISSIONS.MESSAGES_WRITE,
    PERMISSIONS.AUDIT_LOGS_READ,
    PERMISSIONS.SMS_CONSENT_READ,
    PERMISSIONS.LABS_READ,
    PERMISSIONS.MEETING_INTELLIGENCE_READ,
    PERMISSIONS.MEETING_INTELLIGENCE_CREATE,
    PERMISSIONS.MEETING_INTELLIGENCE_REVIEW,
    PERMISSIONS.MEETING_INTELLIGENCE_APPROVE,
    PERMISSIONS.MEETING_INTELLIGENCE_DELETE,
    PERMISSIONS.PTA_DIRECTORY_READ,
    PERMISSIONS.PTA_HOUSEHOLDS_MANAGE,
    PERMISSIONS.PTA_STUDENTS_MANAGE,
    PERMISSIONS.PTA_DUES_MANAGE,
    PERMISSIONS.PTA_EVENTS_MANAGE,
    PERMISSIONS.PTA_VOLUNTEERS_MANAGE,
  PERMISSIONS.PTA_VOLUNTEERS_CHECKIN,
  PERMISSIONS.PTA_VOLUNTEER_HOURS_APPROVE,
    PERMISSIONS.PTA_COMMITTEES_MANAGE,
    PERMISSIONS.PTA_FUNDRAISING_MANAGE,
    PERMISSIONS.PTA_ANNOUNCEMENTS_PUBLISH,
    PERMISSIONS.PTA_DOCUMENTS_MANAGE,
    PERMISSIONS.PTA_MINUTES_REVIEW,
    PERMISSIONS.PTA_MINUTES_APPROVE,
    PERMISSIONS.PTA_ANALYTICS_READ,
    PERMISSIONS.PTA_BOARD_VIEW,
    PERMISSIONS.PTA_BOARD_MANAGE,
    PERMISSIONS.PTA_SCHOOL_YEARS_MANAGE,
    PERMISSIONS.PTA_CONCERNS_VIEW,
    PERMISSIONS.PTA_CONCERNS_MANAGE,
    PERMISSIONS.PTA_CONCERNS_ASSIGN,
    PERMISSIONS.PTA_CONCERNS_RESOLVE,
    PERMISSIONS.PTA_CONCERNS_EXPORT,
    PERMISSIONS.PTA_ELECTIONS_VIEW,
    PERMISSIONS.PTA_ELECTIONS_MANAGE,
    PERMISSIONS.PTA_VOLUNTEER_REQUIREMENTS_VIEW,
    PERMISSIONS.PTA_VOLUNTEER_REQUIREMENTS_MANAGE,
    PERMISSIONS.PTA_VOLUNTEER_REQUIREMENTS_ADJUST_FAMILY,
    PERMISSIONS.PTA_VOLUNTEER_BUYOUT_PRICING_MANAGE,
    PERMISSIONS.PTA_VOLUNTEER_REPORTS_VIEW,
    PERMISSIONS.PTA_VOLUNTEER_REPORTS_EXPORT,
    PERMISSIONS.PTA_VOLUNTEER_FINANCIAL_REPORTS_VIEW,
    PERMISSIONS.PTA_VOLUNTEER_ASSESSMENTS_PREVIEW_POST,
    PERMISSIONS.PTA_VOLUNTEER_PAYMENTS_RECORD_OFFLINE,
    PERMISSIONS.PTA_VOLUNTEER_PAYMENTS_REFUND,
    PERMISSIONS.PTA_VOLUNTEER_AUDIT_VIEW,
    PERMISSIONS.DOCUMENTS_READ,
    PERMISSIONS.DOCUMENTS_WRITE,
    PERMISSIONS.GOVERNANCE_READ,
    PERMISSIONS.GOVERNANCE_WRITE,
    PERMISSIONS.HOA_PROPERTIES_READ,
    PERMISSIONS.HOA_PROPERTIES_WRITE,
    PERMISSIONS.HOA_RESIDENTS_READ,
    PERMISSIONS.HOA_RESIDENTS_WRITE,
    PERMISSIONS.HOA_VIOLATIONS_READ,
    PERMISSIONS.HOA_VIOLATIONS_WRITE,
    PERMISSIONS.HOA_VIOLATIONS_REVIEW,
    PERMISSIONS.HOA_VIOLATIONS_RESOLVE,
    PERMISSIONS.HOA_ARCHITECTURAL_REQUESTS_READ,
    PERMISSIONS.HOA_ARCHITECTURAL_REQUESTS_WRITE,
    PERMISSIONS.HOA_ARCHITECTURAL_REQUESTS_REVIEW,
    PERMISSIONS.HOA_ARCHITECTURAL_REQUESTS_DECIDE,
    PERMISSIONS.IMPORTS_READ,
    PERMISSIONS.IMPORTS_CREATE,
    PERMISSIONS.IMPORTS_REVIEW,
    PERMISSIONS.IMPORTS_RESUME,
    PERMISSIONS.IMPORTS_CANCEL,
    PERMISSIONS.IMPORTS_RESOLVE_DUPLICATES,
    PERMISSIONS.UNION_CASES_READ,
    PERMISSIONS.UNION_CASES_MANAGE,
    PERMISSIONS.UNION_CASES_NOTES_INTERNAL,
    PERMISSIONS.UNION_CASES_DEADLINES_MANAGE,
    PERMISSIONS.UNION_CASES_CLOSE,
    PERMISSIONS.MEMBER_INTAKE_VIEW,
    PERMISSIONS.MEMBER_INTAKE_MANAGE,
    PERMISSIONS.MEMBER_INTAKE_PUBLISH,
    PERMISSIONS.MEMBER_INTAKE_REVIEW,
    PERMISSIONS.MEMBER_INTAKE_EXPORT,
  ],

  // Maps naturally onto "Treasurer" via OrgRolePermissionSet if an org wants
  // to trim this down further — dues/analytics is the natural FINANCE-shaped
  // subset of the PTA bundle.
  FINANCE: [
    PERMISSIONS.MEMBERS_READ,
    PERMISSIONS.DUES_READ,
    PERMISSIONS.DUES_WRITE,
    PERMISSIONS.CONTRIBUTIONS_READ,
    PERMISSIONS.CONTRIBUTIONS_WRITE,
    PERMISSIONS.PAYMENT_LINK_REPORTS_REVIEW,
    PERMISSIONS.COMMUNICATIONS_READ,
    PERMISSIONS.ATTENDANCE_READ,
    PERMISSIONS.MEETINGS_READ,
    PERMISSIONS.RECEIPTS_READ,
    PERMISSIONS.RECEIPTS_WRITE,
    PERMISSIONS.EXPENDITURES_READ,
    PERMISSIONS.EXPENDITURES_WRITE,
    PERMISSIONS.BUDGET_READ,
    PERMISSIONS.BUDGET_MANAGE,
    PERMISSIONS.REIMBURSEMENTS_SUBMIT,
    PERMISSIONS.REIMBURSEMENTS_MANAGE,
    PERMISSIONS.CONTACTS_READ,
    PERMISSIONS.CONTACTS_WRITE,
    // CORE-GIVE-I: the giving bundle FINANCE was always meant to hold ("all
    // but segment" per CORE-GIVE-A's design) — A's patch accidentally placed
    // this block into ORG_ADMIN twice instead of here.
    PERMISSIONS.CONTRIBUTIONS_SUMMARY_VIEW,
    PERMISSIONS.CONTRIBUTIONS_INDIVIDUAL_VIEW,
    PERMISSIONS.CONTRIBUTIONS_MODULE_MANAGE,
    PERMISSIONS.CONTRIBUTIONS_OFFLINE_CREATE,
    PERMISSIONS.CONTRIBUTIONS_REFUND,
    PERMISSIONS.CONTRIBUTIONS_EXPORT,
    PERMISSIONS.CONTRIBUTIONS_STATEMENTS_GENERATE,
    PERMISSIONS.CONTRIBUTIONS_RECURRING_MANAGE,
    PERMISSIONS.CONTRIBUTIONS_PLEDGES_VIEW,
    PERMISSIONS.CONTRIBUTIONS_PLEDGES_MANAGE,
    PERMISSIONS.CONTRIBUTIONS_FUNDS_MANAGE,
    PERMISSIONS.CONTRIBUTIONS_PROGRAMS_MANAGE,
    PERMISSIONS.CONTRIBUTIONS_RECONCILIATION_VIEW,
    PERMISSIONS.GROUPS_VIEW,
    PERMISSIONS.PAYMENTS_STRIPE_VIEW,
    PERMISSIONS.PAYMENTS_STRIPE_REFRESH,
    PERMISSIONS.REPORTS_READ,
    PERMISSIONS.REPORTS_EXPORT,
    PERMISSIONS.REMINDERS_READ,
    PERMISSIONS.REMINDERS_SEND,
    PERMISSIONS.MESSAGES_READ,
    PERMISSIONS.MESSAGES_WRITE,
    PERMISSIONS.AUDIT_LOGS_READ,
    PERMISSIONS.SMS_CONSENT_READ,
    PERMISSIONS.PTA_DIRECTORY_READ,
    PERMISSIONS.PTA_HOUSEHOLDS_MANAGE,
    PERMISSIONS.PTA_DUES_MANAGE,
    PERMISSIONS.PTA_FUNDRAISING_MANAGE,
    PERMISSIONS.PTA_ANALYTICS_READ,
    // Treasurer must see who the board is (and was) — managing it is not a
    // financial function.
    PERMISSIONS.PTA_BOARD_VIEW,
    // Volunteer-hours money side only — same "hours aren't a Treasurer's
    // job" reasoning as PTA_VOLUNTEERS_MANAGE being withheld above.
    // Deliberately NO requirements:view/manage/adjust-family or
    // assessments:preview-post — the Treasurer prices, collects, and
    // refunds buyouts/assessments, but does not define or adjust the
    // underlying hour requirement, and does not decide when an assessment
    // batch posts (that's a board-level operational call, not a financial
    // one, even though the resulting charge is financial).
    PERMISSIONS.PTA_VOLUNTEER_BUYOUT_PRICING_MANAGE,
    PERMISSIONS.PTA_VOLUNTEER_REPORTS_VIEW,
    PERMISSIONS.PTA_VOLUNTEER_REPORTS_EXPORT,
    PERMISSIONS.PTA_VOLUNTEER_FINANCIAL_REPORTS_VIEW,
    PERMISSIONS.PTA_VOLUNTEER_PAYMENTS_RECORD_OFFLINE,
    PERMISSIONS.PTA_VOLUNTEER_PAYMENTS_REFUND,
    PERMISSIONS.PTA_VOLUNTEER_AUDIT_VIEW,
    PERMISSIONS.DOCUMENTS_READ,
    PERMISSIONS.DOCUMENTS_WRITE,
    PERMISSIONS.GOVERNANCE_READ,
    // Treasurer needs to see which property/owner an assessment charge
    // belongs to, but property/resident record-keeping itself is a board
    // administrative function, not a financial one -- read-only.
    PERMISSIONS.HOA_PROPERTIES_READ,
    PERMISSIONS.HOA_RESIDENTS_READ,
    // Deliberately NO HOA_VIOLATIONS_* or HOA_ARCHITECTURAL_REQUESTS_*
    // permission at all: compliance enforcement and design/modification
    // review are both board/property-manager functions, not financial
    // ones, even though a violation may eventually carry a fine (billed as
    // an ordinary DuesCharge the Treasurer already sees through the
    // existing dues permissions above, once fine-creation ships).
    // Deliberately NO UNION_CASES_* permission at all, same reasoning:
    // grievance/representation case management is a steward/board function,
    // not a financial one.
  ],

  // Maps naturally onto "Membership Chair" / "Volunteer Coordinator" /
  // "Secretary" via OrgRolePermissionSet — the operational (non-financial)
  // subset of the PTA bundle.
  STAFF: [
    PERMISSIONS.MEMBERS_READ,
    PERMISSIONS.MEMBERS_WRITE,
    // Groups are operational, not financial — view only; managing groups
    // and rosters stays ORG_ADMIN+ (leaders act through their own
    // leadership row, not this bundle).
    PERMISSIONS.GROUPS_VIEW,
    PERMISSIONS.CONTRIBUTIONS_READ,
    PERMISSIONS.CONTRIBUTIONS_WRITE,
    PERMISSIONS.DUES_READ,
    PERMISSIONS.RECEIPTS_READ,
    PERMISSIONS.CAMPAIGNS_READ,
    PERMISSIONS.EVENTS_READ,
    PERMISSIONS.COMMUNICATIONS_READ,
    PERMISSIONS.COMMUNICATIONS_WRITE,
    PERMISSIONS.ATTENDANCE_READ,
    PERMISSIONS.ATTENDANCE_WRITE,
    PERMISSIONS.MEETINGS_READ,
    PERMISSIONS.MEETINGS_WRITE,
    PERMISSIONS.MEETINGS_MINUTES_REVIEW,
    PERMISSIONS.BUDGET_READ,
    PERMISSIONS.REIMBURSEMENTS_SUBMIT,
    PERMISSIONS.CONTACTS_READ,
    PERMISSIONS.CONTACTS_WRITE,
    PERMISSIONS.REPORTS_READ,
    PERMISSIONS.MESSAGES_READ,
    PERMISSIONS.MESSAGES_WRITE,
    PERMISSIONS.PTA_DIRECTORY_READ,
    PERMISSIONS.PTA_HOUSEHOLDS_MANAGE,
    PERMISSIONS.PTA_STUDENTS_MANAGE,
    PERMISSIONS.PTA_EVENTS_MANAGE,
    PERMISSIONS.PTA_VOLUNTEERS_MANAGE,
  PERMISSIONS.PTA_VOLUNTEERS_CHECKIN,
  PERMISSIONS.PTA_VOLUNTEER_HOURS_APPROVE,
    PERMISSIONS.PTA_COMMITTEES_MANAGE,
    PERMISSIONS.PTA_ANNOUNCEMENTS_PUBLISH,
    PERMISSIONS.PTA_DOCUMENTS_MANAGE,
    PERMISSIONS.PTA_MINUTES_REVIEW,
    // Secretary/coordinator-shaped roles see the roster; assigning officers
    // and reshaping positions stays ORG_OWNER/ORG_ADMIN (board authority) —
    // same reasoning as MEETINGS_MINUTES_APPROVE being withheld above.
    PERMISSIONS.PTA_BOARD_VIEW,
    // Volunteer-hours operational side — mirrors PTA_VOLUNTEER_HOURS_APPROVE
    // being granted above. Deliberately NO buyout-pricing:manage,
    // financial-reports:view, payments:record-offline/refund, or audit:view
    // — the money/pricing side of this feature stays with FINANCE, same
    // split as budget:read (STAFF) vs. budget:manage (FINANCE/ORG_ADMIN+).
    PERMISSIONS.PTA_VOLUNTEER_REQUIREMENTS_VIEW,
    PERMISSIONS.PTA_VOLUNTEER_REQUIREMENTS_MANAGE,
    PERMISSIONS.PTA_VOLUNTEER_REQUIREMENTS_ADJUST_FAMILY,
    PERMISSIONS.PTA_VOLUNTEER_REPORTS_VIEW,
    PERMISSIONS.PTA_VOLUNTEER_REPORTS_EXPORT,
    PERMISSIONS.PTA_VOLUNTEER_ASSESSMENTS_PREVIEW_POST,
    PERMISSIONS.DOCUMENTS_READ,
    PERMISSIONS.DOCUMENTS_WRITE,
    // Governance READ only — publishing/superseding bylaws is board authority.
    PERMISSIONS.GOVERNANCE_READ,
    PERMISSIONS.HOA_PROPERTIES_READ,
    PERMISSIONS.HOA_PROPERTIES_WRITE,
    PERMISSIONS.HOA_RESIDENTS_READ,
    PERMISSIONS.HOA_RESIDENTS_WRITE,
    PERMISSIONS.HOA_VIOLATIONS_READ,
    PERMISSIONS.HOA_VIOLATIONS_WRITE,
    PERMISSIONS.HOA_VIOLATIONS_REVIEW,
    // Deliberately NOT HOA_VIOLATIONS_RESOLVE -- resolving/dismissing is
    // the terminal, compliance-record-closing action, reserved for
    // ORG_OWNER/ORG_ADMIN (board-level authority), same reasoning as
    // MEETINGS_MINUTES_APPROVE being withheld from STAFF just above.
    PERMISSIONS.HOA_ARCHITECTURAL_REQUESTS_READ,
    PERMISSIONS.HOA_ARCHITECTURAL_REQUESTS_WRITE,
    PERMISSIONS.HOA_ARCHITECTURAL_REQUESTS_REVIEW,
    // Same reasoning, deliberately NOT HOA_ARCHITECTURAL_REQUESTS_DECIDE --
    // an architectural-committee reviewer (a STAFF-role invitee, per this
    // task's explicit instruction not to infer permission from committee
    // chair status) can review and request changes, but the actual
    // approve/deny/conditionally-approve decision is board-level authority.
    PERMISSIONS.IMPORTS_READ,
    PERMISSIONS.IMPORTS_CREATE,
    PERMISSIONS.IMPORTS_REVIEW,
    PERMISSIONS.IMPORTS_RESOLVE_DUPLICATES,
    // Deliberately NOT IMPORTS_RESUME or IMPORTS_CANCEL -- resuming a
    // plan-limit-paused batch is tied to the org's subscription/billing
    // state, and canceling a batch outright is consequential enough to
    // reserve for ORG_OWNER/ORG_ADMIN, same reasoning as RESOLVE/DECIDE
    // being withheld above.
    // Maps onto "Steward"/"Representative" via OrgRolePermissionSet: the
    // day-to-day case-work tier (view, triage/assign, internal notes,
    // deadlines) without the terminal close/resolve authority.
    PERMISSIONS.UNION_CASES_READ,
    PERMISSIONS.UNION_CASES_MANAGE,
    PERMISSIONS.UNION_CASES_NOTES_INTERNAL,
    PERMISSIONS.UNION_CASES_DEADLINES_MANAGE,
    // Deliberately NOT UNION_CASES_CLOSE -- closing/resolving a case is the
    // terminal, record-closing action, reserved for ORG_OWNER/ORG_ADMIN
    // (board-level authority), same reasoning as HOA_VIOLATIONS_RESOLVE and
    // HOA_ARCHITECTURAL_REQUESTS_DECIDE being withheld above.
    // Member Intake -- day-to-day review tier only (view submissions,
    // approve/reject/link individual ones). Deliberately NOT MANAGE/
    // PUBLISH/EXPORT -- defining what a public form collects, publishing
    // it, and bulk-exporting freshly-submitted PII stay ORG_ADMIN+, same
    // authority-tier reasoning as UNION_CASES_CLOSE just above.
    PERMISSIONS.MEMBER_INTAKE_VIEW,
    PERMISSIONS.MEMBER_INTAKE_REVIEW,
  ],

  // Maps onto "General Member" (an officer viewing without editing rights) —
  // directory + analytics, read-only, no minutes-approval authority.
  READ_ONLY: [
    PERMISSIONS.MEMBERS_READ,
    PERMISSIONS.DUES_READ,
    PERMISSIONS.CONTRIBUTIONS_READ,
    PERMISSIONS.RECEIPTS_READ,
    PERMISSIONS.CAMPAIGNS_READ,
    PERMISSIONS.EVENTS_READ,
    PERMISSIONS.COMMUNICATIONS_READ,
    PERMISSIONS.ATTENDANCE_READ,
    PERMISSIONS.MEETINGS_READ,
    PERMISSIONS.EXPENDITURES_READ,
    PERMISSIONS.BUDGET_READ,
    PERMISSIONS.CONTACTS_READ,
    PERMISSIONS.REPORTS_READ,
    PERMISSIONS.REMINDERS_READ,
    PERMISSIONS.MESSAGES_READ,
    PERMISSIONS.AUDIT_LOGS_READ,
    PERMISSIONS.PTA_DIRECTORY_READ,
    PERMISSIONS.PTA_ANALYTICS_READ,
    PERMISSIONS.PTA_BOARD_VIEW,
    PERMISSIONS.PTA_VOLUNTEER_REQUIREMENTS_VIEW,
    PERMISSIONS.PTA_VOLUNTEER_REPORTS_VIEW,
    PERMISSIONS.DOCUMENTS_READ,
    PERMISSIONS.GOVERNANCE_READ,
    PERMISSIONS.HOA_PROPERTIES_READ,
    PERMISSIONS.HOA_RESIDENTS_READ,
    PERMISSIONS.HOA_VIOLATIONS_READ,
    PERMISSIONS.HOA_ARCHITECTURAL_REQUESTS_READ,
    PERMISSIONS.IMPORTS_READ,
    PERMISSIONS.UNION_CASES_READ,
    PERMISSIONS.MEMBER_INTAKE_VIEW,
  ],

  // Members never get staff permissions — a MEMBER role must never see other
  // members' data. All mobile/member data access goes through dedicated
  // mobile guards (src/lib/mobile-auth.ts) scoped to the caller's own linked
  // OrgMember record, never through canDo()/requirePermission().
  MEMBER: [],
};

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Returns true if `role` has the given `permission`.
 *
 * @example
 *   canDo("FINANCE", "dues:write")   // true
 *   canDo("READ_ONLY", "dues:write") // false
 */
export function canDo(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/**
 * Returns the full permission set for a role.
 */
export function permissionsFor(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

// SUPER_ADMIN is ranked above ORG_OWNER for historical-data/type completeness
// only — no OrganizationMembership is ever assigned this role (the Users &
// Roles UI excludes it from assignable options), so in practice this rank is
// unreachable. It grants no additional reach beyond ORG_OWNER; platform-wide
// authorization comes exclusively from PlatformAccess (see requireSuperAdmin
// in auth-guards.ts), never from this org-scoped rank table.
//
// Lives here (rather than only in auth-guards.ts, which is server-only)
// because client components (e.g. PortalShell's navigation-visibility check)
// need it too, and this module has no server-only dependencies. auth-guards.ts
// imports roleRank from here rather than keeping its own copy.
const ROLE_RANK: Record<Role, number> = {
  MEMBER:      -1,
  READ_ONLY:   0,
  STAFF:       1,
  FINANCE:     2,
  ORG_ADMIN:   3,
  ORG_OWNER:   4,
  SUPER_ADMIN: 5,
};

export function roleRank(role: Role): number {
  return ROLE_RANK[role];
}
