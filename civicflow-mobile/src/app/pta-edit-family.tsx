import { Redirect, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { PrimaryActionButton, SecondaryLinkButton } from '@/components/action-buttons';
import { LoadErrorBanner } from '@/components/load-error-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { StatusChip } from '@/components/ui';
import { ActionColors, Radii, Spacing, type StatusTone } from '@/constants/theme';
import { useScreenTopPadding } from '@/hooks/use-screen-top-padding';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import {
  getMyPtaChangeRequests,
  getMyPtaClassrooms,
  getMyPtaHousehold,
  submitPtaChangeRequest,
  updateMyPtaAdult,
  updateMyPtaHouseholdInterests,
  type MyPtaClassroom,
  type MyPtaHousehold,
  type PtaChangeRequest,
  type PtaChangeRequestStatus,
} from '@/lib/mobile-api';

/**
 * Build 27 Edit Family — the parent-facing home for updating family
 * information, split along the server's own classification:
 *
 *  - DIRECTLY EDITABLE (saved immediately): the caller's own contact row
 *    and the household's volunteer interests.
 *  - SUBMITTED FOR APPROVAL (a PtaFamilyChangeRequest an officer reviews,
 *    and whose approval writes the real records): family display name,
 *    adding/renaming/removing students, and class placement.
 *  - READ-ONLY here: everything else (billing, dues, school year,
 *    memberships) — never silently overwritten from a phone.
 *
 * Every save keys off the caller's own household linkage server-side; the
 * only entity ids sent are student/classroom ids the server re-validates
 * against that household and the current school year.
 */

const STATUS_LABELS: Record<PtaChangeRequestStatus, string> = {
  SUBMITTED: 'Pending review',
  APPROVED: 'Approved',
  APPLIED: 'Applied',
  REJECTED: 'Not approved',
};

const STATUS_TONES: Record<PtaChangeRequestStatus, StatusTone> = {
  SUBMITTED: 'pending',
  APPROVED: 'info',
  APPLIED: 'approved',
  REJECTED: 'rejected',
};

const TYPE_LABELS: Record<PtaChangeRequest['type'], string> = {
  HOUSEHOLD_DISPLAY_NAME: 'Family name change',
  ADD_STUDENT: 'Add a student',
  RENAME_STUDENT: 'Student name correction',
  STUDENT_PLACEMENT: 'Class placement change',
  REMOVE_STUDENT: 'Remove a student',
};

type RequestForm =
  | { kind: 'none' }
  | { kind: 'householdName' }
  | { kind: 'addStudent' }
  | { kind: 'renameStudent'; studentId: string; currentName: string }
  | { kind: 'placement'; studentId: string; studentName: string };

export default function PtaEditFamilyScreen() {
  const { status, selectedOrganization, selectedOrganizationId } = useAuth();
  const hasParentIdentity = Boolean(selectedOrganization?.pta?.householdAdultId);
  const topPadding = useScreenTopPadding();

  const [household, setHousehold] = useState<MyPtaHousehold | null>(null);
  const [requests, setRequests] = useState<PtaChangeRequest[]>([]);
  const [classrooms, setClassrooms] = useState<MyPtaClassroom[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactRelationship, setContactRelationship] = useState('');
  const [interestsText, setInterestsText] = useState('');
  const [savingContact, setSavingContact] = useState(false);
  const [savingInterests, setSavingInterests] = useState(false);

  const [requestForm, setRequestForm] = useState<RequestForm>({ kind: 'none' });
  const [requestText, setRequestText] = useState('');
  const [submittingRequest, setSubmittingRequest] = useState(false);

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !hasParentIdentity) return;
    try {
      const [householdData, requestData, classroomData] = await Promise.all([
        getMyPtaHousehold(selectedOrganizationId),
        getMyPtaChangeRequests(selectedOrganizationId),
        getMyPtaClassrooms(selectedOrganizationId).catch(() => ({ currentSchoolYear: null, classrooms: [] })),
      ]);
      setHousehold(householdData);
      setRequests(requestData);
      setClassrooms(classroomData.classrooms);
      const self = householdData.adults.find((a) => a.isSelf);
      if (self) {
        setContactName(self.name);
        setContactEmail(self.email ?? '');
        setContactPhone(self.phone ?? '');
        setContactRelationship(self.relationshipLabel ?? '');
      }
      setInterestsText(householdData.volunteerInterests.join(', '));
      setLoadError(null);
    } catch {
      setLoadError('Unable to load your family information. Check your connection and try again.');
    }
  }, [selectedOrganizationId, hasParentIdentity]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        setLoading(true);
        try {
          await load();
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [load])
  );

  async function saveContact() {
    if (!selectedOrganizationId || savingContact) return;
    if (!contactName.trim()) {
      Alert.alert('Name required', 'Please enter your name.');
      return;
    }
    setSavingContact(true);
    try {
      await updateMyPtaAdult(selectedOrganizationId, {
        name: contactName.trim(),
        email: contactEmail.trim() || null,
        phone: contactPhone.trim() || null,
        relationshipLabel: contactRelationship.trim() || null,
      });
      Alert.alert('Saved', 'Your contact information has been updated.');
      await load();
    } catch (error) {
      Alert.alert('Unable to save', error instanceof ApiError ? error.message : 'Please try again.');
    } finally {
      setSavingContact(false);
    }
  }

  async function saveInterests() {
    if (!selectedOrganizationId || savingInterests) return;
    setSavingInterests(true);
    try {
      const interests = interestsText
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, 25);
      await updateMyPtaHouseholdInterests(selectedOrganizationId, interests);
      Alert.alert('Saved', 'Your volunteer interests have been updated.');
      await load();
    } catch (error) {
      Alert.alert('Unable to save', error instanceof ApiError ? error.message : 'Please try again.');
    } finally {
      setSavingInterests(false);
    }
  }

  async function submitRequest(type: PtaChangeRequest['type'], payload: Record<string, unknown>) {
    if (!selectedOrganizationId || submittingRequest) return;
    setSubmittingRequest(true);
    try {
      await submitPtaChangeRequest(selectedOrganizationId, type, payload);
      setRequestForm({ kind: 'none' });
      setRequestText('');
      Alert.alert('Request submitted', 'Your PTA will review this change. You can track it under Pending Requests below.');
      await load();
    } catch (error) {
      Alert.alert('Unable to submit', error instanceof ApiError ? error.message : 'Please try again.');
    } finally {
      setSubmittingRequest(false);
    }
  }

  function confirmRemoveStudent(studentId: string, name: string) {
    Alert.alert(
      `Request removal of ${name}?`,
      'Your PTA will review this request before anything changes. Records are deactivated, never erased.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Request Removal', style: 'destructive', onPress: () => submitRequest('REMOVE_STUDENT', { studentId }) },
      ]
    );
  }

  if (status === 'signedOut') {
    return <Redirect href={{ pathname: '/login', params: { redirectTo: '/pta-edit-family' } }} />;
  }
  if (status === 'signedIn' && selectedOrganization && !hasParentIdentity) {
    return <Redirect href="/dashboard" />;
  }

  const pendingRequests = requests.filter((r) => r.status === 'SUBMITTED');
  const decidedRequests = requests.filter((r) => r.status !== 'SUBMITTED').slice(0, 10);

  return (
    <ScrollView contentContainerStyle={[styles.container, topPadding]}>
      <ThemedText type="title" accessibilityRole="header">Edit Family</ThemedText>
      <LoadErrorBanner message={loadError} onRetry={load} retryTarget="your family information" />

      {loading ? (
        <ThemedView style={styles.centered} accessible accessibilityRole="progressbar" accessibilityState={{ busy: true }} accessibilityLabel="Loading your family information">
          <ActivityIndicator />
        </ThemedView>
      ) : household ? (
        <>
          <ThemedText type="smallBold" accessibilityRole="header">My contact information</ThemedText>
          <ThemedView type="backgroundElement" style={styles.card}>
            <TextInput style={styles.input} value={contactName} onChangeText={setContactName} placeholder="Name" accessibilityLabel="Your name" />
            <TextInput style={styles.input} value={contactEmail} onChangeText={setContactEmail} placeholder="Email" accessibilityLabel="Your email" keyboardType="email-address" autoCapitalize="none" />
            <TextInput style={styles.input} value={contactPhone} onChangeText={setContactPhone} placeholder="Phone" accessibilityLabel="Your phone" keyboardType="phone-pad" />
            <TextInput style={styles.input} value={contactRelationship} onChangeText={setContactRelationship} placeholder="Relationship (e.g. Mom, Guardian)" accessibilityLabel="Your relationship to the students" />
            <PrimaryActionButton label="Save Contact Info" onPress={saveContact} loading={savingContact} loadingLabel="Saving…" accessibilityLabel="Save contact info" />
            <ThemedText type="small" themeColor="textSecondary">
              Saved immediately — this is your own contact record.
            </ThemedText>
          </ThemedView>

          <ThemedText type="smallBold" accessibilityRole="header">Volunteer interests</ThemedText>
          <ThemedView type="backgroundElement" style={styles.card}>
            <TextInput
              style={styles.input}
              value={interestsText}
              onChangeText={setInterestsText}
              placeholder="e.g. Book fair, Field day, Bake sale"
              accessibilityLabel="Volunteer interests, separated by commas"
            />
            <PrimaryActionButton label="Save Interests" onPress={saveInterests} loading={savingInterests} loadingLabel="Saving…" accessibilityLabel="Save volunteer interests" />
          </ThemedView>

          <ThemedText type="smallBold" accessibilityRole="header">Family name</ThemedText>
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="default">{household.displayName}</ThemedText>
            {requestForm.kind === 'householdName' ? (
              <>
                <TextInput style={styles.input} value={requestText} onChangeText={setRequestText} placeholder="New family name" accessibilityLabel="New family name" />
                <PrimaryActionButton
                  label="Submit for Review"
                  onPress={() => (requestText.trim() ? submitRequest('HOUSEHOLD_DISPLAY_NAME', { displayName: requestText.trim() }) : undefined)}
                  loading={submittingRequest}
                  loadingLabel="Submitting…"
                  accessibilityLabel="Submit family name change for review"
                />
                <SecondaryLinkButton label="Cancel" onPress={() => setRequestForm({ kind: 'none' })} />
              </>
            ) : (
              <SecondaryLinkButton
                label="Request a name change"
                onPress={() => {
                  setRequestText(household.displayName);
                  setRequestForm({ kind: 'householdName' });
                }}
                accessibilityLabel="Request a family name change"
              />
            )}
            <ThemedText type="small" themeColor="textSecondary">
              Reviewed by your PTA before it changes.
            </ThemedText>
          </ThemedView>

          <ThemedText type="smallBold" accessibilityRole="header">Students</ThemedText>
          {household.students.map((student) => (
            <ThemedView key={student.id} type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">{student.displayName}</ThemedText>
              {student.placementLabel ? (
                <ThemedText type="small" themeColor="textSecondary">{student.placementLabel}</ThemedText>
              ) : (
                <ThemedText type="small" themeColor="textSecondary">No class placement on file for this school year.</ThemedText>
              )}

              {requestForm.kind === 'renameStudent' && requestForm.studentId === student.id ? (
                <>
                  <TextInput style={styles.input} value={requestText} onChangeText={setRequestText} placeholder="Corrected name" accessibilityLabel={`Corrected name for ${student.displayName}`} />
                  <PrimaryActionButton
                    label="Submit for Review"
                    onPress={() => (requestText.trim() ? submitRequest('RENAME_STUDENT', { studentId: student.id, displayName: requestText.trim() }) : undefined)}
                    loading={submittingRequest}
                    loadingLabel="Submitting…"
                    accessibilityLabel="Submit student name correction for review"
                  />
                  <SecondaryLinkButton label="Cancel" onPress={() => setRequestForm({ kind: 'none' })} />
                </>
              ) : null}

              {requestForm.kind === 'placement' && requestForm.studentId === student.id ? (
                <>
                  <ThemedText type="small" themeColor="textSecondary">Choose the correct class:</ThemedText>
                  {classrooms.length === 0 ? (
                    <ThemedText type="small" themeColor="textSecondary">No classes are set up for the current school year.</ThemedText>
                  ) : (
                    classrooms.map((room) => (
                      <Pressable
                        key={room.id}
                        style={styles.classroomRow}
                        onPress={() => submitRequest('STUDENT_PLACEMENT', { studentId: student.id, classroomId: room.id })}
                        disabled={submittingRequest}
                        accessibilityRole="button"
                        accessibilityLabel={`Request placement in ${room.gradeName}, ${room.name}`}
                        accessibilityState={{ disabled: submittingRequest }}
                      >
                        <ThemedText type="small">{room.gradeName} · {room.name}</ThemedText>
                      </Pressable>
                    ))
                  )}
                  <SecondaryLinkButton label="Cancel" onPress={() => setRequestForm({ kind: 'none' })} />
                </>
              ) : null}

              {requestForm.kind === 'none' ? (
                <ThemedView style={styles.rowActions}>
                  <SecondaryLinkButton
                    label="Correct name"
                    onPress={() => {
                      setRequestText(student.displayName);
                      setRequestForm({ kind: 'renameStudent', studentId: student.id, currentName: student.displayName });
                    }}
                    accessibilityLabel={`Request a name correction for ${student.displayName}`}
                  />
                  <SecondaryLinkButton
                    label="Change class"
                    onPress={() => setRequestForm({ kind: 'placement', studentId: student.id, studentName: student.displayName })}
                    accessibilityLabel={`Request a class change for ${student.displayName}`}
                  />
                  <SecondaryLinkButton
                    label="Remove"
                    danger
                    onPress={() => confirmRemoveStudent(student.id, student.displayName)}
                    accessibilityLabel={`Request removal of ${student.displayName}`}
                  />
                </ThemedView>
              ) : null}
            </ThemedView>
          ))}

          <ThemedView type="backgroundElement" style={styles.card}>
            {requestForm.kind === 'addStudent' ? (
              <>
                <TextInput style={styles.input} value={requestText} onChangeText={setRequestText} placeholder="Student name" accessibilityLabel="New student's name" />
                <PrimaryActionButton
                  label="Submit for Review"
                  onPress={() => (requestText.trim() ? submitRequest('ADD_STUDENT', { displayName: requestText.trim() }) : undefined)}
                  loading={submittingRequest}
                  loadingLabel="Submitting…"
                  accessibilityLabel="Submit new student for review"
                />
                <SecondaryLinkButton label="Cancel" onPress={() => setRequestForm({ kind: 'none' })} />
              </>
            ) : (
              <SecondaryLinkButton
                label="+ Request to add a student"
                onPress={() => {
                  setRequestText('');
                  setRequestForm({ kind: 'addStudent' });
                }}
                accessibilityLabel="Request to add a student"
              />
            )}
          </ThemedView>

          {pendingRequests.length > 0 || decidedRequests.length > 0 ? (
            <>
              <ThemedText type="smallBold" accessibilityRole="header">Pending Requests</ThemedText>
              {pendingRequests.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary">Nothing waiting for review.</ThemedText>
              ) : (
                pendingRequests.map((request) => (
                  <ThemedView key={request.id} type="backgroundElement" style={styles.card}>
                    <ThemedText type="smallBold">{TYPE_LABELS[request.type]}</ThemedText>
                    <StatusChip tone={STATUS_TONES[request.status]} label={STATUS_LABELS[request.status]} />
                    <ThemedText type="small" themeColor="textSecondary">Submitted {new Date(request.createdAt).toLocaleDateString()}</ThemedText>
                  </ThemedView>
                ))
              )}
              {decidedRequests.length > 0 ? (
                <>
                  <ThemedText type="smallBold" accessibilityRole="header">Recent decisions</ThemedText>
                  {decidedRequests.map((request) => (
                    <ThemedView key={request.id} type="backgroundElement" style={styles.card}>
                      <ThemedText type="smallBold">{TYPE_LABELS[request.type]}</ThemedText>
                      <StatusChip tone={STATUS_TONES[request.status]} label={STATUS_LABELS[request.status]} />
                      {request.decisionNotes ? (
                        <ThemedText type="small" themeColor="textSecondary">{request.decisionNotes}</ThemedText>
                      ) : null}
                    </ThemedView>
                  ))}
                </>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
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
  },
  card: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  input: {
    borderWidth: 1,
    borderColor: ActionColors.border,
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  rowActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
    backgroundColor: 'transparent',
  },
  classroomRow: {
    borderWidth: 1,
    borderColor: ActionColors.border,
    borderRadius: Radii.sm,
    padding: Spacing.three,
    minHeight: 44,
    justifyContent: 'center',
  },
});
