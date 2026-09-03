import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, Linking } from 'react-native';

import PtaFamilyPhotoScreen from '../pta-family-photo';

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetPtaHouseholdPhoto = jest.fn();
const mockUploadPtaHouseholdPhoto = jest.fn();
const mockDeletePtaHouseholdPhoto = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getPtaHouseholdPhoto: (...args: unknown[]) => mockGetPtaHouseholdPhoto(...args),
  uploadPtaHouseholdPhoto: (...args: unknown[]) => mockUploadPtaHouseholdPhoto(...args),
  deletePtaHouseholdPhoto: (...args: unknown[]) => mockDeletePtaHouseholdPhoto(...args),
}));

const mockGetCameraPermissionsAsync = jest.fn();
const mockRequestCameraPermissionsAsync = jest.fn();
const mockGetMediaLibraryPermissionsAsync = jest.fn();
const mockRequestMediaLibraryPermissionsAsync = jest.fn();
const mockLaunchCameraAsync = jest.fn();
const mockLaunchImageLibraryAsync = jest.fn();
jest.mock('expo-image-picker', () => ({
  getCameraPermissionsAsync: (...args: unknown[]) => mockGetCameraPermissionsAsync(...args),
  requestCameraPermissionsAsync: (...args: unknown[]) => mockRequestCameraPermissionsAsync(...args),
  getMediaLibraryPermissionsAsync: (...args: unknown[]) => mockGetMediaLibraryPermissionsAsync(...args),
  requestMediaLibraryPermissionsAsync: (...args: unknown[]) => mockRequestMediaLibraryPermissionsAsync(...args),
  launchCameraAsync: (...args: unknown[]) => mockLaunchCameraAsync(...args),
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchImageLibraryAsync(...args),
}));

function granted() {
  return { granted: true, status: 'granted', expires: 'never', canAskAgain: true };
}
function undetermined() {
  return { granted: false, status: 'undetermined', expires: 'never', canAskAgain: true };
}
function blocked() {
  return { granted: false, status: 'denied', expires: 'never', canAskAgain: false };
}

const SIGNED_IN_AUTH = { status: 'signedIn', selectedOrganizationId: 'org-1' };

beforeEach(() => {
  jest.clearAllMocks();
  mockUseAuth.mockReturnValue(SIGNED_IN_AUTH);
  mockGetPtaHouseholdPhoto.mockResolvedValue(null);
});

// Every press is wrapped in an awaited act() -- this screen's initial
// load() is still an in-flight promise when the first press can happen in
// a fast test, and an un-awaited fireEvent.press races that settle instead
// of reliably composing with it (proven empirically: un-awaited presses
// against this screen intermittently never observe the resulting render).
async function press(label: string) {
  await act(async () => {
    fireEvent.press(screen.getByLabelText(label));
  });
}

async function openTakePhoto() {
  await waitFor(() => expect(screen.getByLabelText('Add photo')).toBeTruthy());
  await press('Add photo');
  await press('Take photo');
}

describe('PtaFamilyPhotoScreen', () => {
  it('shows an empty state when the household has no photo yet', async () => {
    render(<PtaFamilyPhotoScreen />);
    await waitFor(() => expect(screen.getByText('No photo yet')).toBeTruthy());
    expect(screen.getByLabelText('Add photo')).toBeTruthy();
    expect(screen.queryByLabelText('Remove photo')).toBeNull();
  });

  it('shows the current photo and a Remove option when one is on file', async () => {
    mockGetPtaHouseholdPhoto.mockResolvedValue({ url: 'https://spaces.example/signed', byteSize: 1000 });
    render(<PtaFamilyPhotoScreen />);
    await waitFor(() => expect(screen.getByLabelText('Replace photo')).toBeTruthy());
    expect(screen.getByLabelText('Remove photo')).toBeTruthy();
  });

  it('tapping Add Photo reveals Take Photo / Choose from Library, without prompting for any permission yet', async () => {
    render(<PtaFamilyPhotoScreen />);
    await waitFor(() => expect(screen.getByLabelText('Add photo')).toBeTruthy());
    await press('Add photo');
    expect(screen.getByLabelText('Take photo')).toBeTruthy();
    expect(screen.getByLabelText('Choose from library')).toBeTruthy();
    expect(mockGetCameraPermissionsAsync).not.toHaveBeenCalled();
    expect(mockRequestCameraPermissionsAsync).not.toHaveBeenCalled();
  });

  it('Choose from Library launches the system picker directly, never requesting media-library permission', async () => {
    // build-26 review, Section 6: launchImageLibraryAsync's own doc
    // comment says it "Requires Permissions.MEDIA_LIBRARY on iOS 10 only"
    // -- on every platform this app actually supports, the system picker
    // needs no broad library grant at all, so requesting one would be
    // exactly the unnecessary photo-library permission to avoid.
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///tmp/library-photo.jpg', width: 10, height: 10, fileName: 'library-photo.jpg', mimeType: 'image/jpeg' }],
    });
    render(<PtaFamilyPhotoScreen />);
    await waitFor(() => expect(screen.getByLabelText('Add photo')).toBeTruthy());
    await press('Add photo');
    await press('Choose from library');

    expect(mockGetMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
    expect(mockRequestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
    expect(mockLaunchImageLibraryAsync).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Use this photo')).toBeTruthy();
  });

  it('shows the neutral priming screen (not the system prompt directly) when camera permission has never been asked', async () => {
    mockGetCameraPermissionsAsync.mockResolvedValue(undetermined());
    render(<PtaFamilyPhotoScreen />);
    await openTakePhoto();

    expect(screen.getByText('Use Your Camera')).toBeTruthy();
    expect(screen.getByLabelText('Continue')).toBeTruthy();
    expect(screen.getByLabelText('Not now')).toBeTruthy();
    // The OS permission dialog itself must not fire until the user taps Continue.
    expect(mockRequestCameraPermissionsAsync).not.toHaveBeenCalled();

    // Regression guard for the Apple 5.1.1(iv) correction: none of this
    // screen's copy may use directive wording that tries to influence the
    // system permission decision.
    const banned = ['Grant', 'Allow Access', 'Enable Camera', 'You Must Allow'];
    const tree = JSON.stringify(screen.toJSON());
    for (const phrase of banned) {
      expect(tree).not.toContain(phrase);
    }
  });

  it('Not Now dismisses without ever calling the system permission request', async () => {
    mockGetCameraPermissionsAsync.mockResolvedValue(undetermined());
    render(<PtaFamilyPhotoScreen />);
    await openTakePhoto();

    await press('Not now');
    expect(mockRequestCameraPermissionsAsync).not.toHaveBeenCalled();
    expect(screen.queryByText('Use Your Camera')).toBeNull();
    expect(screen.getByLabelText('Add photo')).toBeTruthy();
  });

  it('Continue on the priming screen requests permission, then launches the camera on grant', async () => {
    mockGetCameraPermissionsAsync.mockResolvedValue(undetermined());
    mockRequestCameraPermissionsAsync.mockResolvedValue(granted());
    mockLaunchCameraAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///tmp/photo.jpg', width: 10, height: 10, fileName: 'photo.jpg', mimeType: 'image/jpeg' }],
    });
    render(<PtaFamilyPhotoScreen />);
    await openTakePhoto();

    await press('Continue');
    expect(mockRequestCameraPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(mockLaunchCameraAsync).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Use this photo')).toBeTruthy();
  });

  it('skips the priming screen entirely when permission is already granted', async () => {
    mockGetCameraPermissionsAsync.mockResolvedValue(granted());
    mockLaunchCameraAsync.mockResolvedValue({ canceled: true, assets: null });
    render(<PtaFamilyPhotoScreen />);
    await openTakePhoto();

    expect(mockRequestCameraPermissionsAsync).not.toHaveBeenCalled();
    expect(mockLaunchCameraAsync).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Use Your Camera')).toBeNull();
  });

  it('shows a visible error instead of silently hanging when the native camera call itself throws', async () => {
    // build-26 review, Section 6: a device with no camera hardware (or any
    // other native-level failure) rejects rather than resolving with
    // canceled:true -- distinct from a normal user cancellation, and
    // previously unhandled.
    mockGetCameraPermissionsAsync.mockResolvedValue(granted());
    mockLaunchCameraAsync.mockRejectedValueOnce(new Error('Camera not available'));
    render(<PtaFamilyPhotoScreen />);
    await openTakePhoto();

    expect(screen.getByText('Unable to use the camera on this device.')).toBeTruthy();
    expect(screen.getByLabelText('Add photo')).toBeTruthy(); // back to a usable idle state, not stuck
  });

  it('shows a neutral Settings redirect (not a repeated system prompt) when permission was already denied and cannot be re-asked', async () => {
    mockGetCameraPermissionsAsync.mockResolvedValue(blocked());
    const openSettingsSpy = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    render(<PtaFamilyPhotoScreen />);
    await openTakePhoto();

    expect(screen.getByText('Camera Access Is Off')).toBeTruthy();
    expect(mockRequestCameraPermissionsAsync).not.toHaveBeenCalled();
    await press('Open Settings');
    expect(openSettingsSpy).toHaveBeenCalledTimes(1);
  });

  it('uploads the picked photo, refreshes, and returns to idle on Use This Photo', async () => {
    mockGetCameraPermissionsAsync.mockResolvedValue(granted());
    mockLaunchCameraAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///tmp/photo.jpg', width: 10, height: 10, fileName: 'photo.jpg', mimeType: 'image/jpeg' }],
    });
    mockUploadPtaHouseholdPhoto.mockResolvedValue({ photoUrl: '/x', byteSize: 100, width: 10, height: 10 });
    mockGetPtaHouseholdPhoto.mockResolvedValueOnce(null).mockResolvedValueOnce({ url: 'https://spaces.example/new', byteSize: 100 });

    render(<PtaFamilyPhotoScreen />);
    await openTakePhoto();

    await press('Use this photo');

    expect(mockUploadPtaHouseholdPhoto).toHaveBeenCalledWith('org-1', {
      uri: 'file:///tmp/photo.jpg',
      fileName: 'photo.jpg',
      mimeType: 'image/jpeg',
    });
    await waitFor(() => expect(screen.getByLabelText('Replace photo')).toBeTruthy());
  });

  it('Remove Photo asks for confirmation via Alert before deleting anything', async () => {
    mockGetPtaHouseholdPhoto.mockResolvedValue({ url: 'https://spaces.example/signed', byteSize: 1000 });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    render(<PtaFamilyPhotoScreen />);
    await waitFor(() => expect(screen.getByLabelText('Remove photo')).toBeTruthy());
    await press('Remove photo');
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(mockDeletePtaHouseholdPhoto).not.toHaveBeenCalled();
  });

  it('deletes and refreshes once the destructive Alert action is confirmed', async () => {
    mockGetPtaHouseholdPhoto.mockResolvedValueOnce({ url: 'https://spaces.example/signed', byteSize: 1000 }).mockResolvedValueOnce(null);
    mockDeletePtaHouseholdPhoto.mockResolvedValue(undefined);
    let confirmedRemove: (() => void) | undefined;
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      confirmedRemove = buttons?.find((b) => b.style === 'destructive')?.onPress as (() => void) | undefined;
    });

    render(<PtaFamilyPhotoScreen />);
    await waitFor(() => expect(screen.getByLabelText('Remove photo')).toBeTruthy());
    await press('Remove photo');
    expect(confirmedRemove).toBeTruthy();

    await act(async () => {
      confirmedRemove?.();
    });

    expect(mockDeletePtaHouseholdPhoto).toHaveBeenCalledWith('org-1');
    await waitFor(() => expect(screen.getByLabelText('Add photo')).toBeTruthy());
  });
});
