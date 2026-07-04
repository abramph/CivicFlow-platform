/**
 * CivicFlow SaaS — Role-Based Access Control (RBAC)
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
  SUPER_ADMIN: "SUPER_ADMIN",   // Platform operator — full access across all orgs
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

  // Audit logs
  AUDIT_LOGS_READ: "audit_logs:read",

  // Super-admin only
  ALL_ORGS_READ:   "all_orgs:read",
  ALL_ORGS_MANAGE: "all_orgs:manage",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// ─── Role → Permission map ────────────────────────────────────────────────────

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SUPER_ADMIN: Object.values(PERMISSIONS) as Permission[],

  ORG_OWNER: [
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
    PERMISSIONS.AUDIT_LOGS_READ,
  ],

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
    PERMISSIONS.AUDIT_LOGS_READ,
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
    PERMISSIONS.AUDIT_LOGS_READ,
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
