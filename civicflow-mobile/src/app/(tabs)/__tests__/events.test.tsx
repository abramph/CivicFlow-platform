import { render, screen, waitFor } from '@testing-library/react-native';

import EventsScreen from '../events';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('@/hooks/use-screen-top-padding', () => ({
  useScreenTopPadding: () => ({ paddingTop: 0 }),
}));

const mockGetEventsForOrganization = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getEventsForOrganization: (...args: unknown[]) => mockGetEventsForOrganization(...args),
}));

const communityEvent = {
  id: 'event-1',
  title: 'Town Hall',
  startAt: '2026-09-01T18:00:00.000Z',
  endAt: null,
  location: 'Main St Hall',
  description: null,
  status: 'upcoming',
  rsvp: {
    mode: 'individual',
    canRsvp: true,
    guestCounts: false,
    response: { status: 'GOING', attendeeCount: 1 },
    subject: { type: 'member', id: 'member-1' },
  },
};

describe('Events tab — capability-driven list', () => {
  beforeEach(() => {
    mockGetEventsForOrganization.mockReset();
  });

  it('passes the org rsvp capability through to the routing helper and shows the rsvp-block badge', async () => {
    const rsvpCapability = { mode: 'individual', guestCounts: false, canRsvp: true };
    mockUseAuth.mockReturnValue({
      selectedOrganization: { memberId: 'member-1', pta: null, capability: { rsvp: rsvpCapability } },
      selectedOrganizationId: 'org-1',
    });
    mockGetEventsForOrganization.mockResolvedValue([communityEvent]);

    await render(<EventsScreen />);

    await waitFor(() => expect(screen.getByText('Town Hall')).toBeTruthy());
    expect(mockGetEventsForOrganization).toHaveBeenCalledWith('org-1', rsvpCapability, true);
    expect(screen.getByText(/You're going/)).toBeTruthy();
  });

  it('loads events for a staff-only login (no member or household identity) — previously silently skipped', async () => {
    mockUseAuth.mockReturnValue({
      selectedOrganization: { memberId: null, pta: null, capability: { rsvp: { mode: 'individual', guestCounts: false, canRsvp: false } } },
      selectedOrganizationId: 'org-1',
    });
    mockGetEventsForOrganization.mockResolvedValue([
      { ...communityEvent, rsvp: { mode: 'individual', canRsvp: false, guestCounts: false, response: null, subject: { type: 'none', id: null } } },
    ]);

    await render(<EventsScreen />);

    await waitFor(() => expect(screen.getByText('Town Hall')).toBeTruthy());
    expect(screen.queryByText(/You're/)).toBeNull();
  });
});
