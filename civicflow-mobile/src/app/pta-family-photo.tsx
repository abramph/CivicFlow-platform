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
 * Custom pre-permission copy. Deliberately neutral -- "Continue" only
 * advances to the system's own permission dialog; it does not itself
 * grant, allow, or enable anything, and nothing here tries to influence
 * what the user picks once that system dialog appears. This screen is only
 * ever shown in-context, after the user has already tapped "Take Photo" or
 * "Choose from Library" below -- never at launch, sign-in, or registration.
 * See attendance-scan.tsx for the pattern this deliberately does NOT
 * follow ("Grant Camera Access" -- flagged for correction in a later
 * pass); this screen is the corrected version of that pattern.
 */
const PRIMING_COPY: Record<PhotoSource, { title: string; body: string }> = {
  camera: {
    title: 'Use Your Camera',
    body: "To take a new family photo, Unestra needs to use your camera. You'll be asked to confirm on the next screen.",
  },
  library: {
    title: 'Choose a Photo',
    body: "To choose a family photo from your library, Unestra needs access to your photos. You'll be asked to confirm on the next screen.",
  },
};

const BLOCKED_COPY: Record<PhotoSource, { title: string; body: string }> = {
  camera: {
    title: 'Camera Access Is Off',
    body: 'Camera access for Unestra is currently off. You can turn it back on in Settings if you want to take a new photo.',
  },
  library: {
    title: 'Photo Access Is Off',
    body: 'Photo library access for Unestra is currently off. You can turn it back on in Settings if you want to choose a photo.',
  },
};

type Stage =
  | { kind: 'idle' }
  | { kind: 'choosingSource' }
  | { kind: 'primingPermission'; source: PhotoSource }
  | { kind: 'permissionBlocked'; source: PhotoSource }
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
    const current = source === 'camera' ? await ImagePicker.getCameraPermissionsAsync() : await ImagePicker.getMediaLibraryPermissionsAsync();

    if (current.granted) {
      await launchPicker(source);
      return;
    }
    if (!current.canAskAgain) {
      setStage({ kind: 'permissionBlocked', source });
      return;
    }
    setStage({ kind: 'primingPermission', source });
  }, []);

  async function confirmPriming(source: PhotoSource) {
    const result = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!result.granted) {
      setStage(result.canAskAgain ? { kind: 'idle' } : { kind: 'permissionBlocked', source });
      return;
    }
    await launchPicker(source);
  }

  async function launchPicker(source: PhotoSource) {
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 };
    const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled || !result.assets[0]) {
      setStage({ kind: 'idle' });
      return;
    }
    setStage({ kind: 'previewing', asset: result.assets[0] });
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
              <ThemedText type="smallBold">{PRIMING_COPY[stage.source].title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{PRIMING_COPY[stage.source].body}</ThemedText>
              <PrimaryActionButton label="Continue" onPress={() => confirmPriming(stage.source)} />
              <SecondaryLinkButton label="Not Now" onPress={() => setStage({ kind: 'idle' })} accessibilityLabel="Not now" />
            </ThemedView>
          ) : null}

          {stage.kind === 'permissionBlocked' ? (
            <ThemedView type="backgroundElement" style={styles.actionCard}>
              <ThemedText type="smallBold">{BLOCKED_COPY[stage.source].title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{BLOCKED_COPY[stage.source].body}</ThemedText>
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
