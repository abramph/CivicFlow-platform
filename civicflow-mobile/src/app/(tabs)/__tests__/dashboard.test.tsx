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
jest.mock('@/lib/mobile-api', () => ({
  getAnnouncementsForIdentity: (...args: unknown[]) => mockGetAnnouncementsForIdentity(...args),
  getEventsForOrganization: (...args: unknown[]) => mockGetEventsForOrganization(...args),
  getDues: (...args: unknown[]) => mockGetDues(...args),
  getPaymentHistory: (...args: unknown[]) => mockGetPaymentHistory(...args),
  getPtaDues: (...args: unknown[]) => mockGetPtaDues(...args),
  getPtaVolunteerHours: (...args: unknown[]) => mockGetPtaVolunteerHours(...args),
  getPtaVolunteerCommitments: (...args: unknown[]) => mockGetPtaVolunteerCommitments(...args),
}));

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

function unionMemberOrg() {
  return {
    organizationId: 'org-union',
    organizationName: 'Unestra Demo Union',
    memberId: 'member-union-1',
    firstName: 'Alex',
    lastName: 'Reyes',
    pta: null,
    capability: { primaryVertical: 'UNION' },
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
 * Union members pay dues via employer payroll checkoff, not member-initiated
 * payment, so the dashboard swaps the payment-first layout (Balance tile,
 * Make a Payment) for a Cases-first one instead.
 */
describe('Dashboard Union vertical layout', () => {
  beforeEach(() => {
    mockRouterPush.mockReset();
    mockOpenBrowserAsync.mockReset();
    mockGetAnnouncementsForIdentity.mockReset().mockResolvedValue([]);
    mockGetEventsForOrganization.mockReset().mockResolvedValue([]);
    mockGetDues.mockReset().mockResolvedValue({ outstandingBalance: 0, isDelinquent: false, delinquentSince: null, charges: [] });
    mockGetPaymentHistory.mockReset().mockResolvedValue({ payments: [], reports: [] });
  });

  it('shows a My Cases tile instead of Balance, and hides Make a Payment', async () => {
    mockUseAuth.mockReturnValue({ selectedOrganization: unionMemberOrg(), selectedOrganizationId: 'org-union' });

    await render(<DashboardScreen />);
    await waitFor(() => expect(mockGetDues).toHaveBeenCalled());

    expect(screen.getByLabelText('My Cases')).toBeTruthy();
    expect(screen.queryByLabelText(/^Balance,/)).toBeNull();
    expect(screen.queryByLabelText('Make a payment')).toBeNull();
  });

  it('opens the member web case center in the system browser', async () => {
    mockUseAuth.mockReturnValue({ selectedOrganization: unionMemberOrg(), selectedOrganizationId: 'org-union' });

    await render(<DashboardScreen />);
    await waitFor(() => expect(mockGetDues).toHaveBeenCalled());

    fireEvent.press(screen.getByLabelText('My Cases'));

    expect(mockOpenBrowserAsync).toHaveBeenCalledWith(expect.stringContaining('/m/union/cases'));
  });

  it('still shows Balance and Make a Payment for a non-Union member', async () => {
    mockUseAuth.mockReturnValue({ selectedOrganization: conventionalMemberOrg(), selectedOrganizationId: 'org-a' });

    await render(<DashboardScreen />);
    await waitFor(() => expect(mockGetDues).toHaveBeenCalled());

    expect(screen.queryByLabelText('My Cases')).toBeNull();
    expect(screen.getByLabelText(/^Balance,/)).toBeTruthy();
    expect(screen.getByLabelText('Make a payment')).toBeTruthy();
  });
});
