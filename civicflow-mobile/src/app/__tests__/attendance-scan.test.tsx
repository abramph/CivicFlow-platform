import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import AttendanceScanScreen from '../attendance-scan';

/** Regression coverage for direct native camera permission requests and recovery. */

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({ useAuth: () => mockUseAuth() }));

const mockUseCameraPermissions = jest.fn();
const mockRequestPermission = jest.fn();
jest.mock('expo-camera', () => ({
  useCameraPermissions: () => mockUseCameraPermissions(),
  CameraView: () => null,
}));

jest.mock('@/lib/mobile-api', () => ({
  checkInWithQrToken: jest.fn(),
}));

const mockRouterReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockRouterReplace(...args) },
  Redirect: () => null,
}));

function permission(overrides: Partial<{ granted: boolean; canAskAgain: boolean }>) {
  return { granted: false, canAskAgain: true, status: 'undetermined', expires: 'never', ...overrides };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseAuth.mockReturnValue({ status: 'signedIn', selectedOrganization: { memberId: 'member-1' } });
  mockUseCameraPermissions.mockReturnValue([permission({ canAskAgain: true }), mockRequestPermission]);
});

describe('AttendanceScanScreen -- identity gate (Build 27)', () => {
  it('a PTA parent with no OrgMember reaches the scanner — household check-in is a real identity', async () => {
    mockUseAuth.mockReturnValue({
      status: 'signedIn',
      selectedOrganization: { memberId: null, pta: { householdAdultId: 'adult-1', isOfficer: false, canCheckIn: false, canApproveHours: false } },
    });
    await render(<AttendanceScanScreen />);
    // The permission recovery UI renders — i.e. we made it past the gate.
    expect(screen.getByText('Camera Permission Needed')).toBeTruthy();
  });

  it('an admin/officer-only login gets a clear unauthorized state, never a doomed scanner', async () => {
    mockUseAuth.mockReturnValue({
      status: 'signedIn',
      selectedOrganization: {
        memberId: null,
        pta: { householdAdultId: null, isOfficer: true, canCheckIn: true, canApproveHours: true },
        capability: { adminCapabilities: ['adminDashboard'] },
      },
    });
    await render(<AttendanceScanScreen />);
    expect(screen.queryByText('Camera Permission Needed')).toBeNull();
    expect(screen.getByText("Check-in records attendance for a member or family record, and your login doesn't have one in this organization.")).toBeTruthy();
  });

  it('a constituent member still reaches the scanner exactly as before', async () => {
    await render(<AttendanceScanScreen />);
    expect(screen.getByText('Camera Permission Needed')).toBeTruthy();
  });
});

describe('AttendanceScanScreen -- native camera permission', () => {
  it('requests the native permission on entering the scanner', async () => {
    await act(async () => {
      render(<AttendanceScanScreen />);
    });
    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Continue')).toBeNull();
    expect(screen.queryByLabelText('Not Now')).toBeNull();
  });

  it('allows retry after permission is denied', async () => {
    await act(async () => {
      render(<AttendanceScanScreen />);
    });
    expect(screen.getByText('Camera Permission Needed')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Try Again'));
    });
    expect(mockRequestPermission).toHaveBeenCalledTimes(2);
  });

  it('can return to the dashboard after denial', async () => {
    await act(async () => {
      render(<AttendanceScanScreen />);
    });
    fireEvent.press(screen.getByLabelText('Back to Dashboard'));
    expect(mockRouterReplace).toHaveBeenCalledWith('/dashboard');
  });

  it('shows a distinct, neutral blocked state when permission was already denied and cannot be re-asked', async () => {
    mockUseCameraPermissions.mockReturnValue([permission({ canAskAgain: false }), mockRequestPermission]);
    await render(<AttendanceScanScreen />);
    expect(screen.getByText('Camera Access Is Off')).toBeTruthy();
    expect(screen.queryByLabelText('Continue')).toBeNull();
    expect(screen.getByLabelText('Open Settings')).toBeTruthy();
  });

  it('Open Settings actually opens Settings -- the previous version only re-called the no-op requestPermission', async () => {
    mockUseCameraPermissions.mockReturnValue([permission({ canAskAgain: false }), mockRequestPermission]);
    const openSettingsSpy = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    await render(<AttendanceScanScreen />);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Open Settings'));
    });
    expect(openSettingsSpy).toHaveBeenCalledTimes(1);
    expect(mockRequestPermission).not.toHaveBeenCalled();
  });

  it('skips permission recovery UI once permission is granted', async () => {
    mockUseCameraPermissions.mockReturnValue([permission({ granted: true }), mockRequestPermission]);
    await render(<AttendanceScanScreen />);
    expect(screen.queryByText('Camera Permission Needed')).toBeNull();
    expect(screen.getByText('Point your camera at the meeting QR code')).toBeTruthy();
  });
});
