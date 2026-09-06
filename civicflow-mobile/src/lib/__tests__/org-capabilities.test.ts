import type { MobileOrganization } from '@/lib/auth-context';
import { deriveOrgCapabilities } from '@/lib/org-capabilities';

function org(overrides: Partial<MobileOrganization> = {}): MobileOrganization {
  return {
    organizationId: 'org-1',
    organizationName: 'Pine Grove School PTA',
    organizationLogoUrl: null,
    memberId: null,
    firstName: null,
    lastName: null,
    membershipStatus: null,
    isDelinquent: false,
    pta: null,
    ...overrides,
  };
}

const parentPta = { householdAdultId: 'adult-1', householdName: 'Kim Family', isOfficer: false, canCheckIn: false, canApproveHours: false };
const officerPta = { householdAdultId: null, householdName: null, isOfficer: true, canCheckIn: true, canApproveHours: true };

function capability(adminCapabilities: string[]) {
  return {
    primaryVertical: 'PTA',
    terminology: { productLabel: 'PTA', member: 'Parent', dashboardTitle: 'Home' },
    quickActions: [],
    supportedModules: [],
    landingPage: 'dashboard',
    capabilities: { properties: false, propertyResidents: false },
    adminCapabilities,
  } as NonNullable<MobileOrganization['capability']>;
}

describe('deriveOrgCapabilities — the Build 27 additive dual-role model', () => {
  it('returns nothing for a missing organization', () => {
    const caps = deriveOrgCapabilities(null);
    expect(caps).toEqual({
      hasMemberIdentity: false,
      hasParentIdentity: false,
      canCheckInVolunteers: false,
      canApproveHours: false,
      canScanAttendance: false,
      adminCapabilities: [],
      hasAdminAccess: false,
      hasPtaAccess: false,
    });
  });

  it('parent-only: parent identity and household scan access, nothing administrative', () => {
    const caps = deriveOrgCapabilities(org({ pta: parentPta }));
    expect(caps.hasParentIdentity).toBe(true);
    expect(caps.hasMemberIdentity).toBe(false);
    expect(caps.canScanAttendance).toBe(true);
    expect(caps.hasAdminAccess).toBe(false);
    expect(caps.canCheckInVolunteers).toBe(false);
    expect(caps.canApproveHours).toBe(false);
  });

  it('admin-only with no member record: admin access but NO parent identity and NO scan access', () => {
    const caps = deriveOrgCapabilities(org({ capability: capability(['adminDashboard', 'manageMembers']) }));
    expect(caps.hasAdminAccess).toBe(true);
    expect(caps.hasParentIdentity).toBe(false);
    // Scanning records attendance for a constituent identity the admin
    // doesn't hold — admin status alone must never enable it.
    expect(caps.canScanAttendance).toBe(false);
  });

  it('dual admin+parent: BOTH identities at once — neither suppresses the other', () => {
    const caps = deriveOrgCapabilities(
      org({ pta: { ...parentPta, isOfficer: true, canCheckIn: true, canApproveHours: true }, capability: capability(['adminDashboard', 'managePtaHouseholds']) })
    );
    expect(caps.hasParentIdentity).toBe(true);
    expect(caps.hasAdminAccess).toBe(true);
    expect(caps.canCheckInVolunteers).toBe(true);
    expect(caps.canApproveHours).toBe(true);
    expect(caps.canScanAttendance).toBe(true);
  });

  it('officer/scanner without a household: volunteer capabilities without parent identity', () => {
    const caps = deriveOrgCapabilities(org({ pta: officerPta }));
    expect(caps.hasParentIdentity).toBe(false);
    expect(caps.hasPtaAccess).toBe(true);
    expect(caps.canCheckInVolunteers).toBe(true);
    expect(caps.canApproveHours).toBe(true);
    expect(caps.canScanAttendance).toBe(false);
  });

  it('reads constituentMemberId first, falling back to legacy memberId for an older portal', () => {
    expect(deriveOrgCapabilities(org({ constituentMemberId: 'm-1' })).hasMemberIdentity).toBe(true);
    expect(deriveOrgCapabilities(org({ memberId: 'm-1' })).hasMemberIdentity).toBe(true);
    // A household adult whose row withholds legacy memberId but carries the
    // Build 27 constituent id gets member identity WITHOUT losing the
    // parent identity — the exact dual case the old switch flattened.
    const dual = deriveOrgCapabilities(org({ constituentMemberId: 'm-1', pta: parentPta }));
    expect(dual.hasMemberIdentity).toBe(true);
    expect(dual.hasParentIdentity).toBe(true);
  });

  it('never grants parent access from admin capability or admin access from parenthood', () => {
    const adminOnly = deriveOrgCapabilities(org({ capability: capability(['adminDashboard']) }));
    expect(adminOnly.hasParentIdentity).toBe(false);
    const parentOnly = deriveOrgCapabilities(org({ pta: parentPta }));
    expect(parentOnly.hasAdminAccess).toBe(false);
    expect(parentOnly.adminCapabilities).toEqual([]);
  });
});
