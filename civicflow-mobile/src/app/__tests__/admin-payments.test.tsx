import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import AdminPaymentsScreen from '../admin-payments';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  Redirect: () => null,
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetAdminFinancialSummary = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getAdminFinancialSummary: (...args: unknown[]) => mockGetAdminFinancialSummary(...args),
}));

function authWith(adminCapabilities: string[]) {
  return {
    selectedOrganizationId: 'org-a',
    selectedOrganization: { organizationName: 'Sample Org', capability: { adminCapabilities } },
  };
}

describe('Admin payments hub screen', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockGetAdminFinancialSummary.mockReset();
  });

  it('shows a denial state and never fetches without managePayments', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageMembers']));

    await render(<AdminPaymentsScreen />);

    await waitFor(() =>
      expect(screen.getByText("You don't have payments administration access for this organization.")).toBeTruthy()
    );
    expect(mockGetAdminFinancialSummary).not.toHaveBeenCalled();
  });

  it('loads and renders the financial summary', async () => {
    mockUseAuth.mockReturnValue(authWith(['managePayments']));
    mockGetAdminFinancialSummary.mockResolvedValueOnce({
      totalDuesCollectedCents: 100000,
      totalContributionsCents: 30075,
      duesOutstandingCents: 5020,
      duesCollected30dCents: 2505,
      pendingPaymentReports: 2,
      pendingPaymentLinkReports: 1,
    });

    await render(<AdminPaymentsScreen />);

    await waitFor(() => expect(screen.getByText('$50.20')).toBeTruthy());
    expect(screen.getByText('$25.05')).toBeTruthy();
    expect(screen.getByLabelText('Payment reports, 3 awaiting review')).toBeTruthy();
  });

  it('hides the Reports entry point without manageReports', async () => {
    mockUseAuth.mockReturnValue(authWith(['managePayments']));
    mockGetAdminFinancialSummary.mockResolvedValueOnce({
      totalDuesCollectedCents: 0,
      totalContributionsCents: 0,
      duesOutstandingCents: 0,
      duesCollected30dCents: 0,
      pendingPaymentReports: 0,
      pendingPaymentLinkReports: 0,
    });

    await render(<AdminPaymentsScreen />);

    await waitFor(() => expect(screen.getByLabelText('Contributions')).toBeTruthy());
    expect(screen.queryByLabelText('Reports')).toBeNull();
  });

  it('navigates to contributions when tapped', async () => {
    mockUseAuth.mockReturnValue(authWith(['managePayments']));
    mockGetAdminFinancialSummary.mockResolvedValueOnce({
      totalDuesCollectedCents: 0,
      totalContributionsCents: 0,
      duesOutstandingCents: 0,
      duesCollected30dCents: 0,
      pendingPaymentReports: 0,
      pendingPaymentLinkReports: 0,
    });

    await render(<AdminPaymentsScreen />);
    await waitFor(() => expect(screen.getByLabelText('Contributions')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Contributions'));
    expect(mockPush).toHaveBeenCalledWith('/admin-contributions');
  });
});
