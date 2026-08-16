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
jest.mock('@/lib/mobile-api', () => ({
  getAnnouncementsForIdentity: (...args: unknown[]) => mockGetAnnouncementsForIdentity(...args),
  getEventsForOrganization: (...args: unknown[]) => mockGetEventsForOrganization(...args),
  getDues: (...args: unknown[]) => mockGetDues(...args),
  getPaymentHistory: (...args: unknown[]) => mockGetPaymentHistory(...args),
  getPtaDues: jest.fn(),
  getPtaVolunteerHours: jest.fn(),
  getPtaVolunteerCommitments: jest.fn(),
  getGiving: (...args: unknown[]) => mockGetGiving(...args),
  getUnionCases: jest.fn(),
}));

function churchMemberOrg() {
  return {
    organizationId: 'org-church',
    organizationName: 'Unestra Demo Church',
    memberId: 'member-church-1',
    firstName: 'Morgan',
    lastName: 'Ellis',
    pta: null,
    capability: { primaryVertical: 'CHURCH' },
  };
}

/**
 * CHURCH-VERT-B — a church member opens the app to give, not to browse a
 * payment-first balance/delinquency layout, so the dashboard swaps Balance
 * and Make a Payment for a giving summary tile instead (mirrors the Union
 * dashboard test's reasoning for its own dedicated file).
 */
describe('Dashboard Church vertical layout', () => {
  beforeEach(() => {
    mockRouterPush.mockReset();
    mockOpenBrowserAsync.mockReset();
    mockGetAnnouncementsForIdentity.mockReset().mockResolvedValue([]);
    mockGetEventsForOrganization.mockReset().mockResolvedValue([]);
    mockGetDues.mockReset().mockResolvedValue({ outstandingBalance: 0, isDelinquent: false, delinquentSince: null, charges: [] });
    mockGetPaymentHistory.mockReset().mockResolvedValue({ payments: [], reports: [] });
    mockGetGiving.mockReset().mockResolvedValue({ enabled: false });
  });

  it('hides Balance/Make a Payment/Report a Payment and never fetches dues data', async () => {
    mockUseAuth.mockReturnValue({ selectedOrganization: churchMemberOrg(), selectedOrganizationId: 'org-church' });

    await render(<DashboardScreen />);
    await waitFor(() => expect(mockGetGiving).toHaveBeenCalled());

    expect(screen.queryByLabelText(/^Balance,/)).toBeNull();
    expect(screen.queryByLabelText('Make a payment')).toBeNull();
    expect(screen.queryByLabelText('Report a payment')).toBeNull();
    expect(mockGetDues).not.toHaveBeenCalled();
    expect(mockGetPaymentHistory).not.toHaveBeenCalled();
  });

  it('shows a "Give Now" tile when the org has not enabled giving at all', async () => {
    mockUseAuth.mockReturnValue({ selectedOrganization: churchMemberOrg(), selectedOrganizationId: 'org-church' });

    await render(<DashboardScreen />);
    await waitFor(() => expect(mockGetGiving).toHaveBeenCalled());

    expect(screen.getByText('Give Now')).toBeTruthy();
  });

  it('shows this year\'s giving total and next recurring gift date when giving is enabled', async () => {
    const nextContributionDate = '2026-09-01T00:00:00.000Z';
    mockGetGiving.mockResolvedValue({
      enabled: true,
      terminology: 'Giving',
      yearTotal: 250,
      funds: [],
      history: [],
      schedules: [
        { id: 's1', fundName: 'General Fund', amount: 50, frequency: 'MONTHLY', status: 'ACTIVE', nextContributionDate, paymentMethodDescriptor: null },
      ],
      pledges: [],
      statements: [],
    });
    mockUseAuth.mockReturnValue({ selectedOrganization: churchMemberOrg(), selectedOrganizationId: 'org-church' });

    await render(<DashboardScreen />);
    await waitFor(() => expect(mockGetGiving).toHaveBeenCalled());

    const expectedDate = new Date(nextContributionDate).toLocaleDateString();
    expect(screen.getByLabelText(`This year's giving, $250.00, next gift ${expectedDate}`)).toBeTruthy();
  });

  it('navigates the giving tile to the Give tab', async () => {
    mockUseAuth.mockReturnValue({ selectedOrganization: churchMemberOrg(), selectedOrganizationId: 'org-church' });

    await render(<DashboardScreen />);
    await waitFor(() => expect(mockGetGiving).toHaveBeenCalled());

    await fireEvent.press(screen.getByText('Give Now'));

    expect(mockRouterPush).toHaveBeenCalledWith('/give');
    expect(mockOpenBrowserAsync).not.toHaveBeenCalled();
  });

  it('does not show a duplicate "Giving" Quick Action -- the Give tab and summary tile already cover it', async () => {
    mockGetGiving.mockResolvedValue({
      enabled: true,
      terminology: 'Giving',
      yearTotal: 100,
      funds: [],
      history: [],
      schedules: [],
      pledges: [],
      statements: [],
    });
    mockUseAuth.mockReturnValue({ selectedOrganization: churchMemberOrg(), selectedOrganizationId: 'org-church' });

    await render(<DashboardScreen />);
    await waitFor(() => expect(mockGetGiving).toHaveBeenCalled());

    expect(screen.queryByLabelText('Giving')).toBeNull();
  });
});
