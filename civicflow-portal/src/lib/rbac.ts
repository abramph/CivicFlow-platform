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
} as const;

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
  ],

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
  ],

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
    PERMISSIONS.REPORTS_READ,
    PERMISSIONS.MESSAGES_READ,
    PERMISSIONS.MESSAGES_WRITE,
  ],

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
