import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import AdminContributionsScreen from '../admin-contributions';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  Redirect: () => null,
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetAdminContributions = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getAdminContributions: (...args: unknown[]) => mockGetAdminContributions(...args),
}));

function authWith(adminCapabilities: string[]) {
  return {
    selectedOrganizationId: 'org-a',
    selectedOrganization: { organizationName: 'Sample Org', capability: { adminCapabilities } },
  };
}

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'contrib-1',
    amount: '25.00',
    contributionDate: '2026-08-01T00:00:00.000Z',
    source: 'MANUAL',
    paymentMethod: 'CASH',
    voidedAt: null,
    member: { id: 'member-1', firstName: 'Ada', lastName: 'Lovelace' },
    campaign: null,
    event: null,
    ...overrides,
  };
}

describe('Admin contributions list screen', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockGetAdminContributions.mockReset();
  });

  it('shows a denial state and never fetches without managePayments', async () => {
    mockUseAuth.mockReturnValue(authWith([]));

    await render(<AdminContributionsScreen />);

    await waitFor(() =>
      expect(screen.getByText("You don't have payments administration access for this organization.")).toBeTruthy()
    );
    expect(mockGetAdminContributions).not.toHaveBeenCalled();
  });

  it('shows an empty state with no contributions', async () => {
    mockUseAuth.mockReturnValue(authWith(['managePayments']));
    mockGetAdminContributions.mockResolvedValueOnce([]);

    await render(<AdminContributionsScreen />);

    await waitFor(() => expect(screen.getByText('No contributions yet.')).toBeTruthy());
  });

  it('shows a load-error banner on failure', async () => {
    mockUseAuth.mockReturnValue(authWith(['managePayments']));
    mockGetAdminContributions.mockRejectedValueOnce(new Error('network'));

    await render(<AdminContributionsScreen />);

    await waitFor(() => expect(screen.getByText('Unable to load contributions. Check your connection and try again.')).toBeTruthy());
  });

  it('renders contributions and marks voided ones', async () => {
    mockUseAuth.mockReturnValue(authWith(['managePayments']));
    mockGetAdminContributions.mockResolvedValueOnce([
      row(),
      row({ id: 'contrib-2', member: null, campaign: { id: 'camp-1', name: 'Fall Drive' }, voidedAt: '2026-08-02T00:00:00.000Z' }),
    ]);

    await render(<AdminContributionsScreen />);

    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy());
    expect(screen.getByText('Campaign: Fall Drive')).toBeTruthy();
    expect(screen.getByText('Voided')).toBeTruthy();
  });

  it('navigates to the create screen when New is tapped', async () => {
    mockUseAuth.mockReturnValue(authWith(['managePayments']));
    mockGetAdminContributions.mockResolvedValueOnce([]);

    await render(<AdminContributionsScreen />);
    await waitFor(() => expect(mockGetAdminContributions).toHaveBeenCalled());

    await fireEvent.press(screen.getByLabelText('New contribution'));
    expect(mockPush).toHaveBeenCalledWith('/admin-contributions/new');
  });

  it('navigates to the detail screen when a row is tapped', async () => {
    mockUseAuth.mockReturnValue(authWith(['managePayments']));
    mockGetAdminContributions.mockResolvedValueOnce([row()]);

    await render(<AdminContributionsScreen />);
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Ada Lovelace, $25.00'));
    expect(mockPush).toHaveBeenCalledWith('/admin-contributions/contrib-1');
  });
});
