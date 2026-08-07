import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import AdminMembersScreen from '../admin-members';

const mockPush = jest.fn();
const mockParams: { membershipStatus?: string; delinquency?: string } = {};
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  useLocalSearchParams: () => mockParams,
  Redirect: () => null,
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetAdminMembers = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getAdminMembers: (...args: unknown[]) => mockGetAdminMembers(...args),
}));

function authWith(adminCapabilities: string[]) {
  return {
    selectedOrganizationId: 'org-a',
    selectedOrganization: { organizationName: 'Sample Org', capability: { adminCapabilities } },
  };
}

describe('Admin members list screen', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockGetAdminMembers.mockReset();
    delete mockParams.membershipStatus;
    delete mockParams.delinquency;
  });

  it('shows a denial state and never fetches when the caller lacks manageMembers', async () => {
    mockUseAuth.mockReturnValue(authWith(['adminDashboard']));

    await render(<AdminMembersScreen />);

    await waitFor(() =>
      expect(screen.getByText("You don't have member administration access for this organization.")).toBeTruthy()
    );
    expect(mockGetAdminMembers).not.toHaveBeenCalled();
  });

  it('loads and renders members for an authorized officer', async () => {
    mockUseAuth.mockReturnValue(authWith(['adminDashboard', 'manageMembers']));
    mockGetAdminMembers.mockResolvedValueOnce({
      members: [
        { id: 'm-1', firstName: 'Ada', lastName: 'Lovelace', preferredName: null, email: 'ada@example.com', phone: null, membershipStatus: 'active', isDelinquent: false, householdName: null, city: null, state: null },
      ],
      page: 1,
      pageSize: 25,
      total: 1,
      hasMore: false,
    });

    await render(<AdminMembersScreen />);

    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy());
    expect(mockGetAdminMembers).toHaveBeenCalledWith('org-a', expect.objectContaining({ page: 1 }));
  });

  it('shows the empty state with no search/filter applied', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageMembers']));
    mockGetAdminMembers.mockResolvedValueOnce({ members: [], page: 1, pageSize: 25, total: 0, hasMore: false });

    await render(<AdminMembersScreen />);

    await waitFor(() => expect(screen.getByText('No members yet.')).toBeTruthy());
  });

  it('shows a retry banner on load failure', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageMembers']));
    mockGetAdminMembers.mockRejectedValueOnce(new Error('network down'));

    await render(<AdminMembersScreen />);

    await waitFor(() => expect(screen.getByText('Unable to load members. Check your connection and try again.')).toBeTruthy());
  });

  it('navigates to the member detail screen when a row is tapped', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageMembers']));
    mockGetAdminMembers.mockResolvedValueOnce({
      members: [{ id: 'm-1', firstName: 'Ada', lastName: 'Lovelace', preferredName: null, email: null, phone: null, membershipStatus: 'active', isDelinquent: false, householdName: null, city: null, state: null }],
      page: 1,
      pageSize: 25,
      total: 1,
      hasMore: false,
    });

    await render(<AdminMembersScreen />);
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Ada Lovelace'));

    expect(mockPush).toHaveBeenCalledWith('/admin-members/m-1');
  });

  it('navigates to the create-member screen when Add is tapped', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageMembers']));
    mockGetAdminMembers.mockResolvedValueOnce({ members: [], page: 1, pageSize: 25, total: 0, hasMore: false });

    await render(<AdminMembersScreen />);
    await waitFor(() => expect(mockGetAdminMembers).toHaveBeenCalled());

    await fireEvent.press(screen.getByLabelText('Add member'));

    expect(mockPush).toHaveBeenCalledWith('/admin-members/new');
  });

  it('applies the initial membershipStatus filter from navigation params (dashboard deep-link)', async () => {
    mockParams.membershipStatus = 'delinquent-check';
    mockUseAuth.mockReturnValue(authWith(['manageMembers']));
    mockGetAdminMembers.mockResolvedValueOnce({ members: [], page: 1, pageSize: 25, total: 0, hasMore: false });

    await render(<AdminMembersScreen />);

    await waitFor(() =>
      expect(mockGetAdminMembers).toHaveBeenCalledWith('org-a', expect.objectContaining({ membershipStatus: 'delinquent-check' }))
    );
  });

  it('shows a delinquent tag for delinquent members', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageMembers']));
    mockGetAdminMembers.mockResolvedValueOnce({
      members: [{ id: 'm-1', firstName: 'Ada', lastName: 'Lovelace', preferredName: null, email: null, phone: null, membershipStatus: 'active', isDelinquent: true, householdName: null, city: null, state: null }],
      page: 1,
      pageSize: 25,
      total: 1,
      hasMore: false,
    });

    await render(<AdminMembersScreen />);

    await waitFor(() => expect(screen.getByText('Delinquent')).toBeTruthy());
  });
});
