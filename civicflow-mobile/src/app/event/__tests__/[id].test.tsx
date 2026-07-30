import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import EventDetailScreen from '../[id]';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'event-1' }),
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetEventsForIdentity = jest.fn();
const mockSetPtaEventRsvp = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getEventsForIdentity: (...args: unknown[]) => mockGetEventsForIdentity(...args),
  setPtaEventRsvp: (...args: unknown[]) => mockSetPtaEventRsvp(...args),
}));

function ptaEvent(myRsvp: { status: string; attendeeCount: number } | null) {
  return {
    id: 'event-1',
    title: 'Family Movie Night',
    startAt: '2026-09-10T18:00:00.000Z',
    endAt: null,
    location: 'Cafeteria',
    description: null,
    myRsvp,
    volunteerOpportunities: [],
  };
}

describe('Event detail RSVP', () => {
  beforeEach(() => {
    mockGetEventsForIdentity.mockReset();
    mockSetPtaEventRsvp.mockReset();
    mockUseAuth.mockReturnValue({
      selectedOrganization: { memberId: null, pta: { householdAdultId: 'adult-1' } },
      selectedOrganizationId: 'org-pta',
    });
  });

  it('renders the RSVP options as a radio group with the current selection marked', async () => {
    mockGetEventsForIdentity.mockResolvedValue([ptaEvent({ status: 'GOING', attendeeCount: 2 })]);

    await render(<EventDetailScreen />);

    await waitFor(() => expect(screen.getByText('Family Movie Night')).toBeTruthy());
    const goingOption = screen.getByLabelText('Going');
    expect(goingOption.props.accessibilityState?.selected).toBe(true);
    expect(screen.getByLabelText('Maybe').props.accessibilityState?.selected).toBe(false);
    expect(screen.getByText(/2 attendees from your household/)).toBeTruthy();
  });

  it('submits a new RSVP status when a different option is tapped', async () => {
    mockGetEventsForIdentity.mockResolvedValue([ptaEvent({ status: 'GOING', attendeeCount: 1 })]);
    mockSetPtaEventRsvp.mockResolvedValue({ status: 'MAYBE', attendeeCount: 1 });

    await render(<EventDetailScreen />);
    await waitFor(() => expect(screen.getByText('Family Movie Night')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Maybe'));

    expect(mockSetPtaEventRsvp).toHaveBeenCalledWith('org-pta', 'event-1', 'MAYBE');
  });
});
