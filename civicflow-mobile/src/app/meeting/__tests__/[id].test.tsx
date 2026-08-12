import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import MeetingDetailScreen from '../[id]';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'meeting-1' }),
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetMeetingsForOrganization = jest.fn();
const mockSetPtaMeetingRsvp = jest.fn();
const mockSetMeetingRsvp = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getMeetingsForOrganization: (...args: unknown[]) => mockGetMeetingsForOrganization(...args),
  setPtaMeetingRsvp: (...args: unknown[]) => mockSetPtaMeetingRsvp(...args),
  setMeetingRsvp: (...args: unknown[]) => mockSetMeetingRsvp(...args),
}));

type RsvpBlock = {
  mode: 'household' | 'individual' | 'none';
  canRsvp: boolean;
  guestCounts: boolean;
  response: { status: string; attendeeCount: number } | null;
  subject: { type: 'household' | 'member' | 'none'; id: string | null };
};

function meetingWithRsvp(rsvp: RsvpBlock | undefined) {
  return {
    id: 'meeting-1',
    title: 'General Meeting',
    meetingType: 'General',
    meetingDate: '2026-09-01T18:00:00.000Z',
    location: 'Union Hall',
    description: null,
    rsvp,
  };
}

function useAuthAs(organization: Record<string, unknown>) {
  mockUseAuth.mockReturnValue({ selectedOrganization: organization, selectedOrganizationId: 'org-1' });
}

describe('Meeting detail RSVP — shared capability-driven contract', () => {
  beforeEach(() => {
    mockGetMeetingsForOrganization.mockReset();
    mockSetPtaMeetingRsvp.mockReset();
    mockSetMeetingRsvp.mockReset();
  });

  it('Community/Union member: individual RSVP submits via the generic meeting endpoint', async () => {
    useAuthAs({ memberId: 'member-1', pta: null, capability: { rsvp: { mode: 'individual', guestCounts: false, canRsvp: true } } });
    mockGetMeetingsForOrganization.mockResolvedValue([
      meetingWithRsvp({ mode: 'individual', canRsvp: true, guestCounts: false, response: null, subject: { type: 'member', id: 'member-1' } }),
    ]);
    mockSetMeetingRsvp.mockResolvedValue({ mode: 'individual', canRsvp: true, guestCounts: false, response: { status: 'GOING', attendeeCount: 1 }, subject: { type: 'member', id: 'member-1' } });

    await render(<MeetingDetailScreen />);
    await waitFor(() => expect(screen.getByText('General Meeting')).toBeTruthy());
    expect(screen.queryByText(/from your household/)).toBeNull();

    await fireEvent.press(screen.getByLabelText('Going'));

    expect(mockSetMeetingRsvp).toHaveBeenCalledWith('org-1', 'meeting-1', 'GOING');
    expect(mockSetPtaMeetingRsvp).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText('Going').props.accessibilityState?.selected).toBe(true));
  });

  it('PTA household: submits via the household endpoint preserving the attendee count', async () => {
    useAuthAs({ memberId: null, pta: { householdAdultId: 'adult-1' }, capability: { rsvp: { mode: 'household', guestCounts: true, canRsvp: true } } });
    mockGetMeetingsForOrganization.mockResolvedValue([
      meetingWithRsvp({ mode: 'household', canRsvp: true, guestCounts: true, response: { status: 'GOING', attendeeCount: 4 }, subject: { type: 'household', id: 'household-1' } }),
    ]);
    mockSetPtaMeetingRsvp.mockResolvedValue({ status: 'MAYBE', attendeeCount: 4 });

    await render(<MeetingDetailScreen />);
    await waitFor(() => expect(screen.getByLabelText('4 attendees')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Maybe'));

    expect(mockSetPtaMeetingRsvp).toHaveBeenCalledWith('org-1', 'meeting-1', 'MAYBE', 4);
    expect(mockSetMeetingRsvp).not.toHaveBeenCalled();
  });

  it('PTA household GOING: head-count stepper adjusts the count via the household endpoint (min 1)', async () => {
    useAuthAs({ memberId: null, pta: { householdAdultId: 'adult-1' }, capability: { rsvp: { mode: 'household', guestCounts: true, canRsvp: true } } });
    mockGetMeetingsForOrganization.mockResolvedValue([
      meetingWithRsvp({ mode: 'household', canRsvp: true, guestCounts: true, response: { status: 'GOING', attendeeCount: 2 }, subject: { type: 'household', id: 'household-1' } }),
    ]);
    mockSetPtaMeetingRsvp.mockResolvedValue({ status: 'GOING', attendeeCount: 3 });

    await render(<MeetingDetailScreen />);
    await waitFor(() => expect(screen.getByText(/How many people from your household/)).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Increase attendee count'));

    expect(mockSetPtaMeetingRsvp).toHaveBeenCalledWith('org-1', 'meeting-1', 'GOING', 3);
    await waitFor(() => expect(screen.getByLabelText('3 attendees')).toBeTruthy());
  });

  it('PTA household NOT_GOING: no stepper is offered (0 attendees is implied server-side)', async () => {
    useAuthAs({ memberId: null, pta: { householdAdultId: 'adult-1' }, capability: { rsvp: { mode: 'household', guestCounts: true, canRsvp: true } } });
    mockGetMeetingsForOrganization.mockResolvedValue([
      meetingWithRsvp({ mode: 'household', canRsvp: true, guestCounts: true, response: { status: 'NOT_GOING', attendeeCount: 0 }, subject: { type: 'household', id: 'household-1' } }),
    ]);

    await render(<MeetingDetailScreen />);

    await waitFor(() => expect(screen.getByText('General Meeting')).toBeTruthy());
    expect(screen.queryByText(/How many people from your household/)).toBeNull();
  });

  it('individual mode never shows the head-count stepper', async () => {
    useAuthAs({ memberId: 'member-1', pta: null, capability: { rsvp: { mode: 'individual', guestCounts: false, canRsvp: true } } });
    mockGetMeetingsForOrganization.mockResolvedValue([
      meetingWithRsvp({ mode: 'individual', canRsvp: true, guestCounts: false, response: { status: 'GOING', attendeeCount: 1 }, subject: { type: 'member', id: 'member-1' } }),
    ]);

    await render(<MeetingDetailScreen />);

    await waitFor(() => expect(screen.getByText('General Meeting')).toBeTruthy());
    expect(screen.queryByText(/How many people from your household/)).toBeNull();
  });

  it('HOA (mode none) and staff-only (canRsvp false): meeting renders with no RSVP UI', async () => {
    useAuthAs({ memberId: 'member-1', pta: null, capability: { rsvp: { mode: 'none', guestCounts: false, canRsvp: false } } });
    mockGetMeetingsForOrganization.mockResolvedValue([
      meetingWithRsvp({ mode: 'none', canRsvp: false, guestCounts: false, response: null, subject: { type: 'none', id: null } }),
    ]);

    await render(<MeetingDetailScreen />);

    await waitFor(() => expect(screen.getByText('General Meeting')).toBeTruthy());
    expect(screen.queryByLabelText('RSVP status')).toBeNull();
  });

  it('a meeting with no rsvp block at all safely shows no RSVP UI', async () => {
    useAuthAs({ memberId: 'member-1', pta: null, capability: undefined });
    mockGetMeetingsForOrganization.mockResolvedValue([meetingWithRsvp(undefined)]);

    await render(<MeetingDetailScreen />);

    await waitFor(() => expect(screen.getByText('General Meeting')).toBeTruthy());
    expect(screen.queryByLabelText('RSVP status')).toBeNull();
  });
});
