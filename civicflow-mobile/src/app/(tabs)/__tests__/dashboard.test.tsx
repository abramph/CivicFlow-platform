import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import DashboardScreen from '../dashboard';

const mockRouterPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockRouterPush(...args), navigate: jest.fn() },
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockOpenBrowserAsync = jest.fn();
jest.mock('expo-web-browser', () => ({
  openBrowserAsync: (...args: unknown[]) => mockOpenBrowserAsync(...args),
}));

jest.mock('@/lib/unread-count', () => ({
  useUnreadConversationCount: () => 0,
}));

const mockGetAnnouncementsForIdentity = jest.fn();
const mockGetEventsForOrganization = jest.fn();
const mockGetDues = jest.fn();
const mockGetPaymentHistory = jest.fn();
const mockGetPtaDues = jest.fn();
const mockGetPtaVolunteerHours = jest.fn();
const mockGetPtaVolunteerCommitments = jest.fn();
const mockGetGiving = jest.fn();
const mockGetUnionCases = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getAnnouncementsForIdentity: (...args: unknown[]) => mockGetAnnouncementsForIdentity(...args),
  getEventsForOrganization: (...args: unknown[]) => mockGetEventsForOrganization(...args),
  getDues: (...args: unknown[]) => mockGetDues(...args),
  getPaymentHistory: (...args: unknown[]) => mockGetPaymentHistory(...args),
  getPtaDues: (...args: unknown[]) => mockGetPtaDues(...args),
  getPtaVolunteerHours: (...args: unknown[]) => mockGetPtaVolunteerHours(...args),
  getPtaVolunteerCommitments: (...args: unknown[]) => mockGetPtaVolunteerCommitments(...args),
  getGiving: (...args: unknown[]) => mockGetGiving(...args),
  getUnionCases: (...args: unknown[]) => mockGetUnionCases(...args),
}));

// Union vertical dashboard coverage lives in dashboard-union.test.tsx. Root
// cause of moving it: two un-awaited fireEvent.press calls back-to-back in
// one test silently corrupts React 19's act() nesting tracking (a process-
// global counter, not a per-file one -- surfaces as "overlapping act()
// calls" and then every later render's initial effect never firing, even in
// unrelated test files). Fixed at the source by never firing two presses in
// one test without awaiting/asserting between them; kept in a separate file
// regardless, for isolation from any other test's unrelated press sequences.

/**
 * Regression coverage for the Quick Actions "Report a Payment" button
 * (production incident: an APH Technologies staff-only account, with
 * neither a MEMBER identity nor a PTA identity, was routed into the
 * PTA-only report-payment screen and hit the server's "PTA is not
 * available for this organization" guard). The destination must key off
 * the same `hasPtaIdentity && !hasMemberIdentity` condition used
 * everywhere else in this app (dues.tsx, event/[id].tsx,
 * getEventsForOrganization/getAnnouncementsForIdentity), never
 * `hasMemberIdentity` alone.
 *
 * Follow-up: routing correctly to /report-payment still left staff-only
 * accounts hitting requireMobileMembership's 403 ("No active membership
 * for this organization"), because they hold OWNER rather than MEMBER.
 * Such an account has no dues identity to report against, so the action
 * is now gated on `hasAnyIdentity` and is not rendered at all.
 */

function ptaParentOrg() {
  return {
    organizationId: 'org-pta',
    organizationName: 'Pine Grove School PTA',
    memberId: null,
    firstName: 'Casey',
    lastName: 'Kim',
    pta: { householdAdultId: 'adult-1', householdName: null, isOfficer: false, canCheckIn: false, canApproveHours: false },
  };
}

function conventionalMemberOrg() {
  return {
    organizationId: 'org-a',
    organizationName: 'Riverdale Community Association',
    memberId: 'member-1',
    firstName: 'Jamie',
    lastName: 'Lee',
    pta: null,
  };
}

function staffOnlyOrg() {
  return {
    organizationId: 'org-aph',
    organizationName: 'APH Technologies, LLC',
    memberId: null,
    firstName: null,
    lastName: null,
    pta: null,
  };
}

function memberAndPtaOrg() {
  return {
    organizationId: 'org-both',
    organizationName: 'Lakeside Union',
    memberId: 'member-2',
    firstName: 'Robin',
    lastName: 'Diaz',
    pta: { householdAdultId: 'adult-2', householdName: null, isOfficer: false, canCheckIn: false, canApproveHours: false },
  };
}

describe('Dashboard "Report a Payment" quick action', () => {
  beforeEach(() => {
    mockRouterPush.mockReset();
    mockGetAnnouncementsForIdentity.mockReset().mockResolvedValue([]);
    mockGetEventsForOrganization.mockReset().mockResolvedValue([]);
    mockGetDues.mockReset().mockResolvedValue({ outstandingBalance: 0, isDelinquent: false, delinquentSince: null, charges: [] });
    mockGetPaymentHistory.mockReset().mockResolvedValue({ payments: [], reports: [] });
    mockGetPtaDues.mockReset().mockResolvedValue({
      currentSchoolYear: null,
      currentCharge: null,
      hasBillingIdentity: true,
      priorCharges: [],
      onlinePaymentLinkSlug: null,
    });
    mockGetPtaVolunteerHours.mockReset().mockResolvedValue({ approvedMinutes: 0, requiredMinutes: null, remainingMinutes: null });
    mockGetPtaVolunteerCommitments.mockReset().mockResolvedValue([]);
    mockGetGiving.mockReset().mockResolvedValue({ enabled: false });
    mockGetUnionCases.mockReset().mockResolvedValue([]);
  });

  it('routes a PTA parent (PTA identity, no MEMBER identity) to /pta-report-payment', async () => {
    mockUseAuth.mockReturnValue({ selectedOrganization: ptaParentOrg(), selectedOrganizationId: 'org-pta' });

    await render(<DashboardScreen />);
    await waitFor(() => expect(mockGetPtaDues).toHaveBeenCalled());

    fireEvent.press(screen.getByLabelText('Report a payment'));

    expect(mockRouterPush).toHaveBeenCalledWith('/pta-report-payment');
  });

  it('routes a conventional MEMBER to /report-payment', async () => {
    mockUseAuth.mockReturnValue({ selectedOrganization: conventionalMemberOrg(), selectedOrganizationId: 'org-a' });

    await render(<DashboardScreen />);
    await waitFor(() => expect(mockGetDues).toHaveBeenCalled());

    fireEvent.press(screen.getByLabelText('Report a payment'));

    expect(mockRouterPush).toHaveBeenCalledWith('/report-payment');
  });

  it('routes an account holding both MEMBER and PTA identities to /report-payment', async () => {
    mockUseAuth.mockReturnValue({ selectedOrganization: memberAndPtaOrg(), selectedOrganizationId: 'org-both' });

    await render(<DashboardScreen />);
    await waitFor(() => expect(mockGetDues).toHaveBeenCalled());

    fireEvent.press(screen.getByLabelText('Report a payment'));

    expect(mockRouterPush).toHaveBeenCalledWith('/report-payment');
    expect(mockRouterPush).not.toHaveBeenCalledWith('/pta-report-payment');
  });

  it('hides the action entirely for a staff/org-owner-only account (no MEMBER identity, no PTA identity)', async () => {
    mockUseAuth.mockReturnValue({ selectedOrganization: staffOnlyOrg(), selectedOrganizationId: 'org-aph' });

    await render(<DashboardScreen />);

    expect(screen.queryByLabelText('Report a payment')).toBeNull();
    expect(mockRouterPush).not.toHaveBeenCalledWith('/report-payment');
    expect(mockRouterPush).not.toHaveBeenCalledWith('/pta-report-payment');
    expect(mockGetPtaDues).not.toHaveBeenCalled();
  });
});

/**
 * Community/Nonprofit isolation for the "My Family" (family-photo) entry
 * point. Existing coverage above (conventionalMemberOrg/staffOnlyOrg) only
 * proves the button is absent for "no PTA identity" generically -- it never
 * tags the fixture as a demonstrable Community/Nonprofit organization
 * (capability.primaryVertical), which is the field this app's own
 * vertical-gating logic actually keys off elsewhere (see
 * (tabs)/__tests__/_layout.test.tsx, __tests__/org-switcher.test.tsx). This
 * block closes that gap explicitly, mirroring dashboard-church.test.tsx and
 * dashboard-union.test.tsx's per-vertical pattern.
 */
function communityMemberOrg() {
  return {
    organizationId: 'org-community',
    organizationName: 'Riverdale Community Association',
    memberId: 'member-9',
    firstName: 'Alex',
    lastName: 'Rivera',
    pta: null,
    capability: { primaryVertical: 'COMMUNITY' },
  };
}

describe('Dashboard -- Community/Nonprofit isolation for the PTA "My Family" entry point', () => {
  beforeEach(() => {
    mockRouterPush.mockReset();
    mockGetAnnouncementsForIdentity.mockReset().mockResolvedValue([]);
    mockGetEventsForOrganization.mockReset().mockResolvedValue([]);
    mockGetDues.mockReset().mockResolvedValue({ outstandingBalance: 0, isDelinquent: false, delinquentSince: null, charges: [] });
    mockGetPaymentHistory.mockReset().mockResolvedValue({ payments: [], reports: [] });
    mockGetPtaDues.mockReset().mockResolvedValue({
      currentSchoolYear: null,
      currentCharge: null,
      hasBillingIdentity: true,
      priorCharges: [],
      onlinePaymentLinkSlug: null,
    });
    mockGetPtaVolunteerHours.mockReset().mockResolvedValue({ approvedMinutes: 0, requiredMinutes: null, remainingMinutes: null });
    mockGetPtaVolunteerCommitments.mockReset().mockResolvedValue([]);
    mockGetGiving.mockReset().mockResolvedValue({ enabled: false });
    mockGetUnionCases.mockReset().mockResolvedValue([]);
  });

  it('a Community/Nonprofit organization member never sees the My Family entry point, even with a real member record', async () => {
    mockUseAuth.mockReturnValue({ selectedOrganization: communityMemberOrg(), selectedOrganizationId: 'org-community' });

    await render(<DashboardScreen />);
    await waitFor(() => expect(mockGetDues).toHaveBeenCalled());

    expect(screen.queryByLabelText('My family')).toBeNull();
    expect(screen.queryByText('My Family')).toBeNull();
    expect(mockRouterPush).not.toHaveBeenCalledWith('/pta-my-family');
    // A real memberId/member-record presence doesn't upgrade a generic
    // member into a PTA identity -- only a PtaHouseholdAdult link does.
    expect(mockGetPtaDues).not.toHaveBeenCalled();
  });

  it('switching from a PTA organization to a Community/Nonprofit organization removes the My Family entry point and stops PTA data fetching', async () => {
    mockUseAuth.mockReturnValue({ selectedOrganization: ptaParentOrg(), selectedOrganizationId: 'org-pta' });
    const { rerender } = await render(<DashboardScreen />);
    await waitFor(() => expect(mockGetPtaDues).toHaveBeenCalled());
    expect(screen.getByLabelText('My family')).toBeTruthy();

    mockGetPtaDues.mockClear();
    mockUseAuth.mockReturnValue({ selectedOrganization: communityMemberOrg(), selectedOrganizationId: 'org-community' });
    await rerender(<DashboardScreen />);
    await waitFor(() => expect(mockGetDues).toHaveBeenCalled());

    expect(screen.queryByLabelText('My family')).toBeNull();
    expect(mockGetPtaDues).not.toHaveBeenCalled();
  });
});
