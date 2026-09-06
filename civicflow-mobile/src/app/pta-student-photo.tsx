import { Redirect, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';

import { PtaPhotoManager } from '@/components/pta-photo-manager';
import { UnauthorizedNotice } from '@/components/unauthorized-notice';
import { useAuth } from '@/lib/auth-context';
import { deletePtaStudentPhoto, getPtaStudentPhoto, uploadPtaStudentPhoto, type UploadPtaHouseholdPhotoAsset } from '@/lib/mobile-api';

/**
 * Build 27 — per-student photo management, sharing the family photo's exact
 * review-hardened flow (PtaPhotoManager) and server pipeline. The studentId
 * route param is display routing only, never an authorization input: the
 * server requires the student to belong to the caller's OWN household
 * (re-derived from their PtaHouseholdAdult linkage) and answers "not found"
 * for any other family's student.
 */
export default function PtaStudentPhotoScreen() {
  const { status, selectedOrganization, selectedOrganizationId } = useAuth();
  const hasParentIdentity = Boolean(selectedOrganization?.pta?.householdAdultId);
  const { studentId, name } = useLocalSearchParams<{ studentId: string; name?: string }>();
  const studentLabel = name?.trim() || 'this student';

  const loadPhoto = useCallback(async () => {
    if (!selectedOrganizationId || !studentId) return null;
    return getPtaStudentPhoto(selectedOrganizationId, studentId);
  }, [selectedOrganizationId, studentId]);

  const uploadPhoto = useCallback(
    (asset: UploadPtaHouseholdPhotoAsset) => {
      if (!selectedOrganizationId || !studentId) return Promise.resolve(null);
      return uploadPtaStudentPhoto(selectedOrganizationId, studentId, { ...asset, fileName: asset.fileName || 'student-photo.jpg' });
    },
    [selectedOrganizationId, studentId]
  );

  const removePhoto = useCallback(() => {
    if (!selectedOrganizationId || !studentId) return Promise.resolve();
    return deletePtaStudentPhoto(selectedOrganizationId, studentId);
  }, [selectedOrganizationId, studentId]);

  if (status === 'signedOut') {
    return <Redirect href={{ pathname: '/login', params: { redirectTo: '/pta-my-family' } }} />;
  }
  if (status === 'signedIn' && selectedOrganization && !hasParentIdentity) {
    return <Redirect href="/dashboard" />;
  }
  if (!studentId) {
    return <UnauthorizedNotice message="This student could not be found." />;
  }

  return (
    <PtaPhotoManager
      photoKey={`${selectedOrganizationId ?? 'none'}:${studentId}`}
      labels={{
        heading: `${studentLabel} — Photo`,
        description: "Optional. Add a photo for this student — it's never required and only visible within your PTA.",
        currentPhotoA11y: `Current photo for ${studentLabel}`,
        emptyPhotoA11y: 'No student photo on file',
        loadingA11y: 'Loading the student photo',
        uploadingA11y: 'Uploading the student photo',
        removingA11y: 'Removing the student photo',
        loadErrorMessage: 'Unable to load this photo. Check your connection and try again.',
        retryTarget: 'the student photo',
        uploadErrorMessage: 'Unable to upload the photo. Check your connection and try again.',
        removeErrorMessage: 'Unable to remove the photo. Check your connection and try again.',
        removeConfirmTitle: 'Remove Student Photo?',
        removeConfirmBody: 'This removes the photo. You can add a new one anytime.',
        cameraPrimingBody: "To take a new student photo, Unestra needs to use your camera. You'll be asked to confirm on the next screen.",
      }}
      loadPhoto={loadPhoto}
      uploadPhoto={uploadPhoto}
      removePhoto={removePhoto}
    />
  );
}
