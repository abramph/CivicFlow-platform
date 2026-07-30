import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import VolunteerOpportunityDetailScreen from '../[id]';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'opp-1' }),
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetPtaVolunteerOpportunity = jest.fn();
const mockClaimPtaVolunteerSlot = jest.fn();
const mockCancelPtaVolunteerSlot = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getPtaVolunteerOpportunity: (...args: unknown[]) => mockGetPtaVolunteerOpportunity(...args),
  claimPtaVolunteerSlot: (...args: unknown[]) => mockClaimPtaVolunteerSlot(...args),
  cancelPtaVolunteerSlot: (...args: unknown[]) => mockCancelPtaVolunteerSlot(...args),
}));

jest.mock('react-native/Libraries/Alert/Alert', () => ({ alert: jest.fn() }));

function opportunity(slot: Partial<{ mySignup: { status: string } | null; full: boolean; claimedCount: number; capacity: number }>) {
  return {
    id: 'opp-1',
    title: 'Picture Day Helpers',
    description: null,
    instructions: null,
    signupDeadline: null,
    cancellationDeadline: null,
    slots: [
      {
        id: 'slot-1',
        label: 'Morning shift',
        startAt: null,
        endAt: null,
        locationOverride: null,
        claimedCount: slot.claimedCount ?? 1,
        capacity: slot.capacity ?? 3,
        full: slot.full ?? false,
        mySignup: slot.mySignup ?? null,
      },
    ],
  };
}

describe('Volunteer opportunity signup and cancellation', () => {
  beforeEach(() => {
    mockGetPtaVolunteerOpportunity.mockReset();
    mockClaimPtaVolunteerSlot.mockReset();
    mockCancelPtaVolunteerSlot.mockReset();
    mockUseAuth.mockReturnValue({ selectedOrganizationId: 'org-pta' });
  });

  it('lets a parent claim an open shift', async () => {
    mockGetPtaVolunteerOpportunity.mockResolvedValue(opportunity({ mySignup: null, full: false }));
    mockClaimPtaVolunteerSlot.mockResolvedValue({});

    await render(<VolunteerOpportunityDetailScreen />);
    await waitFor(() => expect(screen.getByText('Picture Day Helpers')).toBeTruthy());

    const claimButton = screen.getByLabelText('Claim Morning shift');
    await fireEvent.press(claimButton);

    expect(mockClaimPtaVolunteerSlot).toHaveBeenCalledWith('org-pta', 'slot-1');
  });

  it('shows a disabled "full" state instead of a claim button when the shift has no capacity left', async () => {
    mockGetPtaVolunteerOpportunity.mockResolvedValue(opportunity({ mySignup: null, full: true, claimedCount: 3, capacity: 3 }));

    await render(<VolunteerOpportunityDetailScreen />);
    await waitFor(() => expect(screen.getByText('Picture Day Helpers')).toBeTruthy());

    const fullButton = screen.getByLabelText('Morning shift, full');
    expect(fullButton.props.accessibilityState?.disabled).toBe(true);
  });

  it('lets a parent cancel an existing signup', async () => {
    mockGetPtaVolunteerOpportunity.mockResolvedValue(opportunity({ mySignup: { status: 'SIGNED_UP' } }));
    mockCancelPtaVolunteerSlot.mockResolvedValue({});

    await render(<VolunteerOpportunityDetailScreen />);
    await waitFor(() => expect(screen.getByText('Picture Day Helpers')).toBeTruthy());

    const cancelButton = screen.getByLabelText('Cancel signup for Morning shift');
    await fireEvent.press(cancelButton);

    expect(mockCancelPtaVolunteerSlot).toHaveBeenCalledWith('org-pta', 'slot-1');
  });
});
