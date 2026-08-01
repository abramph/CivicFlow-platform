import type { OrganizationVertical } from "@prisma/client";
import type { Permission, Role } from "@/lib/rbac";
import { getVerticalTerminology } from "@/lib/vertical-terminology";

export interface NavItem {
  href: string;
  label: string;
  /** If set, the item is hidden unless the caller's effective permissions include this. */
  permission?: Permission;
  /** If set, the item is hidden unless the caller's role is at or above this
   * rank (mirrors the one role-gated item this list previously special-cased:
   * Role Permissions). */
  minRole?: Role;
}

/**
 * Phase 3 — one navigation profile per vertical. Every href here points to a
 * real, already-working page — no dead ends. Where the suggested item in the
 * spec has no real backing feature yet (a standalone Documents library
 * outside PTA, a distinct Officers/Board roster separate from Users & Roles,
 * Union grievance/worksite routes, HOA violations/maintenance/architectural-
 * request routes), it is honestly omitted or mapped onto the closest real
 * equivalent rather than pointed at a placeholder — see
 * docs/vertical-experience-layer.md for the full list and reasoning.
 *
 * COMMUNITY/UNION/HOA share the exact same underlying route set (they are,
 * today, the same generic feature set under different branding) — only
 * labels differ. PTA is architecturally its own surface (Unestra Labs) and
 * gets a fully distinct list; a PTA org must never see Community wording.
 */
function sharedNavigation(vertical: "COMMUNITY" | "UNION" | "HOA"): NavItem[] {
  const t = getVerticalTerminology(vertical);
  const dashboardLabel = t.dashboardTitle;
  const campaignsLabel = vertical === "COMMUNITY" ? "Fundraising" : "Campaigns";
  const duesLabel = t.duesLabel;
  const communicationsLabel = vertical === "HOA" ? "Announcements" : "Communications";
  const usersLabel = vertical === "UNION" ? "Officers" : vertical === "HOA" ? "Board" : "Users & Roles";

  return [
    { href: "/dashboard", label: dashboardLabel },
    { href: "/inbox", label: "Inbox", permission: "messages:read" },
    { href: "/members", label: t.memberPlural },
    { href: "/contributions", label: "Contributions" },
    { href: "/dues", label: duesLabel },
    { href: "/dues/reminders", label: "Dues Campaigns" },
    { href: "/payment-reports", label: "Payment Reports" },
    { href: "/campaigns", label: campaignsLabel },
    { href: "/events", label: "Events" },
    { href: "/meetings", label: "Meetings", permission: "meetings:read" },
    { href: "/communications", label: communicationsLabel, permission: "communications:read" },
    { href: "/communications/campaigns", label: "Communication Campaigns", permission: "communications:read" },
    { href: "/attendance", label: "Attendance", permission: "attendance:read" },
    { href: "/expenditures", label: "Expenditures" },
    { href: "/reports", label: "Reports" },
    { href: "/receipts", label: "Receipts" },
    { href: "/reminders", label: "Reminders" },
    { href: "/payments/imports", label: "Payment Imports", permission: "dues:read" },
    { href: "/payments/reconciliation", label: "Reconciliation", permission: "dues:read" },
    { href: "/audit-logs", label: "Audit Logs", permission: "audit_logs:read" },
    { href: "/settings/sms-consent", label: "SMS Consent" },
    { href: "/payment-links", label: "Payment Links", permission: "contributions:read" },
    { href: "/settings", label: "Settings" },
    { href: "/settings/organization", label: "Organization", permission: "org_settings:read" },
    { href: "/settings/categories", label: "Categories", permission: "org_settings:read" },
    { href: "/settings/dues", label: "Dues Setup", permission: "dues:read" },
    { href: "/settings/payment-methods", label: "Payment Methods", permission: "org_settings:read" },
    { href: "/settings/users", label: usersLabel, permission: "users:read" },
    { href: "/settings/roles", label: "Role Permissions", minRole: "ORG_OWNER" },
    { href: "/settings/security", label: "Security" },
    { href: "/settings/billing", label: "Billing", permission: "billing:read" },
    { href: "/onboarding/organization", label: "Onboarding" },
    { href: "/migration", label: "Migration", permission: "org_settings:write" },
    { href: "/import", label: "Import Data", permission: "members:write" },
  ];
}

const NAVIGATION: Record<OrganizationVertical, NavItem[]> = {
  COMMUNITY: sharedNavigation("COMMUNITY"),
  UNION: sharedNavigation("UNION"),
  HOA: sharedNavigation("HOA"),
  // Do NOT expose Community terminology/nav for a PTA/PTO organization —
  // this list replaces the shared one entirely rather than adding to it.
  PTA: [
    { href: "/labs/pta/dashboard", label: "PTA Dashboard" },
    { href: "/labs/pta/households", label: "Households" },
    { href: "/labs/pta/academic", label: "Academics" },
    { href: "/labs/pta/committees", label: "Committees" },
    { href: "/labs/pta/volunteers", label: "Volunteers" },
    { href: "/labs/pta/membership", label: "Membership" },
    { href: "/labs/pta/dues", label: "Dues & Payments" },
    { href: "/labs/pta/events", label: "Events" },
    { href: "/meetings", label: "Meetings & Minutes", permission: "meetings:read" },
    { href: "/labs/pta/communications", label: "Announcements" },
    { href: "/labs/pta/documents", label: "Documents" },
    { href: "/reports", label: "Reports" },
    { href: "/labs/pta/settings", label: "PTA Setup" },
    { href: "/settings", label: "Account Settings" },
  ],
};

export function getNavigationProfile(vertical: OrganizationVertical): NavItem[] {
  return NAVIGATION[vertical];
}

/**
 * The single authoritative "where should this vertical land after
 * login/switch/signup" computation. As of PR #40, the effective vertical
 * (see resolveEffectiveVertical in organization-experience.ts) is always
 * identical to the raw stored primaryVertical — there is no longer a case
 * where a PTA org lands anywhere but its own PTA dashboard. Client and
 * server call sites both import this rather than each re-deriving the same
 * PTA-vs-everything-else branch.
 */
export function getLandingRoute(vertical: OrganizationVertical): string {
  return vertical === "PTA" ? "/labs/pta/dashboard" : "/dashboard";
}
