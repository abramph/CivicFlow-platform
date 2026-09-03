import * as ImagePicker from 'expo-image-picker';
import { Redirect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, ScrollView, StyleSheet } from 'react-native';

import { PrimaryActionButton, SecondaryLinkButton } from '@/components/action-buttons';
import { LoadErrorBanner } from '@/components/load-error-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ActionColors, Spacing } from '@/constants/theme';
import { useScreenTopPadding } from '@/hooks/use-screen-top-padding';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import {
  deletePtaHouseholdPhoto,
  getPtaHouseholdPhoto,
  uploadPtaHouseholdPhoto,
  type PtaHouseholdPhoto,
} from '@/lib/mobile-api';

type PhotoSource = 'camera' | 'library';

/**
 * Custom pre-permission copy for the camera path only. Deliberately
 * neutral -- "Continue" only advances to the system's own permission
 * dialog; it does not itself grant, allow, or enable anything, and nothing
 * here tries to influence what the user picks once that system dialog
 * appears. This screen is only ever shown in-context, after the user has
 * already tapped "Take Photo" below -- never at launch, sign-in, or
 * registration. See attendance-scan.tsx for the pattern this deliberately
 * does NOT follow ("Grant Camera Access" -- corrected in a later pass);
 * this screen is the corrected version of that pattern.
 *
 * The library path never reaches this priming step at all -- see
 * beginSource's own comment on why no permission is requested for it.
 */
const CAMERA_PRIMING_COPY = {
  title: 'Use Your Camera',
  body: "To take a new family photo, Unestra needs to use your camera. You'll be asked to confirm on the next screen.",
};

const CAMERA_BLOCKED_COPY = {
  title: 'Camera Access Is Off',
  body: 'Camera access for Unestra is currently off. You can turn it back on in Settings if you want to take a new photo.',
};

type Stage =
  | { kind: 'idle' }
  | { kind: 'choosingSource' }
  | { kind: 'primingPermission'; source: 'camera' }
  | { kind: 'permissionBlocked'; source: 'camera' }
  | { kind: 'previewing'; asset: ImagePicker.ImagePickerAsset }
  | { kind: 'uploading' }
  | { kind: 'removing' };

export default function PtaFamilyPhotoScreen() {
  const { status, selectedOrganizationId } = useAuth();
  const [photo, setPhoto] = useState<PtaHouseholdPhoto | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const topPadding = useScreenTopPadding();

  const load = useCallback(async () => {
    if (!selectedOrganizationId) return;
    try {
      setPhoto(await getPtaHouseholdPhoto(selectedOrganizationId));
      setLoadError(null);
    } catch {
      setLoadError('Unable to load your family photo. Check your connection and try again.');
    }
  }, [selectedOrganizationId]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await load();
      } finally {
        setLoading(false);
      }
    })();
  }, [load]);

  const beginSource = useCallback(async (source: PhotoSource) => {
    setActionError(null);
    if (source === 'library') {
      // launchImageLibraryAsync's own doc comment: "Requires
      // Permissions.MEDIA_LIBRARY on iOS 10 only" -- on every iOS version
      // this app actually supports, and on Android (the plugin config never
      // requests a storage/media-library runtime permission either), the
      // system picker runs out-of-process and hands back only the file the
      // user chose, with no broad library grant at all. Requesting it
      // anyway would be exactly the unnecessary photo-library permission
      // the Apple 5.1.1(iv) correction is scoped to avoid introducing.
      await launchPicker('library');
      return;
    }
    const current = await ImagePicker.getCameraPermissionsAsync();
    if (current.granted) {
      await launchPicker('camera');
      return;
    }
    if (!current.canAskAgain) {
      setStage({ kind: 'permissionBlocked', source: 'camera' });
      return;
    }
    setStage({ kind: 'primingPermission', source: 'camera' });
  }, []);

  async function confirmPriming() {
    const result = await ImagePicker.requestCameraPermissionsAsync();
    if (!result.granted) {
      setStage(result.canAskAgain ? { kind: 'idle' } : { kind: 'permissionBlocked', source: 'camera' });
      return;
    }
    await launchPicker('camera');
  }

  async function launchPicker(source: PhotoSource) {
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 };
    try {
      const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled || !result.assets[0]) {
        setStage({ kind: 'idle' });
        return;
      }
      setStage({ kind: 'previewing', asset: result.assets[0] });
    } catch {
      // The native call itself can throw (e.g. no camera hardware
      // available) distinctly from a normal user cancellation, which
      // arrives as result.canceled above, not a rejection. Surfaces as a
      // normal, visible error rather than a silently stuck screen.
      setActionError(source === 'camera' ? 'Unable to use the camera on this device.' : 'Unable to open your photo library.');
      setStage({ kind: 'idle' });
    }
  }

  async function confirmUpload(asset: ImagePicker.ImagePickerAsset) {
    if (!selectedOrganizationId) return;
    setStage({ kind: 'uploading' });
    setActionError(null);
    try {
      await uploadPtaHouseholdPhoto(selectedOrganizationId, {
        uri: asset.uri,
        fileName: asset.fileName ?? 'family-photo.jpg',
        mimeType: asset.mimeType ?? 'image/jpeg',
      });
      await load();
      setStage({ kind: 'idle' });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Unable to upload your photo. Check your connection and try again.');
      setStage({ kind: 'idle' });
    }
  }

  function confirmRemove() {
    Alert.alert('Remove Family Photo?', 'This removes the photo for everyone in your household. You can add a new one anytime.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          if (!selectedOrganizationId) return;
          setStage({ kind: 'removing' });
          setActionError(null);
          try {
            await deletePtaHouseholdPhoto(selectedOrganizationId);
            await load();
          } catch (err) {
            setActionError(err instanceof ApiError ? err.message : 'Unable to remove your photo. Check your connection and try again.');
          } finally {
            setStage({ kind: 'idle' });
          }
        },
      },
    ]);
  }

  if (status === 'signedOut') {
    return <Redirect href={{ pathname: '/login', params: { redirectTo: '/pta-family-photo' } }} />;
  }

  return (
    <ScrollView contentContainerStyle={[styles.container, topPadding]}>
      <ThemedText type="title">Family Photo</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Optional. Add a photo for your family — it&apos;s never required and only visible within your PTA.
      </ThemedText>

      <LoadErrorBanner message={loadError} onRetry={load} />

      {loading ? (
        <ThemedView style={styles.centered}>
          <ActivityIndicator />
        </ThemedView>
      ) : (
        <>
          <ThemedView type="backgroundElement" style={styles.photoCard}>
            {photo ? (
              <Image source={{ uri: photo.url }} style={styles.photo} accessibilityLabel="Your current family photo" />
            ) : (
              <ThemedView style={styles.emptyPhoto} accessible accessibilityLabel="No family photo on file">
                <ThemedText type="small" themeColor="textSecondary">No photo yet</ThemedText>
              </ThemedView>
            )}
          </ThemedView>

          {actionError ? (
            <ThemedText type="small" style={styles.errorText} accessibilityRole="alert">
              {actionError}
            </ThemedText>
          ) : null}

          {stage.kind === 'idle' ? (
            <>
              <PrimaryActionButton label={photo ? 'Replace Photo' : 'Add Photo'} onPress={() => setStage({ kind: 'choosingSource' })} accessibilityLabel={photo ? 'Replace photo' : 'Add photo'} />
              {photo ? <SecondaryLinkButton label="Remove Photo" danger onPress={confirmRemove} accessibilityLabel="Remove photo" /> : null}
            </>
          ) : null}

          {stage.kind === 'choosingSource' ? (
            <ThemedView type="backgroundElement" style={styles.actionCard}>
              <PrimaryActionButton label="Take Photo" onPress={() => beginSource('camera')} accessibilityLabel="Take photo" />
              <PrimaryActionButton label="Choose from Library" onPress={() => beginSource('library')} accessibilityLabel="Choose from library" />
              <SecondaryLinkButton label="Cancel" onPress={() => setStage({ kind: 'idle' })} />
            </ThemedView>
          ) : null}

          {stage.kind === 'primingPermission' ? (
            <ThemedView type="backgroundElement" style={styles.actionCard}>
              <ThemedText type="smallBold">{CAMERA_PRIMING_COPY.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{CAMERA_PRIMING_COPY.body}</ThemedText>
              <PrimaryActionButton label="Continue" onPress={() => confirmPriming()} />
              <SecondaryLinkButton label="Not Now" onPress={() => setStage({ kind: 'idle' })} accessibilityLabel="Not now" />
            </ThemedView>
          ) : null}

          {stage.kind === 'permissionBlocked' ? (
            <ThemedView type="backgroundElement" style={styles.actionCard}>
              <ThemedText type="smallBold">{CAMERA_BLOCKED_COPY.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{CAMERA_BLOCKED_COPY.body}</ThemedText>
              <PrimaryActionButton label="Open Settings" onPress={() => Linking.openSettings()} />
              <SecondaryLinkButton label="Not Now" onPress={() => setStage({ kind: 'idle' })} accessibilityLabel="Not now" />
            </ThemedView>
          ) : null}

          {stage.kind === 'previewing' ? (
            <ThemedView type="backgroundElement" style={styles.actionCard}>
              <Image source={{ uri: stage.asset.uri }} style={styles.photo} accessibilityLabel="Preview of the photo you picked" />
              <PrimaryActionButton label="Use This Photo" onPress={() => confirmUpload(stage.asset)} accessibilityLabel="Use this photo" />
              <SecondaryLinkButton label="Choose a Different Photo" onPress={() => setStage({ kind: 'choosingSource' })} />
            </ThemedView>
          ) : null}

          {stage.kind === 'uploading' || stage.kind === 'removing' ? (
            <ThemedView style={styles.centered}>
              <ActivityIndicator />
              <ThemedText type="small" themeColor="textSecondary">{stage.kind === 'uploading' ? 'Uploading…' : 'Removing…'}</ThemedText>
            </ThemedView>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.two,
  },
  photoCard: {
    borderRadius: 12,
    padding: Spacing.three,
    alignItems: 'center',
  },
  photo: {
    width: 200,
    height: 200,
    borderRadius: 12,
  },
  emptyPhoto: {
    width: 200,
    height: 200,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionCard: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.two,
    alignItems: 'stretch',
  },
  errorText: {
    color: ActionColors.danger,
  },
});
