import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import AdminEventsScreen from '../admin-events';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  Redirect: () => null,
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetAdminEvents = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getAdminEvents: (...args: unknown[]) => mockGetAdminEvents(...args),
}));

function authWith(adminCapabilities: string[]) {
  return {
    selectedOrganizationId: 'org-a',
    selectedOrganization: { organizationName: 'Sample Org', capability: { adminCapabilities } },
  };
}

describe('Admin events list screen', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockGetAdminEvents.mockReset();
  });

  it('shows a denial state and never fetches without manageEvents', async () => {
    mockUseAuth.mockReturnValue(authWith(['adminDashboard']));

    await render(<AdminEventsScreen />);

    await waitFor(() =>
      expect(screen.getByText("You don't have event administration access for this organization.")).toBeTruthy()
    );
    expect(mockGetAdminEvents).not.toHaveBeenCalled();
  });

  it('loads and renders events for an authorized officer', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageEvents']));
    mockGetAdminEvents.mockResolvedValueOnce([
      { id: 'evt-1', title: 'Fall Festival', location: 'Main Hall', startAt: '2026-09-01T18:00:00.000Z', endAt: null, status: 'upcoming' },
    ]);

    await render(<AdminEventsScreen />);

    await waitFor(() => expect(screen.getByText('Fall Festival')).toBeTruthy());
    expect(mockGetAdminEvents).toHaveBeenCalledWith('org-a');
  });

  it('shows the empty state', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageEvents']));
    mockGetAdminEvents.mockResolvedValueOnce([]);

    await render(<AdminEventsScreen />);

    await waitFor(() => expect(screen.getByText('No events yet.')).toBeTruthy());
  });

  it('shows a retry banner on load failure', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageEvents']));
    mockGetAdminEvents.mockRejectedValueOnce(new Error('network down'));

    await render(<AdminEventsScreen />);

    await waitFor(() => expect(screen.getByText('Unable to load events. Check your connection and try again.')).toBeTruthy());
  });

  it('navigates to the event detail screen when a row is tapped', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageEvents']));
    mockGetAdminEvents.mockResolvedValueOnce([{ id: 'evt-1', title: 'Fall Festival', location: null, startAt: null, endAt: null, status: 'upcoming' }]);

    await render(<AdminEventsScreen />);
    await waitFor(() => expect(screen.getByText('Fall Festival')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Fall Festival'));

    expect(mockPush).toHaveBeenCalledWith('/admin-events/evt-1');
  });

  it('navigates to the create screen when Add is tapped', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageEvents']));
    mockGetAdminEvents.mockResolvedValueOnce([]);

    await render(<AdminEventsScreen />);
    await waitFor(() => expect(mockGetAdminEvents).toHaveBeenCalled());

    await fireEvent.press(screen.getByLabelText('Add event'));

    expect(mockPush).toHaveBeenCalledWith('/admin-events/new');
  });
});
