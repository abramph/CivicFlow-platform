import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import VolunteerCheckinRosterScreen from '../[opportunityId]';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ opportunityId: 'opp-1' }),
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetPtaVolunteerRoster = jest.fn();
const mockCheckInPtaVolunteer = jest.fn();
const mockCheckOutPtaVolunteer = jest.fn();
const mockSetPtaVolunteerAttendance = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getPtaVolunteerRoster: (...args: unknown[]) => mockGetPtaVolunteerRoster(...args),
  checkInPtaVolunteer: (...args: unknown[]) => mockCheckInPtaVolunteer(...args),
  checkOutPtaVolunteer: (...args: unknown[]) => mockCheckOutPtaVolunteer(...args),
  setPtaVolunteerAttendance: (...args: unknown[]) => mockSetPtaVolunteerAttendance(...args),
}));

jest.mock('react-native/Libraries/Alert/Alert', () => ({ alert: jest.fn() }));

function roster(signup: Partial<{ checkInAt: string | null; checkOutAt: string | null; attendanceStatus: string | null }>) {
  return {
    id: 'opp-1',
    title: 'Picture Day Helpers',
    slots: [
      {
        id: 'slot-1',
        label: 'Morning shift',
        claimedCount: 1,
        capacity: 3,
        signups: [
          {
            signupId: 'signup-1',
            name: 'Casey Kim',
            status: 'SIGNED_UP',
            manuallyAssigned: false,
            checkInAt: signup.checkInAt ?? null,
            checkOutAt: signup.checkOutAt ?? null,
            attendanceStatus: signup.attendanceStatus ?? null,
            pendingHourEntry: null,
          },
        ],
      },
    ],
  };
}

describe('Volunteer check-in roster', () => {
  beforeEach(() => {
    mockGetPtaVolunteerRoster.mockReset();
    mockCheckInPtaVolunteer.mockReset();
    mockCheckOutPtaVolunteer.mockReset();
    mockSetPtaVolunteerAttendance.mockReset();
    mockUseAuth.mockReturnValue({ selectedOrganizationId: 'org-pta' });
  });

  it('shows a check-in button for a volunteer who has not checked in yet', async () => {
    mockGetPtaVolunteerRoster.mockResolvedValue(roster({}));
    mockCheckInPtaVolunteer.mockResolvedValue({});

    await render(<VolunteerCheckinRosterScreen />);
    await waitFor(() => expect(screen.getByText('Casey Kim')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Check in Casey Kim'));

    expect(mockCheckInPtaVolunteer).toHaveBeenCalledWith('org-pta', 'signup-1');
  });

  it('shows a check-out button once checked in, and marks attendance after that', async () => {
    mockGetPtaVolunteerRoster.mockResolvedValue(roster({ checkInAt: '2026-09-10T09:00:00.000Z' }));
    mockCheckOutPtaVolunteer.mockResolvedValue({});

    await render(<VolunteerCheckinRosterScreen />);
    await waitFor(() => expect(screen.getByText('Casey Kim')).toBeTruthy());

    expect(screen.queryByLabelText('Check in Casey Kim')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Check out Casey Kim'));

    expect(mockCheckOutPtaVolunteer).toHaveBeenCalledWith('org-pta', 'signup-1');
  });

  it('shows "Checked out" text and no attendance controls once attendance is already recorded', async () => {
    mockGetPtaVolunteerRoster.mockResolvedValue(
      roster({ checkInAt: '2026-09-10T09:00:00.000Z', checkOutAt: '2026-09-10T12:00:00.000Z', attendanceStatus: 'ATTENDED' })
    );

    await render(<VolunteerCheckinRosterScreen />);
    await waitFor(() => expect(screen.getByText('Checked out')).toBeTruthy());

    expect(screen.queryByLabelText('Mark Casey Kim attended')).toBeNull();
  });
});
