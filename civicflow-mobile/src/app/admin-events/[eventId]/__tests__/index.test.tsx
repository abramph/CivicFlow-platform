import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import AdminEventDetailScreen from '../index';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  useLocalSearchParams: () => ({ eventId: 'evt-1' }),
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

const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
  buttons?.[buttons.length - 1]?.onPress?.();
});

function authWith(adminCapabilities: string[]) {
  return {
    selectedOrganizationId: 'org-a',
    selectedOrganization: { organizationName: 'Sample Org', capability: { adminCapabilities } },
  };
}

function event(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'evt-1',
    organizationId: 'org-a',
    title: 'Fall Festival',
    description: null,
    location: null,
    startAt: null,
    endAt: null,
    status: 'upcoming',
    notes: null,
    ...overrides,
  };
}

describe('Admin event detail screen', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockGetAdminEvent.mockReset();
    mockUpdateAdminEvent.mockReset();
    alertSpy.mockClear();
  });

  it('shows a denial state and never fetches without manageEvents', async () => {
    mockUseAuth.mockReturnValue(authWith([]));

    await render(<AdminEventDetailScreen />);

    await waitFor(() =>
      expect(screen.getByText("You don't have event administration access for this organization.")).toBeTruthy()
    );
    expect(mockGetAdminEvent).not.toHaveBeenCalled();
  });

  it('re-fetches by eventId + organization', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageEvents']));
    mockGetAdminEvent.mockResolvedValueOnce(event());

    await render(<AdminEventDetailScreen />);

    await waitFor(() => expect(mockGetAdminEvent).toHaveBeenCalledWith('org-a', 'evt-1'));
    expect(screen.getByText('Fall Festival')).toBeTruthy();
  });

  it('shows the Manage Check-In / Attendance button only with manageAttendance', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageEvents']));
    mockGetAdminEvent.mockResolvedValueOnce(event());

    await render(<AdminEventDetailScreen />);
    await waitFor(() => expect(screen.getByText('Fall Festival')).toBeTruthy());

    expect(screen.queryByLabelText('Manage attendance')).toBeNull();
  });

  it('shows the attendance button when manageAttendance is also held', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageEvents', 'manageAttendance']));
    mockGetAdminEvent.mockResolvedValueOnce(event());

    await render(<AdminEventDetailScreen />);
    await waitFor(() => expect(screen.getByLabelText('Manage attendance')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Manage attendance'));
    expect(mockPush).toHaveBeenCalledWith('/admin-events/evt-1/attendance-session');
  });

  it('hides the Cancel Event button for an already-cancelled event', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageEvents']));
    mockGetAdminEvent.mockResolvedValueOnce(event({ status: 'cancelled' }));

    await render(<AdminEventDetailScreen />);
    await waitFor(() => expect(screen.getByText('Fall Festival')).toBeTruthy());

    expect(screen.queryByLabelText('Cancel event')).toBeNull();
  });

  it('cancels the event via the confirmation flow', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageEvents']));
    mockGetAdminEvent.mockResolvedValueOnce(event({ status: 'upcoming' }));
    mockGetAdminEvent.mockResolvedValueOnce(event({ status: 'cancelled' }));
    mockUpdateAdminEvent.mockResolvedValueOnce(event({ status: 'cancelled' }));

    await render(<AdminEventDetailScreen />);
    await waitFor(() => expect(screen.getByLabelText('Cancel event')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Cancel event'));

    await waitFor(() =>
      expect(mockUpdateAdminEvent).toHaveBeenCalledWith('evt-1', { organizationId: 'org-a', status: 'cancelled' })
    );
  });
});
