import { act, render, screen, waitFor } from '@testing-library/react-native';

import AdminMeetingRsvpScreen from '../admin-meetings/[meetingId]';

/**
 * The read-only admin meeting RSVP planning screen. Display contract only —
 * the server enforces manageMeetings + tenancy regardless of navigation;
 * this suite pins the client-side capability re-check (a parent/member
 * persona gets the denial state and no fetch), both RSVP modes via the
 * shared AdminRsvpSection, the empty/error states, focus-driven refresh,
 * and org-switch isolation of respondent data.
 */

let latestFocusCallback: (() => void | (() => void)) | null = null;
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ meetingId: 'mtg-1' }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    latestFocusCallback = cb;
  },
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetAdminMeetingRsvp = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getAdminMeetingRsvp: (...args: unknown[]) => mockGetAdminMeetingRsvp(...args),
}));

function authWith(adminCapabilities: string[], organizationId = 'org-a') {
  return {
    selectedOrganizationId: organizationId,
    selectedOrganization: { organizationName: 'Sample Org', capability: { adminCapabilities } },
  };
}

function meetingPayload(rsvp: Record<string, unknown>) {
  return {
    id: 'mtg-1',
    title: 'September General Meeting',
    meetingDate: '2026-09-15T19:00:00.000Z',
    location: 'Library',
    status: 'SCHEDULED',
    rsvp,
  };
}

async function triggerFocus() {
  await act(async () => {
    latestFocusCallback?.();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function openScreen() {
  await render(<AdminMeetingRsvpScreen />);
  await triggerFocus();
}

beforeEach(() => {
  jest.clearAllMocks();
  latestFocusCallback = null;
  mockUseAuth.mockReturnValue(authWith(['adminDashboard', 'manageMeetings']));
});

describe('AdminMeetingRsvpScreen -- household mode', () => {
  it('renders the meeting header, mode, summary with guest math, and the household respondent list', async () => {
    mockGetAdminMeetingRsvp.mockResolvedValue(
      meetingPayload({
        mode: 'household',
        guestCounts: true,
        summary: { totalResponses: 3, going: 2, maybe: 1, notGoing: 0, totalAttendees: 7 },
        responses: [
          { id: 'r-1', name: 'The Alvarez Family', status: 'GOING', attendeeCount: 4, respondedAt: '2026-09-05T12:00:00.000Z' },
          { id: 'r-2', name: 'The Kim Family', status: 'GOING', attendeeCount: 3, respondedAt: '2026-09-05T13:00:00.000Z' },
          { id: 'r-3', name: 'The Osei Family', status: 'MAYBE', attendeeCount: 2, respondedAt: '2026-09-05T14:00:00.000Z' },
        ],
      })
    );

    await openScreen();

    await waitFor(() => expect(screen.getByText('September General Meeting')).toBeTruthy());
    expect(screen.getByText('Household RSVP mode')).toBeTruthy();
    expect(screen.getByText('2 attending · 1 maybe · 0 declined')).toBeTruthy();
    expect(screen.getByText('3 responses · 7 expected attendees including guests')).toBeTruthy();
    expect(screen.getByText('The Alvarez Family')).toBeTruthy();
    expect(screen.getByText('4 people')).toBeTruthy();
    expect(screen.getAllByText(/^Updated /)).toHaveLength(3);
    expect(screen.getAllByLabelText('Attending')).toHaveLength(2);
    expect(screen.getByLabelText('Maybe')).toBeTruthy();
    expect(mockGetAdminMeetingRsvp).toHaveBeenCalledWith('org-a', 'mtg-1');
  });
});

describe('AdminMeetingRsvpScreen -- individual mode', () => {
  it('renders member responses without guest counts', async () => {
    mockGetAdminMeetingRsvp.mockResolvedValue(
      meetingPayload({
        mode: 'individual',
        guestCounts: false,
        summary: { totalResponses: 2, going: 1, maybe: 0, notGoing: 1, totalAttendees: 1 },
        responses: [
          { id: 'r-1', name: 'Dana Whitfield', status: 'GOING', attendeeCount: null, respondedAt: '2026-09-05T12:00:00.000Z' },
          { id: 'r-2', name: 'Ray Okafor', status: 'NOT_GOING', attendeeCount: null, respondedAt: '2026-09-05T13:00:00.000Z' },
        ],
      })
    );

    await openScreen();

    await waitFor(() => expect(screen.getByText('Dana Whitfield')).toBeTruthy());
    expect(screen.getByText('Individual RSVP mode')).toBeTruthy();
    expect(screen.getByText('2 responses · 1 expected attendee')).toBeTruthy();
    expect(screen.queryByText(/including guests/)).toBeNull();
    expect(screen.queryByText(/people$/)).toBeNull();
    expect(screen.getByLabelText('Declined')).toBeTruthy();
  });
});

describe('AdminMeetingRsvpScreen -- empty, error, refresh', () => {
  it('shows the explicit empty state when nobody has responded', async () => {
    mockGetAdminMeetingRsvp.mockResolvedValue(
      meetingPayload({ mode: 'individual', guestCounts: false, summary: { totalResponses: 0, going: 0, maybe: 0, notGoing: 0, totalAttendees: 0 }, responses: [] })
    );

    await openScreen();

    await waitFor(() => expect(screen.getByText('No responses yet')).toBeTruthy());
    expect(screen.getByText('Member RSVPs will appear here as people respond.')).toBeTruthy();
  });

  it('shows a retryable error state on failure', async () => {
    mockGetAdminMeetingRsvp.mockRejectedValueOnce(new Error('network down'));

    await openScreen();

    await waitFor(() =>
      expect(screen.getByText('Unable to load meeting RSVPs. Check your connection and try again.')).toBeTruthy()
    );
  });

  it('re-fetches when the screen regains focus, picking up new and changed RSVPs', async () => {
    mockGetAdminMeetingRsvp.mockResolvedValueOnce(
      meetingPayload({ mode: 'individual', guestCounts: false, summary: { totalResponses: 0, going: 0, maybe: 0, notGoing: 0, totalAttendees: 0 }, responses: [] })
    );

    await openScreen();
    await waitFor(() => expect(screen.getByText('No responses yet')).toBeTruthy());

    mockGetAdminMeetingRsvp.mockResolvedValueOnce(
      meetingPayload({
        mode: 'individual',
        guestCounts: false,
        summary: { totalResponses: 1, going: 1, maybe: 0, notGoing: 0, totalAttendees: 1 },
        responses: [{ id: 'r-1', name: 'Dana Whitfield', status: 'GOING', attendeeCount: null, respondedAt: '2026-09-05T12:00:00.000Z' }],
      })
    );
    await triggerFocus();

    await waitFor(() => expect(screen.getByText('Dana Whitfield')).toBeTruthy());
    expect(mockGetAdminMeetingRsvp).toHaveBeenCalledTimes(2);
  });
});

describe('AdminMeetingRsvpScreen -- authorization and isolation', () => {
  it('a parent/member persona without manageMeetings gets the denial state and no fetch at all', async () => {
    mockUseAuth.mockReturnValue(authWith([]));

    await render(<AdminMeetingRsvpScreen />);

    expect(screen.getByText("You don't have meeting administration access for this organization.")).toBeTruthy();
    expect(mockGetAdminMeetingRsvp).not.toHaveBeenCalled();
  });

  it('a manageEvents-only admin is denied too -- meeting respondents require manageMeetings specifically', async () => {
    mockUseAuth.mockReturnValue(authWith(['adminDashboard', 'manageEvents']));

    await render(<AdminMeetingRsvpScreen />);

    expect(screen.getByText("You don't have meeting administration access for this organization.")).toBeTruthy();
    expect(mockGetAdminMeetingRsvp).not.toHaveBeenCalled();
  });

  it("never shows one organization's respondents after switching to another organization, even while the new fetch is pending", async () => {
    mockUseAuth.mockReturnValue(authWith(['manageMeetings'], 'org-a'));
    mockGetAdminMeetingRsvp.mockResolvedValueOnce(
      meetingPayload({
        mode: 'individual',
        guestCounts: false,
        summary: { totalResponses: 1, going: 1, maybe: 0, notGoing: 0, totalAttendees: 1 },
        responses: [{ id: 'r-1', name: 'Dana Whitfield', status: 'GOING', attendeeCount: null, respondedAt: '2026-09-05T12:00:00.000Z' }],
      })
    );
    const { rerender } = await render(<AdminMeetingRsvpScreen />);
    await triggerFocus();
    await waitFor(() => expect(screen.getByText('Dana Whitfield')).toBeTruthy());

    mockUseAuth.mockReturnValue(authWith(['manageMeetings'], 'org-b'));
    mockGetAdminMeetingRsvp.mockImplementation(() => new Promise(() => {}));
    await rerender(<AdminMeetingRsvpScreen />);
    await triggerFocus();

    expect(screen.queryByText('Dana Whitfield')).toBeNull();
  });
});
