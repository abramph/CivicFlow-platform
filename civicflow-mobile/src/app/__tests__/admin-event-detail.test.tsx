import { render, screen, waitFor } from '@testing-library/react-native';

import AdminEventDetailScreen from '../admin-events/[eventId]/index';

/**
 * Covers the Build 27 round-1 addition: the admin RSVP section. The server
 * decides the RSVP mode from the org's capability and enforces
 * manageEvents/tenancy; this screen's contract is display-only -- render
 * exactly what the payload says, hide the section for mode 'none' or an
 * older server payload without the block, and keep the existing
 * no-manageEvents denial state (which also proves a parent-persona login,
 * which never holds admin capabilities, sees no RSVP data path at all).
 */

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  useLocalSearchParams: () => ({ eventId: 'evt-1' }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(cb, [cb]);
  },
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetAdminEvent = jest.fn();
const mockUpdateAdminEvent = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getAdminEvent: (...args: unknown[]) => mockGetAdminEvent(...args),
  updateAdminEvent: (...args: unknown[]) => mockUpdateAdminEvent(...args),
}));

function authWith(adminCapabilities: string[]) {
  return {
    selectedOrganizationId: 'org-a',
    selectedOrganization: { organizationName: 'Sample Org', capability: { adminCapabilities } },
  };
}

function eventPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt-1',
    organizationId: 'org-a',
    title: 'Fall Festival',
    description: null,
    location: 'Main Hall',
    startAt: '2026-09-20T18:00:00.000Z',
    endAt: null,
    status: 'upcoming',
    notes: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseAuth.mockReturnValue(authWith(['manageEvents']));
});

describe('AdminEventDetailScreen -- RSVP section (household mode)', () => {
  it('renders the summary and the household list with per-household guest counts', async () => {
    mockGetAdminEvent.mockResolvedValue(
      eventPayload({
        rsvp: {
          mode: 'household',
          guestCounts: true,
          summary: { totalResponses: 3, going: 1, maybe: 1, notGoing: 1, totalAttendees: 3 },
          responses: [
            { id: 'r-1', name: 'The Alvarez Family', status: 'GOING', attendeeCount: 3, respondedAt: '2026-09-05T12:00:00.000Z' },
            { id: 'r-2', name: 'The Kim Family', status: 'MAYBE', attendeeCount: 2, respondedAt: '2026-09-05T13:00:00.000Z' },
            { id: 'r-3', name: 'The Osei Family', status: 'NOT_GOING', attendeeCount: 1, respondedAt: '2026-09-05T14:00:00.000Z' },
          ],
        },
      })
    );

    await render(<AdminEventDetailScreen />);

    await waitFor(() => expect(screen.getByRole('header', { name: 'RSVPs' })).toBeTruthy());
    expect(screen.getByText('1 attending · 1 maybe · 1 declined')).toBeTruthy();
    expect(screen.getByText('3 responses · 3 expected attendees including guests')).toBeTruthy();
    expect(screen.getByText('The Alvarez Family')).toBeTruthy();
    expect(screen.getByText('3 people')).toBeTruthy();
    expect(screen.getByLabelText('Attending')).toBeTruthy();
    expect(screen.getByLabelText('Maybe')).toBeTruthy();
    expect(screen.getByLabelText('Declined')).toBeTruthy();
    // A declined household's stale guest count is never displayed.
    expect(screen.queryByText('1 person')).toBeNull();
  });

  it('shows the empty state when nobody has responded yet', async () => {
    mockGetAdminEvent.mockResolvedValue(
      eventPayload({
        rsvp: { mode: 'household', guestCounts: true, summary: { totalResponses: 0, going: 0, maybe: 0, notGoing: 0, totalAttendees: 0 }, responses: [] },
      })
    );

    await render(<AdminEventDetailScreen />);

    await waitFor(() => expect(screen.getByRole('header', { name: 'RSVPs' })).toBeTruthy());
    expect(screen.getByText('No responses yet')).toBeTruthy();
    expect(screen.getByText('Household RSVPs will appear here as families respond.')).toBeTruthy();
  });
});

describe('AdminEventDetailScreen -- RSVP section (individual mode)', () => {
  it('renders member responses without guest counts', async () => {
    mockGetAdminEvent.mockResolvedValue(
      eventPayload({
        rsvp: {
          mode: 'individual',
          guestCounts: false,
          summary: { totalResponses: 2, going: 1, maybe: 0, notGoing: 1, totalAttendees: 1 },
          responses: [
            { id: 'r-1', name: 'Dana Whitfield', status: 'GOING', attendeeCount: null, respondedAt: '2026-09-05T12:00:00.000Z' },
            { id: 'r-2', name: 'Ray Okafor', status: 'NOT_GOING', attendeeCount: null, respondedAt: '2026-09-05T13:00:00.000Z' },
          ],
        },
      })
    );

    await render(<AdminEventDetailScreen />);

    await waitFor(() => expect(screen.getByText('Dana Whitfield')).toBeTruthy());
    expect(screen.getByText('2 responses · 1 expected attendee')).toBeTruthy();
    expect(screen.queryByText(/including guests/)).toBeNull();
    expect(screen.queryByText(/people$/)).toBeNull();
  });
});

describe('AdminEventDetailScreen -- RSVP section hidden when not applicable', () => {
  it("renders no RSVP section for mode 'none' (HOA)", async () => {
    mockGetAdminEvent.mockResolvedValue(
      eventPayload({ rsvp: { mode: 'none', guestCounts: false, summary: null, responses: [] } })
    );

    await render(<AdminEventDetailScreen />);

    await waitFor(() => expect(screen.getByText('Fall Festival')).toBeTruthy());
    expect(screen.queryByRole('header', { name: 'RSVPs' })).toBeNull();
  });

  it('renders no RSVP section against an older server payload without the block', async () => {
    mockGetAdminEvent.mockResolvedValue(eventPayload());

    await render(<AdminEventDetailScreen />);

    await waitFor(() => expect(screen.getByText('Fall Festival')).toBeTruthy());
    expect(screen.queryByRole('header', { name: 'RSVPs' })).toBeNull();
  });
});

describe('AdminEventDetailScreen -- authorization', () => {
  it('a login without manageEvents (e.g. a parent persona) gets the denial state and no event/RSVP fetch at all', async () => {
    mockUseAuth.mockReturnValue(authWith(['adminDashboard']));

    await render(<AdminEventDetailScreen />);

    await waitFor(() =>
      expect(screen.getByText("You don't have event administration access for this organization.")).toBeTruthy()
    );
    expect(mockGetAdminEvent).not.toHaveBeenCalled();
  });

  it('fetches strictly by the selected organization id -- the tenant scope the server re-verifies', async () => {
    mockGetAdminEvent.mockResolvedValue(eventPayload());

    await render(<AdminEventDetailScreen />);

    await waitFor(() => expect(mockGetAdminEvent).toHaveBeenCalledWith('org-a', 'evt-1'));
  });
});
