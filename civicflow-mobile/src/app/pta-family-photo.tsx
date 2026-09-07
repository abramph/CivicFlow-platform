import { Redirect } from 'expo-router';
import { useCallback } from 'react';

import { PtaPhotoManager } from '@/components/pta-photo-manager';
import { useAuth } from '@/lib/auth-context';
import { deletePtaHouseholdPhoto, getPtaHouseholdPhoto, uploadPtaHouseholdPhoto, type UploadPtaHouseholdPhotoAsset } from '@/lib/mobile-api';

/**
 * Family photo management — a thin wrapper over the shared PtaPhotoManager
 * (Build 27 extracted the whole review-hardened flow so the student photo
 * reuses it; every behavioral property from the Build 26 privacy/permission
 * work lives in that component now). This screen contributes only the
 * household endpoints, the family-specific copy, and the direct-navigation
 * defenses. The server resolves the household from the caller's own linkage
 * on every call — no household id is ever sent.
 */
export default function PtaFamilyPhotoScreen() {
  const { status, selectedOrganization, selectedOrganizationId } = useAuth();
  const hasParentIdentity = Boolean(selectedOrganization?.pta?.householdAdultId);

  const loadPhoto = useCallback(async () => {
    if (!selectedOrganizationId) return null;
    return getPtaHouseholdPhoto(selectedOrganizationId);
  }, [selectedOrganizationId]);

  const uploadPhoto = useCallback(
    (asset: UploadPtaHouseholdPhotoAsset) => {
      if (!selectedOrganizationId) return Promise.resolve(null);
      return uploadPtaHouseholdPhoto(selectedOrganizationId, { ...asset, fileName: asset.fileName || 'family-photo.jpg' });
    },
    [selectedOrganizationId]
  );

  const removePhoto = useCallback(() => {
    if (!selectedOrganizationId) return Promise.resolve();
    return deletePtaHouseholdPhoto(selectedOrganizationId);
  }, [selectedOrganizationId]);

  if (status === 'signedOut') {
    return <Redirect href={{ pathname: '/login', params: { redirectTo: '/pta-family-photo' } }} />;
  }
  // Direct-navigation defense mirroring pta-my-family's: client-side
  // convenience only — every photo API call independently re-authorizes
  // server-side via the caller's own household linkage.
  if (status === 'signedIn' && selectedOrganization && !hasParentIdentity) {
    return <Redirect href="/dashboard" />;
  }

  return (
    <PtaPhotoManager
      photoKey={selectedOrganizationId ?? 'none'}
      labels={{
        heading: 'Family Photo',
        description: "Optional. Add a photo for your family — it's never required and only visible within your PTA.",
        currentPhotoA11y: 'Your current family photo',
        emptyPhotoA11y: 'No family photo on file',
        loadingA11y: 'Loading your family photo',
        uploadingA11y: 'Uploading your family photo',
        removingA11y: 'Removing your family photo',
        loadErrorMessage: 'Unable to load your family photo. Check your connection and try again.',
        retryTarget: 'your family photo',
        uploadErrorMessage: 'Unable to upload your photo. Check your connection and try again.',
        removeErrorMessage: 'Unable to remove your photo. Check your connection and try again.',
        removeConfirmTitle: 'Remove Family Photo?',
        removeConfirmBody: 'This removes the photo for everyone in your household. You can add a new one anytime.',
        cameraPrimingBody: "To take a new family photo, Unestra needs to use your camera. You'll be asked to confirm on the next screen.",
      }}
      loadPhoto={loadPhoto}
      uploadPhoto={uploadPhoto}
      removePhoto={removePhoto}
    />
  );
}
