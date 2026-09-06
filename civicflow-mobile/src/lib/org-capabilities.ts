import type { MobileOrganization } from '@/lib/auth-context';

/**
 * Build 27 additive dual-role capability model.
 *
 * A caller can be a member, a PTA parent, a PTA officer, an administrator, or
 * ANY COMBINATION at once — the Build 26 preview showed how flattening those
 * onto one "primary" identity hides real capabilities (an admin who is also a
 * parent lost My Family; a parent with check-in authority lost the scanner).
 * Every screen derives what it needs from this one summary instead of
 * re-checking raw fields, so no screen can reinvent the two-way
 * `hasMemberIdentity ? conventional : PTA` switch this replaces.
 *
 * Nothing here GRANTS anything — every capability is resolved server-side
 * (constituentMemberId / pta / adminCapabilities on the organizations row)
 * and re-enforced per request by the API. This is display routing only.
 */
export interface OrgCapabilitySummary {
  /** The caller has a real constituent OrgMember in this org (role-agnostic;
   * never the household's shared billing identity). */
  hasMemberIdentity: boolean;
  /** The caller is a linked household adult (PTA parent) in this org. */
  hasParentIdentity: boolean;
  /** Officer volunteer signals — always explicit permissions, never inferred
   * from role names or from being a parent. */
  canCheckInVolunteers: boolean;
  canApproveHours: boolean;
  /** Self/household QR attendance check-in: members check themselves in,
   * household adults check their household in. Officer/admin status alone
   * deliberately does NOT enable this — scanning records attendance for a
   * constituent identity, which an admin-only login doesn't have. */
  canScanAttendance: boolean;
  /** Server-resolved admin capability flags (empty for non-admins). */
  adminCapabilities: string[];
  hasAdminAccess: boolean;
  /** Any PTA tie at all (parent or officer) — the Volunteer tab's gate. */
  hasPtaAccess: boolean;
}

const NO_CAPABILITIES: OrgCapabilitySummary = {
  hasMemberIdentity: false,
  hasParentIdentity: false,
  canCheckInVolunteers: false,
  canApproveHours: false,
  canScanAttendance: false,
  adminCapabilities: [],
  hasAdminAccess: false,
  hasPtaAccess: false,
};

export function deriveOrgCapabilities(org: MobileOrganization | null | undefined): OrgCapabilitySummary {
  if (!org) return NO_CAPABILITIES;
  // constituentMemberId is the Build 27 field; legacy memberId is the
  // fallback for a portal that predates it (where the two are identical for
  // every non-household row, and household rows simply lose nothing they had).
  const hasMemberIdentity = Boolean(org.constituentMemberId ?? org.memberId);
  const hasParentIdentity = Boolean(org.pta?.householdAdultId);
  const adminCapabilities = org.capability?.adminCapabilities ?? [];
  return {
    hasMemberIdentity,
    hasParentIdentity,
    canCheckInVolunteers: Boolean(org.pta?.canCheckIn),
    canApproveHours: Boolean(org.pta?.canApproveHours),
    canScanAttendance: hasMemberIdentity || hasParentIdentity,
    adminCapabilities,
    hasAdminAccess: adminCapabilities.length > 0,
    hasPtaAccess: Boolean(org.pta),
  };
}
