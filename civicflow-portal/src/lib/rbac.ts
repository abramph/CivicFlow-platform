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

  // Dues
  DUES_READ:  "dues:read",
  DUES_WRITE: "dues:write",

  // Contributions
  CONTRIBUTIONS_READ:  "contributions:read",
  CONTRIBUTIONS_WRITE: "contributions:write",

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
  PERMISSIONS.DUES_READ,
  PERMISSIONS.DUES_WRITE,
  PERMISSIONS.CONTRIBUTIONS_READ,
  PERMISSIONS.CONTRIBUTIONS_WRITE,
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
  PERMISSIONS.HOA_PROPERTIES_READ,
  PERMISSIONS.HOA_PROPERTIES_WRITE,
  PERMISSIONS.HOA_RESIDENTS_READ,
  PERMISSIONS.HOA_RESIDENTS_WRITE,
  PERMISSIONS.HOA_VIOLATIONS_READ,
  PERMISSIONS.HOA_VIOLATIONS_WRITE,
  PERMISSIONS.HOA_VIOLATIONS_REVIEW,
  PERMISSIONS.HOA_VIOLATIONS_RESOLVE,
];

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SUPER_ADMIN: ORG_OWNER_PERMISSIONS,

  ORG_OWNER: ORG_OWNER_PERMISSIONS,

  ORG_ADMIN: [
    PERMISSIONS.MEMBERS_READ,
    PERMISSIONS.MEMBERS_WRITE,
    PERMISSIONS.DUES_READ,
    PERMISSIONS.DUES_WRITE,
    PERMISSIONS.CONTRIBUTIONS_READ,
    PERMISSIONS.CONTRIBUTIONS_WRITE,
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
    PERMISSIONS.HOA_PROPERTIES_READ,
    PERMISSIONS.HOA_PROPERTIES_WRITE,
    PERMISSIONS.HOA_RESIDENTS_READ,
    PERMISSIONS.HOA_RESIDENTS_WRITE,
    PERMISSIONS.HOA_VIOLATIONS_READ,
    PERMISSIONS.HOA_VIOLATIONS_WRITE,
    PERMISSIONS.HOA_VIOLATIONS_REVIEW,
    PERMISSIONS.HOA_VIOLATIONS_RESOLVE,
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
    PERMISSIONS.COMMUNICATIONS_READ,
    PERMISSIONS.ATTENDANCE_READ,
    PERMISSIONS.MEETINGS_READ,
    PERMISSIONS.RECEIPTS_READ,
    PERMISSIONS.RECEIPTS_WRITE,
    PERMISSIONS.EXPENDITURES_READ,
    PERMISSIONS.EXPENDITURES_WRITE,
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
    // Treasurer needs to see which property/owner an assessment charge
    // belongs to, but property/resident record-keeping itself is a board
    // administrative function, not a financial one -- read-only.
    PERMISSIONS.HOA_PROPERTIES_READ,
    PERMISSIONS.HOA_RESIDENTS_READ,
    // Deliberately NO HOA_VIOLATIONS_* permission at all: compliance
    // enforcement is a board/property-manager function, not a financial
    // one, even though a violation may eventually carry a fine (billed as
    // an ordinary DuesCharge the Treasurer already sees through the
    // existing dues permissions above, once fine-creation ships).
  ],

  // Maps naturally onto "Membership Chair" / "Volunteer Coordinator" /
  // "Secretary" via OrgRolePermissionSet — the operational (non-financial)
  // subset of the PTA bundle.
  STAFF: [
    PERMISSIONS.MEMBERS_READ,
    PERMISSIONS.MEMBERS_WRITE,
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
    PERMISSIONS.REPORTS_READ,
    PERMISSIONS.REMINDERS_READ,
    PERMISSIONS.MESSAGES_READ,
    PERMISSIONS.AUDIT_LOGS_READ,
    PERMISSIONS.PTA_DIRECTORY_READ,
    PERMISSIONS.PTA_ANALYTICS_READ,
    PERMISSIONS.HOA_PROPERTIES_READ,
    PERMISSIONS.HOA_RESIDENTS_READ,
    PERMISSIONS.HOA_VIOLATIONS_READ,
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
