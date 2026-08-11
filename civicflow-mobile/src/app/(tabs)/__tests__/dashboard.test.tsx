import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import DashboardScreen from '../dashboard';

const mockRouterPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockRouterPush(...args) },
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('@/lib/unread-count', () => ({
  useUnreadConversationCount: () => 0,
}));

const mockGetAnnouncementsForIdentity = jest.fn();
const mockGetEventsForIdentity = jest.fn();
const mockGetDues = jest.fn();
const mockGetPaymentHistory = jest.fn();
const mockGetPtaDues = jest.fn();
const mockGetPtaVolunteerHours = jest.fn();
const mockGetPtaVolunteerCommitments = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getAnnouncementsForIdentity: (...args: unknown[]) => mockGetAnnouncementsForIdentity(...args),
  getEventsForIdentity: (...args: unknown[]) => mockGetEventsForIdentity(...args),
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
 * getEventsForIdentity/getAnnouncementsForIdentity), never
 * `hasMemberIdentity` alone.
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

describe('Dashboard "Report a Payment" quick action', () => {
  beforeEach(() => {
    mockRouterPush.mockReset();
    mockGetAnnouncementsForIdentity.mockReset().mockResolvedValue([]);
    mockGetEventsForIdentity.mockReset().mockResolvedValue([]);
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

  it('routes a staff/org-owner-only account (no MEMBER identity, no PTA identity) to /report-payment, not the PTA screen', async () => {
    mockUseAuth.mockReturnValue({ selectedOrganization: staffOnlyOrg(), selectedOrganizationId: 'org-aph' });

    await render(<DashboardScreen />);

    fireEvent.press(screen.getByLabelText('Report a payment'));

    expect(mockRouterPush).toHaveBeenCalledWith('/report-payment');
    expect(mockRouterPush).not.toHaveBeenCalledWith('/pta-report-payment');
    expect(mockGetPtaDues).not.toHaveBeenCalled();
  });
});
