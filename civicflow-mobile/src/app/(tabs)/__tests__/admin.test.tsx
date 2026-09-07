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

  it('renders the Upcoming Attendance planning section: event rows AND meeting rows navigate to their planning screens', async () => {
    mockUseAuth.mockReturnValue({
      selectedOrganizationId: 'org-a',
      selectedOrganization: { organizationName: 'Sample Org', capability: { adminCapabilities: ['adminDashboard', 'manageEvents', 'manageMeetings'] } },
    });
    mockGetAdminDashboard.mockResolvedValueOnce({
      metrics: [],
      needsAttention: [],
      rsvpPlanning: {
        mode: 'household',
        guestCounts: true,
        items: [
          {
            type: 'event',
            id: 'evt-1',
            title: 'Fall Festival',
            startAt: '2026-09-20T18:00:00.000Z',
            counts: { totalResponses: 3, going: 2, maybe: 1, notGoing: 0, totalAttendees: 7 },
            href: '/admin-events/evt-1',
          },
          {
            type: 'meeting',
            id: 'mtg-1',
            title: 'September General Meeting',
            startAt: '2026-09-15T19:00:00.000Z',
            counts: { totalResponses: 0, going: 0, maybe: 0, notGoing: 0, totalAttendees: 0 },
            href: '/admin-meetings/mtg-1',
          },
        ],
      },
      generatedAt: '2026-09-07T00:00:00.000Z',
    });

    await render(<AdminDashboardScreen />);

    await waitFor(() => expect(screen.getByText('Upcoming Attendance')).toBeTruthy());
    // Household math surfaces as expected attendees including guests --
    // never the raw row count.
    expect(screen.getByText('2 going · 7 expected incl. guests')).toBeTruthy();
    // A zero-response upcoming activity is an explicit state.
    expect(screen.getByText('No responses yet')).toBeTruthy();
    expect(screen.getByText('Meeting · September General Meeting')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText(/^Fall Festival/));
    expect(mockPush).toHaveBeenCalledWith('/admin-events/evt-1');
    // Meeting summaries are actionable: they open the read-only meeting
    // RSVP planning screen.
    await fireEvent.press(screen.getByLabelText(/^Meeting: September General Meeting/));
    expect(mockPush).toHaveBeenCalledWith('/admin-meetings/mtg-1');
  });

  it('renders a meeting row from an OLDER server payload (no href) as informational, without crashing', async () => {
    mockUseAuth.mockReturnValue({
      selectedOrganizationId: 'org-a',
      selectedOrganization: { organizationName: 'Sample Org', capability: { adminCapabilities: ['adminDashboard', 'manageMeetings'] } },
    });
    mockGetAdminDashboard.mockResolvedValueOnce({
      metrics: [],
      needsAttention: [],
      rsvpPlanning: {
        mode: 'individual',
        guestCounts: false,
        items: [
          {
            type: 'meeting',
            id: 'mtg-9',
            title: 'Budget Review',
            startAt: '2026-09-18T19:00:00.000Z',
            counts: { totalResponses: 4, going: 4, maybe: 0, notGoing: 0, totalAttendees: 4 },
          },
        ],
      },
      generatedAt: '2026-09-07T00:00:00.000Z',
    });

    await render(<AdminDashboardScreen />);

    await waitFor(() => expect(screen.getByText('Meeting · Budget Review')).toBeTruthy());
    expect(screen.getByText('4 going · 4 expected')).toBeTruthy();
    expect(screen.getByLabelText(/^Meeting: Budget Review/).props.accessibilityRole).not.toBe('button');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('renders no planning section against an older portal payload without rsvpPlanning', async () => {
    mockUseAuth.mockReturnValue({
      selectedOrganizationId: 'org-a',
      selectedOrganization: { organizationName: 'Sample Org', capability: { adminCapabilities: ['adminDashboard', 'manageEvents'] } },
    });
    mockGetAdminDashboard.mockResolvedValueOnce({
      metrics: [{ key: 'eventsUpcoming', label: 'Upcoming Events', value: 2, href: '/admin-events' }],
      needsAttention: [],
      generatedAt: '2026-09-07T00:00:00.000Z',
    });

    await render(<AdminDashboardScreen />);

    await waitFor(() => expect(screen.getByText('Upcoming Events')).toBeTruthy());
    expect(screen.queryByText('Upcoming Attendance')).toBeNull();
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
