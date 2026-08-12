import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import EventDetailScreen from '../[id]';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'event-1' }),
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetEventsForOrganization = jest.fn();
const mockSetPtaEventRsvp = jest.fn();
const mockSetEventRsvp = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getEventsForOrganization: (...args: unknown[]) => mockGetEventsForOrganization(...args),
  setPtaEventRsvp: (...args: unknown[]) => mockSetPtaEventRsvp(...args),
  setEventRsvp: (...args: unknown[]) => mockSetEventRsvp(...args),
}));

type RsvpBlock = {
  mode: 'household' | 'individual' | 'none';
  canRsvp: boolean;
  guestCounts: boolean;
  response: { status: string; attendeeCount: number } | null;
  subject: { type: 'household' | 'member' | 'none'; id: string | null };
};

function eventWithRsvp(rsvp: RsvpBlock | undefined, extra: Record<string, unknown> = {}) {
  return {
    id: 'event-1',
    title: 'Family Movie Night',
    startAt: '2026-09-10T18:00:00.000Z',
    endAt: null,
    location: 'Cafeteria',
    description: null,
    rsvp,
    ...extra,
  };
}

function householdBlock(response: { status: string; attendeeCount: number } | null): RsvpBlock {
  return { mode: 'household', canRsvp: true, guestCounts: true, response, subject: { type: 'household', id: 'household-1' } };
}

function individualBlock(response: { status: string; attendeeCount: number } | null): RsvpBlock {
  return { mode: 'individual', canRsvp: true, guestCounts: false, response, subject: { type: 'member', id: 'member-1' } };
}

function useAuthAs(organization: Record<string, unknown>) {
  mockUseAuth.mockReturnValue({ selectedOrganization: organization, selectedOrganizationId: 'org-1' });
}

describe('Event detail RSVP — capability-driven (the rsvp block, never event shape)', () => {
  beforeEach(() => {
    mockGetEventsForOrganization.mockReset();
    mockSetPtaEventRsvp.mockReset();
    mockSetEventRsvp.mockReset();
  });

  it('PTA household: shows the radio group, current selection, and the household guest-count line', async () => {
    useAuthAs({ memberId: null, pta: { householdAdultId: 'adult-1' }, capability: { rsvp: { mode: 'household', guestCounts: true, canRsvp: true } } });
    mockGetEventsForOrganization.mockResolvedValue([
      eventWithRsvp(householdBlock({ status: 'GOING', attendeeCount: 2 }), { myRsvp: { status: 'GOING', attendeeCount: 2 }, volunteerOpportunities: [] }),
    ]);

    await render(<EventDetailScreen />);

    await waitFor(() => expect(screen.getByText('Family Movie Night')).toBeTruthy());
    expect(screen.getByLabelText('Going').props.accessibilityState?.selected).toBe(true);
    expect(screen.getByLabelText('Maybe').props.accessibilityState?.selected).toBe(false);
    expect(screen.getByText(/2 attendees from your household/)).toBeTruthy();
  });

  it('PTA household: a status change goes to the household endpoint and PRESERVES the existing attendee count', async () => {
    useAuthAs({ memberId: null, pta: { householdAdultId: 'adult-1' }, capability: { rsvp: { mode: 'household', guestCounts: true, canRsvp: true } } });
    mockGetEventsForOrganization.mockResolvedValue([
      eventWithRsvp(householdBlock({ status: 'GOING', attendeeCount: 3 }), { myRsvp: { status: 'GOING', attendeeCount: 3 }, volunteerOpportunities: [] }),
    ]);
    mockSetPtaEventRsvp.mockResolvedValue({ status: 'MAYBE', attendeeCount: 3 });

    await render(<EventDetailScreen />);
    await waitFor(() => expect(screen.getByText('Family Movie Night')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Maybe'));

    expect(mockSetPtaEventRsvp).toHaveBeenCalledWith('org-1', 'event-1', 'MAYBE', 3);
    expect(mockSetEventRsvp).not.toHaveBeenCalled();
  });

  it('Community member: shows the radio group WITHOUT the household line and submits via the generic endpoint', async () => {
    useAuthAs({ memberId: 'member-1', pta: null, capability: { rsvp: { mode: 'individual', guestCounts: false, canRsvp: true } } });
    mockGetEventsForOrganization.mockResolvedValue([eventWithRsvp(individualBlock(null))]);
    mockSetEventRsvp.mockResolvedValue(individualBlock({ status: 'GOING', attendeeCount: 1 }));

    await render(<EventDetailScreen />);
    await waitFor(() => expect(screen.getByText('Family Movie Night')).toBeTruthy());

    expect(screen.queryByText(/from your household/)).toBeNull();

    await fireEvent.press(screen.getByLabelText('Going'));

    expect(mockSetEventRsvp).toHaveBeenCalledWith('org-1', 'event-1', 'GOING');
    expect(mockSetPtaEventRsvp).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText('Going').props.accessibilityState?.selected).toBe(true));
  });

  it('shows RSVP for a generic (non-PTA-shaped) event purely from its rsvp block — no myRsvp field needed', async () => {
    useAuthAs({ memberId: 'member-1', pta: null, capability: { rsvp: { mode: 'individual', guestCounts: false, canRsvp: true } } });
    // Deliberately NO myRsvp and NO volunteerOpportunities: under the retired
    // `'myRsvp' in event` discrimination this event would have shown no RSVP
    // UI at all.
    mockGetEventsForOrganization.mockResolvedValue([eventWithRsvp(individualBlock({ status: 'MAYBE', attendeeCount: 1 }))]);

    await render(<EventDetailScreen />);

    await waitFor(() => expect(screen.getByLabelText('Maybe').props.accessibilityState?.selected).toBe(true));
  });

  it('HOA: no RSVP UI (mode none)', async () => {
    useAuthAs({ memberId: 'member-1', pta: null, capability: { rsvp: { mode: 'none', guestCounts: false, canRsvp: false } } });
    mockGetEventsForOrganization.mockResolvedValue([
      eventWithRsvp({ mode: 'none', canRsvp: false, guestCounts: false, response: null, subject: { type: 'none', id: null } }),
    ]);

    await render(<EventDetailScreen />);

    await waitFor(() => expect(screen.getByText('Family Movie Night')).toBeTruthy());
    expect(screen.queryByLabelText('RSVP status')).toBeNull();
  });

  it('staff-only (canRsvp false): the event renders but no RSVP UI is offered', async () => {
    useAuthAs({ memberId: null, pta: null, capability: { rsvp: { mode: 'individual', guestCounts: false, canRsvp: false } } });
    mockGetEventsForOrganization.mockResolvedValue([
      eventWithRsvp({ mode: 'individual', canRsvp: false, guestCounts: false, response: null, subject: { type: 'none', id: null } }),
    ]);

    await render(<EventDetailScreen />);

    await waitFor(() => expect(screen.getByText('Family Movie Night')).toBeTruthy());
    expect(screen.queryByLabelText('RSVP status')).toBeNull();
  });

  it('an event with no rsvp block at all (pre-RSVP server) safely shows no RSVP UI', async () => {
    useAuthAs({ memberId: 'member-1', pta: null, capability: undefined });
    mockGetEventsForOrganization.mockResolvedValue([eventWithRsvp(undefined)]);

    await render(<EventDetailScreen />);

    await waitFor(() => expect(screen.getByText('Family Movie Night')).toBeTruthy());
    expect(screen.queryByLabelText('RSVP status')).toBeNull();
  });
});
