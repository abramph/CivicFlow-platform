import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import AdminEventAttendanceSessionScreen from '../attendance-session';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ eventId: 'evt-1' }),
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetSession = jest.fn();
const mockCreateSession = jest.fn();
const mockOpenSession = jest.fn();
const mockCloseSession = jest.fn();
const mockRegenerateSession = jest.fn();
const mockGetQr = jest.fn();
const mockGetSummary = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getAdminEventAttendanceSession: (...args: unknown[]) => mockGetSession(...args),
  createAdminEventAttendanceSession: (...args: unknown[]) => mockCreateSession(...args),
  openAdminAttendanceSession: (...args: unknown[]) => mockOpenSession(...args),
  closeAdminAttendanceSession: (...args: unknown[]) => mockCloseSession(...args),
  regenerateAdminAttendanceSession: (...args: unknown[]) => mockRegenerateSession(...args),
  getAdminAttendanceSessionQr: (...args: unknown[]) => mockGetQr(...args),
  getAdminAttendanceSessionSummary: (...args: unknown[]) => mockGetSummary(...args),
}));

const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
  buttons?.[buttons.length - 1]?.onPress?.();
});

beforeEach(() => {
  mockGetSession.mockReset();
  mockCreateSession.mockReset();
  mockOpenSession.mockReset();
  mockCloseSession.mockReset();
  mockRegenerateSession.mockReset();
  mockGetQr.mockReset();
  mockGetSummary.mockReset();
  alertSpy.mockClear();
  mockUseAuth.mockReturnValue({ selectedOrganizationId: 'org-a' });
});

describe('Admin attendance session screen', () => {
  it('shows Start Check-In Session when no session exists yet', async () => {
    mockGetSession.mockResolvedValueOnce(null);

    await render(<AdminEventAttendanceSessionScreen />);

    await waitFor(() => expect(screen.getByLabelText('Start check-in session')).toBeTruthy());
  });

  it('creates a session when Start is tapped', async () => {
    mockGetSession.mockResolvedValueOnce(null);
    mockCreateSession.mockResolvedValueOnce({ id: 'session-1', status: 'DRAFT', eventId: 'evt-1', meetingId: null, mode: 'ROTATING_QR', rotationSeconds: 30, lateThresholdMinutes: 10, tokenVersion: 1, organizationId: 'org-a' });

    await render(<AdminEventAttendanceSessionScreen />);
    await waitFor(() => expect(screen.getByLabelText('Start check-in session')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Start check-in session'));

    expect(mockCreateSession).toHaveBeenCalledWith('org-a', 'evt-1');
    await waitFor(() => expect(screen.getByLabelText('Open session and display QR code')).toBeTruthy());
  });

  it('opens a DRAFT session and displays the QR code', async () => {
    mockGetSession.mockResolvedValueOnce({ id: 'session-1', status: 'DRAFT', eventId: 'evt-1', meetingId: null, mode: 'ROTATING_QR', rotationSeconds: 30, lateThresholdMinutes: 10, tokenVersion: 1, organizationId: 'org-a' });
    mockOpenSession.mockResolvedValueOnce({ id: 'session-1', status: 'OPEN', eventId: 'evt-1', meetingId: null, mode: 'ROTATING_QR', rotationSeconds: 30, lateThresholdMinutes: 10, tokenVersion: 1, organizationId: 'org-a' });
    mockGetQr.mockResolvedValue({ checkInUrl: 'https://app.test/attendance/check-in?token=x', qrDataUrl: 'data:image/png;base64,abc', mode: 'ROTATING_QR', rotationSeconds: 30, secondsRemainingInSlot: 20, slot: 1 });
    mockGetSummary.mockResolvedValue({ status: 'OPEN', eligibleCount: 10, checkedInCount: 3, counts: { PRESENT: 3, LATE: 0, EXCUSED: 0, ABSENT: 0, VIRTUAL: 0 }, attendancePercent: 30 });

    await render(<AdminEventAttendanceSessionScreen />);
    await waitFor(() => expect(screen.getByLabelText('Open session and display QR code')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Open session and display QR code'));

    await waitFor(() => expect(screen.getByLabelText('Check-in QR code')).toBeTruthy());
    expect(screen.getByText('3 of 10 checked in (30%)')).toBeTruthy();
  });

  it('closes an OPEN session via the confirmation flow', async () => {
    mockGetSession.mockResolvedValueOnce({ id: 'session-1', status: 'OPEN', eventId: 'evt-1', meetingId: null, mode: 'ROTATING_QR', rotationSeconds: 30, lateThresholdMinutes: 10, tokenVersion: 1, organizationId: 'org-a' });
    mockGetQr.mockResolvedValue({ checkInUrl: 'https://app.test/attendance/check-in?token=x', qrDataUrl: 'data:image/png;base64,abc', mode: 'ROTATING_QR', rotationSeconds: 30, secondsRemainingInSlot: 20, slot: 1 });
    mockGetSummary.mockResolvedValue({ status: 'OPEN', eligibleCount: 10, checkedInCount: 0, counts: { PRESENT: 0, LATE: 0, EXCUSED: 0, ABSENT: 0, VIRTUAL: 0 }, attendancePercent: 0 });
    mockCloseSession.mockResolvedValueOnce({ id: 'session-1', status: 'CLOSED', eventId: 'evt-1', meetingId: null, mode: 'ROTATING_QR', rotationSeconds: 30, lateThresholdMinutes: 10, tokenVersion: 1, organizationId: 'org-a' });

    await render(<AdminEventAttendanceSessionScreen />);
    await waitFor(() => expect(screen.getByLabelText('Close session')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Close session'));

    await waitFor(() => expect(mockCloseSession).toHaveBeenCalledWith('org-a', 'session-1'));
    await waitFor(() => expect(screen.getByText('This session is closed.')).toBeTruthy());
  });

  it('shows a closed message with no QR and no reopen action', async () => {
    mockGetSession.mockResolvedValueOnce({ id: 'session-1', status: 'CLOSED', eventId: 'evt-1', meetingId: null, mode: 'ROTATING_QR', rotationSeconds: 30, lateThresholdMinutes: 10, tokenVersion: 1, organizationId: 'org-a' });

    await render(<AdminEventAttendanceSessionScreen />);

    await waitFor(() => expect(screen.getByText('This session is closed.')).toBeTruthy());
    expect(screen.queryByLabelText('Check-in QR code')).toBeNull();
    expect(screen.queryByText(/reopen/i)).toBeNull();
  });
});
