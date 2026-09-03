import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import AttendanceScanScreen from '../attendance-scan';

/**
 * build-26 Phase I -- Apple Guideline 5.1.1(iv) correction. This screen had
 * no test coverage before this pass. Covers: neutral pre-permission copy
 * (a standing regression guard against directive wording like "Grant
 * Camera Access" ever creeping back in), the real bug where the
 * "Open Settings" label previously did nothing (button's onPress was
 * always requestPermission, a no-op once canAskAgain is false) --
 * now fixed to call Linking.openSettings() -- and that requestPermission
 * is never called until the user actively taps Continue.
 */

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

describe('AttendanceScanScreen -- camera permission priming', () => {
  it('shows neutral copy, not a directive command, before permission is granted', async () => {
    await render(<AttendanceScanScreen />);
    expect(screen.getByText('Use Your Camera')).toBeTruthy();
    expect(screen.getByLabelText('Continue')).toBeTruthy();
    expect(screen.getByLabelText('Not Now')).toBeTruthy();

    const banned = ['Grant', 'Allow Access', 'Enable Camera', 'You Must Allow'];
    const tree = JSON.stringify(screen.toJSON());
    for (const phrase of banned) {
      expect(tree).not.toContain(phrase);
    }
  });

  it('does not call requestPermission until Continue is tapped', async () => {
    await render(<AttendanceScanScreen />);
    expect(mockRequestPermission).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Continue'));
    });
    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
  });

  it('Not Now leaves without requesting permission', async () => {
    await render(<AttendanceScanScreen />);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Not Now'));
    });
    expect(mockRequestPermission).not.toHaveBeenCalled();
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

  it('skips the priming screen entirely once permission is granted', async () => {
    mockUseCameraPermissions.mockReturnValue([permission({ granted: true }), mockRequestPermission]);
    await render(<AttendanceScanScreen />);
    expect(screen.queryByText('Use Your Camera')).toBeNull();
    expect(screen.getByText('Point your camera at the meeting QR code')).toBeTruthy();
  });
});
