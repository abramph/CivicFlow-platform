import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import AdminDashboardScreen from '../admin';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetAdminDashboard = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getAdminDashboard: (...args: unknown[]) => mockGetAdminDashboard(...args),
}));

describe('Admin dashboard screen — capability gating', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockGetAdminDashboard.mockReset();
  });

  it('shows a denial state and never fetches when the caller has no admin capabilities — defends direct navigation even if the tab were somehow reached', async () => {
    mockUseAuth.mockReturnValue({
      selectedOrganizationId: 'org-a',
      selectedOrganization: { organizationName: 'Sample Org', capability: { adminCapabilities: [] } },
    });

    await render(<AdminDashboardScreen />);

    await waitFor(() =>
      expect(screen.getByText("You don't have administration access for this organization.")).toBeTruthy()
    );
    expect(mockGetAdminDashboard).not.toHaveBeenCalled();
  });

  it('shows a denial state when the organization has no capability data at all', async () => {
    mockUseAuth.mockReturnValue({
      selectedOrganizationId: 'org-a',
      selectedOrganization: { organizationName: 'Sample Org' },
    });

    await render(<AdminDashboardScreen />);

    await waitFor(() =>
      expect(screen.getByText("You don't have administration access for this organization.")).toBeTruthy()
    );
  });

  it('renders real metrics and Needs Attention items for an authorized officer', async () => {
    mockUseAuth.mockReturnValue({
      selectedOrganizationId: 'org-a',
      selectedOrganization: { organizationName: 'Sample Org', capability: { adminCapabilities: ['adminDashboard', 'managePtaVolunteers'] } },
    });
    mockGetAdminDashboard.mockResolvedValueOnce({
      metrics: [{ key: 'ptaPendingHourApprovals', label: 'Volunteer Hours Awaiting Approval', value: 3, href: '/volunteer-hour-approvals' }],
      needsAttention: [{ id: 'pta-pending-hour-approvals', label: '3 volunteer hour submissions awaiting approval', href: '/volunteer-hour-approvals' }],
      generatedAt: '2026-08-07T00:00:00.000Z',
    });

    await render(<AdminDashboardScreen />);

    await waitFor(() => expect(screen.getByText('Needs Attention')).toBeTruthy());
    expect(screen.getByText('3 volunteer hour submissions awaiting approval')).toBeTruthy();
    expect(screen.getByText('Volunteer Hours Awaiting Approval')).toBeTruthy();
    expect(mockGetAdminDashboard).toHaveBeenCalledWith('org-a');
  });

  it('navigates to the deep-link href when a Needs Attention item is tapped', async () => {
    mockUseAuth.mockReturnValue({
      selectedOrganizationId: 'org-a',
      selectedOrganization: { organizationName: 'Sample Org', capability: { adminCapabilities: ['adminDashboard', 'managePtaVolunteers'] } },
    });
    mockGetAdminDashboard.mockResolvedValueOnce({
      metrics: [],
      needsAttention: [{ id: 'pta-pending-hour-approvals', label: '1 volunteer hour submission awaiting approval', href: '/volunteer-hour-approvals' }],
      generatedAt: '2026-08-07T00:00:00.000Z',
    });

    await render(<AdminDashboardScreen />);
    await waitFor(() => expect(screen.getByText('1 volunteer hour submission awaiting approval')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('1 volunteer hour submission awaiting approval'));

    expect(mockPush).toHaveBeenCalledWith('/volunteer-hour-approvals');
  });

  it('shows the empty state when the caller has an admin capability but nothing to display yet', async () => {
    mockUseAuth.mockReturnValue({
      selectedOrganizationId: 'org-a',
      selectedOrganization: { organizationName: 'Sample Org', capability: { adminCapabilities: ['adminDashboard'] } },
    });
    mockGetAdminDashboard.mockResolvedValueOnce({ metrics: [], needsAttention: [], generatedAt: '2026-08-07T00:00:00.000Z' });

    await render(<AdminDashboardScreen />);

    await waitFor(() => expect(screen.getByText('Nothing to show here yet for your role in this organization.')).toBeTruthy());
  });

  it('shows a retry banner when the fetch fails, without crashing', async () => {
    mockUseAuth.mockReturnValue({
      selectedOrganizationId: 'org-a',
      selectedOrganization: { organizationName: 'Sample Org', capability: { adminCapabilities: ['adminDashboard'] } },
    });
    mockGetAdminDashboard.mockRejectedValueOnce(new Error('network down'));

    await render(<AdminDashboardScreen />);

    await waitFor(() => expect(screen.getByText('Unable to load the admin dashboard. Check your connection and try again.')).toBeTruthy());
  });
});
