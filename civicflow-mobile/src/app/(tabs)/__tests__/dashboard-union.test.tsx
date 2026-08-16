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
const mockGetGiving = jest.fn();
const mockGetUnionCases = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getAnnouncementsForIdentity: (...args: unknown[]) => mockGetAnnouncementsForIdentity(...args),
  getEventsForOrganization: (...args: unknown[]) => mockGetEventsForOrganization(...args),
  getDues: (...args: unknown[]) => mockGetDues(...args),
  getPaymentHistory: (...args: unknown[]) => mockGetPaymentHistory(...args),
  getPtaDues: jest.fn(),
  getPtaVolunteerHours: jest.fn(),
  getPtaVolunteerCommitments: jest.fn(),
  getGiving: (...args: unknown[]) => mockGetGiving(...args),
  getUnionCases: (...args: unknown[]) => mockGetUnionCases(...args),
}));

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

/**
 * Union members pay dues via employer payroll checkoff, not member-initiated
 * payment, so the dashboard swaps the payment-first layout (Balance tile,
 * Make a Payment) for a Cases-first one instead. Kept in its own test file
 * -- see dashboard.test.tsx's comment above its mobile-api mock for why.
 */
describe('Dashboard Union vertical layout', () => {
  beforeEach(() => {
    mockRouterPush.mockReset();
    mockOpenBrowserAsync.mockReset();
    mockGetAnnouncementsForIdentity.mockReset().mockResolvedValue([]);
    mockGetEventsForOrganization.mockReset().mockResolvedValue([]);
    mockGetDues.mockReset().mockResolvedValue({ outstandingBalance: 0, isDelinquent: false, delinquentSince: null, charges: [] });
    mockGetPaymentHistory.mockReset().mockResolvedValue({ payments: [], reports: [] });
    mockGetGiving.mockReset().mockResolvedValue({ enabled: false });
    mockGetUnionCases.mockReset().mockResolvedValue([]);
  });

  it('shows Get Union Help and a My Union Cases summary instead of Balance, and hides Make a Payment', async () => {
    mockUseAuth.mockReturnValue({ selectedOrganization: unionMemberOrg(), selectedOrganizationId: 'org-union' });

    await render(<DashboardScreen />);
    await waitFor(() => expect(mockGetUnionCases).toHaveBeenCalled());

    expect(screen.getByLabelText('Get Union Help')).toBeTruthy();
    expect(screen.getByLabelText(/^My Union Cases,/)).toBeTruthy();
    expect(screen.queryByLabelText(/^Balance,/)).toBeNull();
    expect(screen.queryByLabelText('Make a payment')).toBeNull();
    expect(mockGetDues).not.toHaveBeenCalled();
  });

  it('navigates Get Union Help to its native screen, never the system browser', async () => {
    mockUseAuth.mockReturnValue({ selectedOrganization: unionMemberOrg(), selectedOrganizationId: 'org-union' });

    await render(<DashboardScreen />);
    await waitFor(() => expect(mockGetUnionCases).toHaveBeenCalled());

    await fireEvent.press(screen.getByLabelText('Get Union Help'));

    expect(mockRouterPush).toHaveBeenCalledWith('/union-cases/get-help');
    expect(mockOpenBrowserAsync).not.toHaveBeenCalled();
  });

  it('navigates the My Union Cases summary to the Cases tab', async () => {
    mockUseAuth.mockReturnValue({ selectedOrganization: unionMemberOrg(), selectedOrganizationId: 'org-union' });

    await render(<DashboardScreen />);
    await waitFor(() => expect(mockGetUnionCases).toHaveBeenCalled());

    await fireEvent.press(screen.getByLabelText(/^My Union Cases,/));

    expect(mockRouterPush).toHaveBeenCalledWith('/cases');
    expect(mockOpenBrowserAsync).not.toHaveBeenCalled();
  });

  it('summarizes open case count and next update date on the My Union Cases card', async () => {
    mockUseAuth.mockReturnValue({ selectedOrganization: unionMemberOrg(), selectedOrganizationId: 'org-union' });
    const dueAt = '2026-08-24T18:00:00.000Z';
    mockGetUnionCases.mockResolvedValue([
      {
        id: 'case-1',
        caseNumber: 7,
        status: 'ACTIVE',
        upcomingDates: [{ id: 'd1', deadlineType: 'MANAGEMENT_RESPONSE_DUE', description: null, dueAt }],
        comments: [],
      },
      { id: 'case-2', caseNumber: 8, status: 'CLOSED', upcomingDates: [], comments: [] },
    ]);

    await render(<DashboardScreen />);
    await waitFor(() => expect(mockGetUnionCases).toHaveBeenCalled());

    const expectedDate = new Date(dueAt).toLocaleDateString();
    expect(screen.getByLabelText(`My Union Cases, 1 open, next update ${expectedDate}`)).toBeTruthy();
  });

  it('still shows Balance and Make a Payment for a non-Union member', async () => {
    mockUseAuth.mockReturnValue({ selectedOrganization: conventionalMemberOrg(), selectedOrganizationId: 'org-a' });

    await render(<DashboardScreen />);
    await waitFor(() => expect(mockGetDues).toHaveBeenCalled());

    expect(screen.queryByLabelText('Get Union Help')).toBeNull();
    expect(screen.getByLabelText(/^Balance,/)).toBeTruthy();
    expect(screen.getByLabelText('Make a payment')).toBeTruthy();
  });
});
