import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, ScrollView, StyleSheet } from 'react-native';

import { PrimaryActionButton, SecondaryLinkButton } from '@/components/action-buttons';
import { LoadErrorBanner } from '@/components/load-error-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ActionColors, Spacing } from '@/constants/theme';
import { useScreenTopPadding } from '@/hooks/use-screen-top-padding';
import { ApiError } from '@/lib/api-client';
import type { PtaHouseholdPhoto, UploadPtaHouseholdPhotoAsset } from '@/lib/mobile-api';

type PhotoSource = 'camera' | 'library';

type Stage =
  | { kind: 'idle' }
  | { kind: 'choosingSource' }
  | { kind: 'primingPermission'; source: 'camera' }
  | { kind: 'permissionBlocked'; source: 'camera' }
  | { kind: 'previewing'; asset: ImagePicker.ImagePickerAsset }
  | { kind: 'uploading' }
  | { kind: 'removing' };

export interface PtaPhotoManagerLabels {
  heading: string;
  description: string;
  currentPhotoA11y: string;
  emptyPhotoA11y: string;
  loadingA11y: string;
  uploadingA11y: string;
  removingA11y: string;
  loadErrorMessage: string;
  retryTarget: string;
  uploadErrorMessage: string;
  removeErrorMessage: string;
  removeConfirmTitle: string;
  removeConfirmBody: string;
  cameraPrimingBody: string;
}

export interface PtaPhotoManagerProps {
  /** Changes whenever the photo's subject changes (org switch, different
   * student) — a loaded photo is only rendered while its key still matches,
   * so a previous subject's photo never lingers during the next fetch. */
  photoKey: string;
  labels: PtaPhotoManagerLabels;
  loadPhoto: () => Promise<PtaHouseholdPhoto | null>;
  uploadPhoto: (asset: UploadPtaHouseholdPhotoAsset) => Promise<unknown>;
  removePhoto: () => Promise<unknown>;
}

/**
 * Build 27 extraction of pta-family-photo.tsx's entire photo-management flow
 * (permission state machine, in-context camera priming, preview/confirm,
 * bytes-only load, org-switch staleness guard) so the student photo reuses
 * the SAME review-hardened UI rather than a second copy that drifts. All
 * behavioral properties documented on the original screen hold here:
 * the library path requests no permission at all (Apple 5.1.1(iv)), camera
 * priming copy is neutral and in-context only, native picker throws are
 * distinguished from cancellations, and upload/removal progress is a live
 * region, not just a spinner.
 */
export function PtaPhotoManager({ photoKey, labels, loadPhoto, uploadPhoto, removePhoto }: PtaPhotoManagerProps) {
  const [photo, setPhoto] = useState<{ key: string; data: PtaHouseholdPhoto } | null>(null);
  const visiblePhoto = photo && photo.key === photoKey ? photo.data : null;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const topPadding = useScreenTopPadding();

  const load = useCallback(async () => {
    try {
      const loaded = await loadPhoto();
      setPhoto(loaded ? { key: photoKey, data: loaded } : null);
      setLoadError(null);
    } catch {
      setLoadError(labels.loadErrorMessage);
    }
  }, [loadPhoto, photoKey, labels.loadErrorMessage]);

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

  const beginSource = useCallback(
    async (source: PhotoSource) => {
      setActionError(null);
      if (source === 'library') {
        // launchImageLibraryAsync's own doc comment: "Requires
        // Permissions.MEDIA_LIBRARY on iOS 10 only" -- on every supported iOS
        // version and on Android the system picker runs out-of-process and
        // hands back only the chosen file, with no broad library grant.
        // Requesting one anyway would be exactly the unnecessary
        // photo-library permission the Apple 5.1.1(iv) correction avoids.
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
    },
    []
  );

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
      // The native call itself can throw (e.g. no camera hardware) distinctly
      // from a normal user cancellation, which arrives as result.canceled.
      setActionError(source === 'camera' ? 'Unable to use the camera on this device.' : 'Unable to open your photo library.');
      setStage({ kind: 'idle' });
    }
  }

  async function confirmUpload(asset: ImagePicker.ImagePickerAsset) {
    setStage({ kind: 'uploading' });
    setActionError(null);
    try {
      await uploadPhoto({
        uri: asset.uri,
        fileName: asset.fileName ?? 'photo.jpg',
        mimeType: asset.mimeType ?? 'image/jpeg',
      });
      await load();
      setStage({ kind: 'idle' });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : labels.uploadErrorMessage);
      setStage({ kind: 'idle' });
    }
  }

  function confirmRemove() {
    Alert.alert(labels.removeConfirmTitle, labels.removeConfirmBody, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setStage({ kind: 'removing' });
          setActionError(null);
          try {
            await removePhoto();
            await load();
          } catch (err) {
            setActionError(err instanceof ApiError ? err.message : labels.removeErrorMessage);
          } finally {
            setStage({ kind: 'idle' });
          }
        },
      },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={[styles.container, topPadding]}>
      <ThemedText type="title" accessibilityRole="header">
        {labels.heading}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {labels.description}
      </ThemedText>

      <LoadErrorBanner message={loadError} onRetry={load} retryTarget={labels.retryTarget} />

      {loading ? (
        <ThemedView
          style={styles.centered}
          accessible
          accessibilityLabel={labels.loadingA11y}
          accessibilityRole="progressbar"
          accessibilityState={{ busy: true }}
        >
          <ActivityIndicator />
        </ThemedView>
      ) : (
        <>
          {/* Hidden while a picked photo is awaiting confirmation: showing the
              "No photo yet" placeholder directly above the image the user just
              chose made the screen contradict itself. */}
          {stage.kind !== 'previewing' ? (
            <ThemedView type="backgroundElement" style={styles.photoCard}>
              {visiblePhoto ? (
                <Image
                  source={{ uri: visiblePhoto.uri }}
                  style={styles.photo}
                  accessible
                  accessibilityRole="image"
                  accessibilityLabel={labels.currentPhotoA11y}
                />
              ) : (
                <ThemedView style={styles.emptyPhoto} accessible accessibilityRole="image" accessibilityLabel={labels.emptyPhotoA11y}>
                  <ThemedText type="small" themeColor="textSecondary">No photo yet</ThemedText>
                </ThemedView>
              )}
            </ThemedView>
          ) : null}

          {actionError ? (
            <ThemedText type="small" style={styles.errorText} accessibilityRole="alert">
              {actionError}
            </ThemedText>
          ) : null}

          {stage.kind === 'idle' ? (
            <>
              <PrimaryActionButton label={visiblePhoto ? 'Replace Photo' : 'Add Photo'} onPress={() => setStage({ kind: 'choosingSource' })} accessibilityLabel={visiblePhoto ? 'Replace photo' : 'Add photo'} />
              {visiblePhoto ? <SecondaryLinkButton label="Remove Photo" danger onPress={confirmRemove} accessibilityLabel="Remove photo" /> : null}
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
              <ThemedText type="smallBold" accessibilityRole="header">Use Your Camera</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{labels.cameraPrimingBody}</ThemedText>
              <PrimaryActionButton label="Continue" onPress={() => confirmPriming()} />
              <SecondaryLinkButton label="Not Now" onPress={() => setStage({ kind: 'idle' })} accessibilityLabel="Not now" />
            </ThemedView>
          ) : null}

          {stage.kind === 'permissionBlocked' ? (
            <ThemedView type="backgroundElement" style={styles.actionCard}>
              <ThemedText type="smallBold" accessibilityRole="header">Camera Access Is Off</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Camera access for Unestra is currently off. You can turn it back on in Settings if you want to take a new photo.
              </ThemedText>
              <PrimaryActionButton label="Open Settings" onPress={() => Linking.openSettings()} />
              <SecondaryLinkButton label="Not Now" onPress={() => setStage({ kind: 'idle' })} accessibilityLabel="Not now" />
            </ThemedView>
          ) : null}

          {stage.kind === 'previewing' ? (
            <ThemedView type="backgroundElement" style={styles.actionCard}>
              {/* actionCard stretches its children; the fixed-width image needs
                  to opt out or it hangs off the left edge. */}
              <Image
                source={{ uri: stage.asset.uri }}
                style={[styles.photo, styles.previewPhoto]}
                accessible
                accessibilityRole="image"
                accessibilityLabel="Preview of the photo you picked"
              />
              <PrimaryActionButton label="Use This Photo" onPress={() => confirmUpload(stage.asset)} accessibilityLabel="Use this photo" />
              <SecondaryLinkButton label="Choose a Different Photo" onPress={() => setStage({ kind: 'choosingSource' })} />
            </ThemedView>
          ) : null}

          {stage.kind === 'uploading' || stage.kind === 'removing' ? (
            // Announced, not just spun: without a live region a screen-reader
            // user gets no signal that the upload or removal is under way.
            <ThemedView
              style={styles.centered}
              accessible
              accessibilityRole="progressbar"
              accessibilityState={{ busy: true }}
              accessibilityLabel={stage.kind === 'uploading' ? labels.uploadingA11y : labels.removingA11y}
              accessibilityLiveRegion="polite"
            >
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
  previewPhoto: {
    alignSelf: 'center',
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
