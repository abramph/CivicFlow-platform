import { render, screen, waitFor } from '@testing-library/react-native';

import MeetingsScreen from '../meetings';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), navigate: jest.fn() },
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetMeetingsForOrganization = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getMeetingsForOrganization: (...args: unknown[]) => mockGetMeetingsForOrganization(...args),
}));

const meeting = {
  id: 'meeting-1',
  title: 'General Meeting',
  meetingType: 'General',
  meetingDate: '2026-09-01T18:00:00.000Z',
  location: 'Union Hall',
  description: null,
  rsvp: {
    mode: 'individual',
    canRsvp: true,
    guestCounts: false,
    response: { status: 'GOING', attendeeCount: 1 },
    subject: { type: 'member', id: 'member-1' },
  },
};

describe('Meetings list — capability-driven', () => {
  beforeEach(() => {
    mockGetMeetingsForOrganization.mockReset();
  });

  it('passes the org rsvp capability to the routing helper and shows the block-driven badge', async () => {
    const rsvpCapability = { mode: 'individual', guestCounts: false, canRsvp: true };
    mockUseAuth.mockReturnValue({
      selectedOrganization: { memberId: 'member-1', pta: null, capability: { rsvp: rsvpCapability } },
      selectedOrganizationId: 'org-1',
    });
    mockGetMeetingsForOrganization.mockResolvedValue([meeting]);

    await render(<MeetingsScreen />);

    await waitFor(() => expect(screen.getByText('General Meeting')).toBeTruthy());
    expect(mockGetMeetingsForOrganization).toHaveBeenCalledWith('org-1', rsvpCapability, true);
    expect(screen.getByText(/You're going/)).toBeTruthy();
  });

  it('loads for a staff-only login and shows no RSVP badge when canRsvp is false', async () => {
    mockUseAuth.mockReturnValue({
      selectedOrganization: { memberId: null, pta: null, capability: { rsvp: { mode: 'individual', guestCounts: false, canRsvp: false } } },
      selectedOrganizationId: 'org-1',
    });
    mockGetMeetingsForOrganization.mockResolvedValue([
      { ...meeting, rsvp: { mode: 'individual', canRsvp: false, guestCounts: false, response: null, subject: { type: 'none', id: null } } },
    ]);

    await render(<MeetingsScreen />);

    await waitFor(() => expect(screen.getByText('General Meeting')).toBeTruthy());
    expect(screen.queryByText(/You're/)).toBeNull();
  });
});
