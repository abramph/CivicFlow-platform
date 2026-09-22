import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import AttendanceScanScreen from '../attendance-scan';

/**
 * Apple Guideline 5.1.1(iv) remediation. Apple rejected the previous custom
 * pre-permission interstitial ("Use Your Camera" with Continue / Not Now)
 * because it let the user dismiss the explanation without ever reaching the
 * native permission request. The corrected contract, covered state by state
 * here:
 *
 *  - undetermined: entering the screen (the user's intentional "Scan QR"
 *    tap) immediately fires the native system request — exactly once, with
 *    no custom interstitial before it, ever.
 *  - authorized: the scanner opens directly, no permission UI at all.
 *  - denied / restricted: an informational screen with a working
 *    "Open Settings" action (expo-camera surfaces both iOS states
 *    identically: granted:false + canAskAgain:false). A Back action is
 *    allowed in this state only.
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

function permission(overrides: Partial<{ granted: boolean; canAskAgain: boolean; status: string }>) {
  return { granted: false, canAskAgain: true, status: 'undetermined', expires: 'never', ...overrides };
}

/** Simulates the user answering the native dialog: the real
 * useCameraPermissions hook re-renders with the new state when its
 * requestPermission resolves, so the mock flips the hook's return value
 * before resolving. */
function answerNativePromptWith(response: ReturnType<typeof permission>) {
  mockRequestPermission.mockImplementation(async () => {
    mockUseCameraPermissions.mockReturnValue([response, mockRequestPermission]);
    return response;
  });
}

/** Flushes the mount effect's requestPermission promise chain. */
async function renderAndSettle() {
  await render(<AttendanceScanScreen />);
  await act(async () => {});
}

function expectNoCustomInterstitial() {
  expect(screen.queryByText('Use Your Camera')).toBeNull();
  expect(screen.queryByLabelText('Continue')).toBeNull();
  expect(screen.queryByLabelText('Not Now')).toBeNull();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseAuth.mockReturnValue({ status: 'signedIn', selectedOrganization: { memberId: 'member-1' } });
  mockUseCameraPermissions.mockReturnValue([permission({}), mockRequestPermission]);
  mockRequestPermission.mockResolvedValue(permission({}));
});

describe('AttendanceScanScreen -- identity gate (Build 27)', () => {
  // Permission is granted in these tests so "made it past the gate" is
  // observable as the scanner itself — the pre-permission interstitial that
  // used to serve as the marker no longer exists (Apple 5.1.1(iv)).
  it('a PTA parent with no OrgMember reaches the scanner — household check-in is a real identity', async () => {
    mockUseAuth.mockReturnValue({
      status: 'signedIn',
      selectedOrganization: { memberId: null, pta: { householdAdultId: 'adult-1', isOfficer: false, canCheckIn: false, canApproveHours: false } },
    });
    mockUseCameraPermissions.mockReturnValue([permission({ granted: true, status: 'granted' }), mockRequestPermission]);
    await renderAndSettle();
    expect(screen.getByText('Point your camera at the meeting QR code')).toBeTruthy();
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
    mockUseCameraPermissions.mockReturnValue([permission({ granted: true, status: 'granted' }), mockRequestPermission]);
    await renderAndSettle();
    expect(screen.queryByText('Point your camera at the meeting QR code')).toBeNull();
    // The gate must also short-circuit the automatic permission request.
    expect(mockRequestPermission).not.toHaveBeenCalled();
    expect(screen.getByText("Check-in records attendance for a member or family record, and your login doesn't have one in this organization.")).toBeTruthy();
  });

  it('a constituent member still reaches the scanner exactly as before', async () => {
    mockUseCameraPermissions.mockReturnValue([permission({ granted: true, status: 'granted' }), mockRequestPermission]);
    await renderAndSettle();
    expect(screen.getByText('Point your camera at the meeting QR code')).toBeTruthy();
  });
});

describe('AttendanceScanScreen -- camera permission states', () => {
  it('undetermined: fires the native permission request immediately on entry, exactly once, with no custom interstitial', async () => {
    let resolveRequest: (v: unknown) => void = () => {};
    mockRequestPermission.mockImplementation(() => new Promise((r) => { resolveRequest = r; }));

    await renderAndSettle();

    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    // While the system dialog is up, nothing of ours competes with it: no
    // priming copy, no dismiss action, no scanner, no denied screen.
    expectNoCustomInterstitial();
    expect(screen.queryByText('Point your camera at the meeting QR code')).toBeNull();
    expect(screen.queryByText('Camera Access Is Off')).toBeNull();

    await act(async () => {
      resolveRequest(permission({}));
    });
  });

  it('undetermined -> user grants in the native dialog: the scanner opens', async () => {
    answerNativePromptWith(permission({ granted: true, status: 'granted' }));

    await renderAndSettle();

    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Point your camera at the meeting QR code')).toBeTruthy();
    expectNoCustomInterstitial();
  });

  it('undetermined -> user denies in the native dialog (iOS): the informational Settings screen appears, with no re-prompt loop', async () => {
    answerNativePromptWith(permission({ granted: false, canAskAgain: false, status: 'denied' }));

    await renderAndSettle();

    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Camera Access Is Off')).toBeTruthy();
    expect(screen.getByLabelText('Open Settings')).toBeTruthy();
    expect(screen.getByLabelText('Back to Dashboard')).toBeTruthy();
    expectNoCustomInterstitial();
  });

  it('undetermined -> denied but still re-askable (Android): settles on the Settings screen instead of spinning or looping', async () => {
    answerNativePromptWith(permission({ granted: false, canAskAgain: true, status: 'denied' }));

    await renderAndSettle();

    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Camera Access Is Off')).toBeTruthy();
  });

  it('authorized: opens the scanner directly with no permission request and no permission UI', async () => {
    mockUseCameraPermissions.mockReturnValue([permission({ granted: true, status: 'granted' }), mockRequestPermission]);

    await renderAndSettle();

    expect(mockRequestPermission).not.toHaveBeenCalled();
    expect(screen.getByText('Point your camera at the meeting QR code')).toBeTruthy();
    expectNoCustomInterstitial();
  });

  it('previously denied: shows the informational Settings screen without ever re-requesting', async () => {
    mockUseCameraPermissions.mockReturnValue([permission({ canAskAgain: false, status: 'denied' }), mockRequestPermission]);

    await renderAndSettle();

    expect(mockRequestPermission).not.toHaveBeenCalled();
    expect(screen.getByText('Camera Access Is Off')).toBeTruthy();
    expectNoCustomInterstitial();
  });

  it('restricted (parental controls / MDM -- surfaced by expo-camera as denied + canAskAgain:false): same informational screen, no request', async () => {
    mockUseCameraPermissions.mockReturnValue([permission({ canAskAgain: false, status: 'denied' }), mockRequestPermission]);

    await renderAndSettle();

    expect(mockRequestPermission).not.toHaveBeenCalled();
    expect(screen.getByText('Camera Access Is Off')).toBeTruthy();
    expect(screen.getByLabelText('Open Settings')).toBeTruthy();
  });

  it('Open Settings actually opens Settings, not another permission request', async () => {
    mockUseCameraPermissions.mockReturnValue([permission({ canAskAgain: false, status: 'denied' }), mockRequestPermission]);
    const openSettingsSpy = jest.spyOn(Linking, 'openSettings').mockResolvedValue();

    await renderAndSettle();
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Open Settings'));
    });

    expect(openSettingsSpy).toHaveBeenCalledTimes(1);
    expect(mockRequestPermission).not.toHaveBeenCalled();
  });

  it('Back to Dashboard in the denied state returns to the dashboard', async () => {
    mockUseCameraPermissions.mockReturnValue([permission({ canAskAgain: false, status: 'denied' }), mockRequestPermission]);

    await renderAndSettle();
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Back to Dashboard'));
    });

    expect(mockRouterReplace).toHaveBeenCalledWith('/dashboard');
  });

  it('regression guard: no directive wording anywhere in the denied-state copy', async () => {
    mockUseCameraPermissions.mockReturnValue([permission({ canAskAgain: false, status: 'denied' }), mockRequestPermission]);

    await renderAndSettle();

    const banned = ['Grant', 'Allow Access', 'Enable Camera', 'You Must Allow', 'Continue', 'Not Now'];
    const tree = JSON.stringify(screen.toJSON());
    for (const phrase of banned) {
      expect(tree).not.toContain(phrase);
    }
  });
});
