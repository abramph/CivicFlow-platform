import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import AdminEventsScreen from '../admin-events';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  Redirect: () => null,
  useFocusEffect: (cb: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(cb, [cb]);
  },
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

  it('renders the compact RSVP planning line -- household guest math, explicit zero state, and old-payload omission', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageEvents']));
    mockGetAdminEvents.mockResolvedValueOnce([
      {
        id: 'evt-1', title: 'Fall Festival', location: null, startAt: null, endAt: null, status: 'upcoming',
        rsvp: { guestCounts: true, totalResponses: 3, going: 2, maybe: 1, notGoing: 0, totalAttendees: 7 },
      },
      {
        id: 'evt-2', title: 'Book Fair', location: null, startAt: null, endAt: null, status: 'upcoming',
        rsvp: { guestCounts: true, totalResponses: 0, going: 0, maybe: 0, notGoing: 0, totalAttendees: 0 },
      },
      // Older portal payload: no rsvp field at all -- the row renders
      // without any planning line rather than a fabricated zero.
      { id: 'evt-3', title: 'Spring Gala', location: null, startAt: null, endAt: null, status: 'upcoming' },
    ]);

    await render(<AdminEventsScreen />);

    await waitFor(() => expect(screen.getByText('2 going · 7 expected incl. guests')).toBeTruthy());
    expect(screen.getByText('No responses yet')).toBeTruthy();
    expect(screen.getByText('Spring Gala')).toBeTruthy();
    // Exactly one planning line and one zero state -- the old-payload row
    // contributed neither.
    expect(screen.getAllByText(/going · |No responses yet/)).toHaveLength(2);
  });

  it('renders the individual-mode line without the guests suffix', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageEvents']));
    mockGetAdminEvents.mockResolvedValueOnce([
      {
        id: 'evt-1', title: 'Cleanup Day', location: null, startAt: null, endAt: null, status: 'upcoming',
        rsvp: { guestCounts: false, totalResponses: 5, going: 4, maybe: 0, notGoing: 1, totalAttendees: 4 },
      },
    ]);

    await render(<AdminEventsScreen />);

    await waitFor(() => expect(screen.getByText('4 going · 4 expected')).toBeTruthy());
    expect(screen.queryByText(/incl\. guests/)).toBeNull();
  });

  it("never shows one organization's rows (or their RSVP counts) after switching to another organization, even while the new fetch is pending", async () => {
    mockUseAuth.mockReturnValue({
      selectedOrganizationId: 'org-a',
      selectedOrganization: { organizationName: 'Org A', capability: { adminCapabilities: ['manageEvents'] } },
    });
    mockGetAdminEvents.mockResolvedValueOnce([
      {
        id: 'evt-1', title: 'Org A Gala', location: null, startAt: null, endAt: null, status: 'upcoming',
        rsvp: { guestCounts: false, totalResponses: 5, going: 5, maybe: 0, notGoing: 0, totalAttendees: 5 },
      },
    ]);

    const { rerender } = await render(<AdminEventsScreen />);
    await waitFor(() => expect(screen.getByText('Org A Gala')).toBeTruthy());

    mockUseAuth.mockReturnValue({
      selectedOrganizationId: 'org-b',
      selectedOrganization: { organizationName: 'Org B', capability: { adminCapabilities: ['manageEvents'] } },
    });
    mockGetAdminEvents.mockImplementation(() => new Promise(() => {}));
    await rerender(<AdminEventsScreen />);

    expect(screen.queryByText('Org A Gala')).toBeNull();
    expect(screen.queryByText('5 going · 5 expected')).toBeNull();
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
