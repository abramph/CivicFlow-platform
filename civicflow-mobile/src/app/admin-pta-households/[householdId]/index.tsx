import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { LoadErrorBanner } from '@/components/load-error-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import {
  addAdminPtaHouseholdAdult,
  addAdminPtaStudent,
  deactivateAdminPtaHousehold,
  deactivateAdminPtaStudent,
  getAdminPtaHousehold,
  removeAdminPtaHouseholdAdult,
  type AdminPtaHouseholdDetail,
} from '@/lib/mobile-api';

/**
 * Mobile Admin program (PR E) — PTA household detail. Re-fetches by
 * (householdId, organizationId) on every mount, matching every other detail
 * screen in this program. Adults have no update route anywhere in this
 * codebase (web or mobile) — only add/remove — so this screen doesn't
 * invent an edit form for them either. Adding an adult never accepts a
 * "link to user account" control since no such officer workflow exists
 * anywhere yet (see mobile-api.ts's doc comment).
 */
export default function AdminPtaHouseholdDetailScreen() {
  const { selectedOrganization, selectedOrganizationId } = useAuth();
  const hasManagePtaHouseholds = Boolean(selectedOrganization?.capability?.adminCapabilities?.includes('managePtaHouseholds'));
  const { householdId } = useLocalSearchParams<{ householdId: string }>();

  const [household, setHousehold] = useState<AdminPtaHouseholdDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);

  const [showAddAdult, setShowAddAdult] = useState(false);
  const [adultName, setAdultName] = useState('');
  const [adultEmail, setAdultEmail] = useState('');
  const [adultPhone, setAdultPhone] = useState('');
  const [adultRelationship, setAdultRelationship] = useState('');

  const [showAddStudent, setShowAddStudent] = useState(false);
  const [studentName, setStudentName] = useState('');

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !householdId || !hasManagePtaHouseholds) return;
    try {
      setHousehold(await getAdminPtaHousehold(selectedOrganizationId, householdId));
      setLoadError(null);
    } catch (error) {
      setHousehold(null);
      setLoadError(error instanceof ApiError && error.status === 404 ? 'This household could not be found.' : 'Unable to load this household. Check your connection and try again.');
    }
  }, [selectedOrganizationId, householdId, hasManagePtaHouseholds]);

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

  function confirmDeactivate() {
    Alert.alert('Deactivate this household?', 'Historical dues and activity records are preserved.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Deactivate', style: 'destructive', onPress: handleDeactivate },
    ]);
  }

  async function handleDeactivate() {
    if (!selectedOrganizationId || !householdId || actionPending) return;
    setActionPending(true);
    try {
      await deactivateAdminPtaHousehold(householdId, selectedOrganizationId);
      await load();
    } catch (error) {
      Alert.alert('Unable to deactivate', error instanceof ApiError ? error.message : 'Please try again.');
    } finally {
      setActionPending(false);
    }
  }

  async function handleAddAdult() {
    if (!selectedOrganizationId || !householdId || !adultName.trim() || actionPending) return;
    setActionPending(true);
    try {
      await addAdminPtaHouseholdAdult(householdId, {
        organizationId: selectedOrganizationId,
        name: adultName.trim(),
        email: adultEmail.trim() || null,
        phone: adultPhone.trim() || null,
        relationshipLabel: adultRelationship.trim() || null,
      });
      setShowAddAdult(false);
      setAdultName('');
      setAdultEmail('');
      setAdultPhone('');
      setAdultRelationship('');
      await load();
    } catch (error) {
      Alert.alert('Unable to add adult', error instanceof ApiError ? error.message : 'Please try again.');
    } finally {
      setActionPending(false);
    }
  }

  function confirmRemoveAdult(adultId: string, name: string) {
    Alert.alert(`Remove ${name}?`, 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => handleRemoveAdult(adultId) },
    ]);
  }

  async function handleRemoveAdult(adultId: string) {
    if (!selectedOrganizationId || !householdId || actionPending) return;
    setActionPending(true);
    try {
      await removeAdminPtaHouseholdAdult(householdId, adultId, selectedOrganizationId);
      await load();
    } catch (error) {
      Alert.alert('Unable to remove adult', error instanceof ApiError ? error.message : 'Please try again.');
    } finally {
      setActionPending(false);
    }
  }

  async function handleAddStudent() {
    if (!selectedOrganizationId || !householdId || !studentName.trim() || actionPending) return;
    setActionPending(true);
    try {
      await addAdminPtaStudent(householdId, selectedOrganizationId, studentName.trim());
      setShowAddStudent(false);
      setStudentName('');
      await load();
    } catch (error) {
      Alert.alert('Unable to add student', error instanceof ApiError ? error.message : 'Please try again.');
    } finally {
      setActionPending(false);
    }
  }

  function confirmDeactivateStudent(studentId: string, name: string) {
    Alert.alert(`Deactivate ${name}?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Deactivate', style: 'destructive', onPress: () => handleDeactivateStudent(studentId) },
    ]);
  }

  async function handleDeactivateStudent(studentId: string) {
    if (!selectedOrganizationId || !householdId || actionPending) return;
    setActionPending(true);
    try {
      await deactivateAdminPtaStudent(householdId, studentId, selectedOrganizationId);
      await load();
    } catch (error) {
      Alert.alert('Unable to deactivate student', error instanceof ApiError ? error.message : 'Please try again.');
    } finally {
      setActionPending(false);
    }
  }

  if (!hasManagePtaHouseholds) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText type="subtitle" themeColor="textSecondary">
          You don&apos;t have household administration access for this organization.
        </ThemedText>
      </ThemedView>
    );
  }

  if (loading) {
    return (
      <ThemedView style={styles.loadingContainer} accessibilityRole="progressbar" accessibilityLabel="Loading household">
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (!household) {
    return (
      <ThemedView style={styles.container}>
        <LoadErrorBanner message={loadError ?? 'This household could not be found.'} onRetry={load} />
      </ThemedView>
    );
  }

  const activeStudents = household.students.filter((s) => s.status === 'ACTIVE');

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ThemedText type="title">{household.displayName}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{household.status} · {household.schoolYear}</ThemedText>

      {household.notes ? (
        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="small" themeColor="textSecondary">{household.notes}</ThemedText>
        </ThemedView>
      ) : null}

      <Pressable
        style={styles.secondaryButton}
        onPress={() => router.push(`/admin-pta-households/${household.id}/edit`)}
        accessibilityRole="button"
        accessibilityLabel="Edit household"
      >
        <ThemedText type="link">Edit Household</ThemedText>
      </Pressable>

      <ThemedView style={styles.section}>
        <ThemedView style={styles.sectionHeaderRow}>
          <ThemedText type="subtitle">Adults</ThemedText>
          <Pressable onPress={() => setShowAddAdult((v) => !v)} accessibilityRole="button" accessibilityLabel="Add adult">
            <ThemedText type="link">{showAddAdult ? 'Cancel' : '+ Add'}</ThemedText>
          </Pressable>
        </ThemedView>

        {showAddAdult ? (
          <ThemedView type="backgroundElement" style={styles.card}>
            <TextInput style={styles.input} placeholder="Name" value={adultName} onChangeText={setAdultName} accessibilityLabel="Adult name" />
            <TextInput style={styles.input} placeholder="Email (optional)" value={adultEmail} onChangeText={setAdultEmail} accessibilityLabel="Adult email, optional" keyboardType="email-address" autoCapitalize="none" />
            <TextInput style={styles.input} placeholder="Phone (optional)" value={adultPhone} onChangeText={setAdultPhone} accessibilityLabel="Adult phone, optional" keyboardType="phone-pad" />
            <TextInput style={styles.input} placeholder="Relationship (optional)" value={adultRelationship} onChangeText={setAdultRelationship} accessibilityLabel="Adult relationship, optional" />
            <Pressable
              style={[styles.button, (!adultName.trim() || actionPending) && styles.buttonDisabled]}
              onPress={handleAddAdult}
              disabled={!adultName.trim() || actionPending}
              accessibilityRole="button"
              accessibilityLabel="Save adult"
              accessibilityState={{ disabled: !adultName.trim() || actionPending, busy: actionPending }}
            >
              {actionPending ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.buttonText}>Save Adult</ThemedText>}
            </Pressable>
          </ThemedView>
        ) : null}

        {household.adults.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">No adults on file.</ThemedText>
        ) : (
          household.adults.map((adult) => (
            <ThemedView key={adult.id} type="backgroundElement" style={styles.rowCard}>
              <ThemedView style={styles.rowCardText}>
                <ThemedText type="small">
                  {adult.name}
                  {adult.relationshipLabel ? ` · ${adult.relationshipLabel}` : ''}
                </ThemedText>
                {adult.email ? <ThemedText type="small" themeColor="textSecondary">{adult.email}</ThemedText> : null}
                {adult.userId ? <ThemedText type="small" style={styles.badge}>Has portal access</ThemedText> : null}
              </ThemedView>
              <Pressable onPress={() => confirmRemoveAdult(adult.id, adult.name)} accessibilityRole="button" accessibilityLabel={`Remove ${adult.name}`}>
                <ThemedText type="link" style={styles.dangerText}>Remove</ThemedText>
              </Pressable>
            </ThemedView>
          ))
        )}
      </ThemedView>

      <ThemedView style={styles.section}>
        <ThemedView style={styles.sectionHeaderRow}>
          <ThemedText type="subtitle">Students</ThemedText>
          <Pressable onPress={() => setShowAddStudent((v) => !v)} accessibilityRole="button" accessibilityLabel="Add student">
            <ThemedText type="link">{showAddStudent ? 'Cancel' : '+ Add'}</ThemedText>
          </Pressable>
        </ThemedView>

        {showAddStudent ? (
          <ThemedView type="backgroundElement" style={styles.card}>
            <TextInput style={styles.input} placeholder="Student name" value={studentName} onChangeText={setStudentName} accessibilityLabel="Student name" />
            <Pressable
              style={[styles.button, (!studentName.trim() || actionPending) && styles.buttonDisabled]}
              onPress={handleAddStudent}
              disabled={!studentName.trim() || actionPending}
              accessibilityRole="button"
              accessibilityLabel="Save student"
              accessibilityState={{ disabled: !studentName.trim() || actionPending, busy: actionPending }}
            >
              {actionPending ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.buttonText}>Save Student</ThemedText>}
            </Pressable>
          </ThemedView>
        ) : null}

        {activeStudents.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">No active students on file.</ThemedText>
        ) : (
          activeStudents.map((student) => (
            <ThemedView key={student.id} type="backgroundElement" style={styles.rowCard}>
              <ThemedText type="small">{student.displayName}</ThemedText>
              <Pressable onPress={() => confirmDeactivateStudent(student.id, student.displayName)} accessibilityRole="button" accessibilityLabel={`Deactivate ${student.displayName}`}>
                <ThemedText type="link" style={styles.dangerText}>Deactivate</ThemedText>
              </Pressable>
            </ThemedView>
          ))
        )}
      </ThemedView>

      {household.status !== 'INACTIVE' ? (
        <Pressable
          style={[styles.secondaryButtonDanger, actionPending && styles.buttonDisabled]}
          onPress={confirmDeactivate}
          disabled={actionPending}
          accessibilityRole="button"
          accessibilityLabel="Deactivate household"
          accessibilityState={{ disabled: actionPending, busy: actionPending }}
        >
          <ThemedText style={styles.dangerText}>Deactivate Household</ThemedText>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  section: {
    gap: Spacing.two,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
  },
  rowCard: {
    borderRadius: 10,
    padding: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  rowCardText: {
    flex: 1,
    gap: 2,
    backgroundColor: 'transparent',
  },
  badge: {
    color: '#047857',
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  button: {
    backgroundColor: '#047857',
    borderRadius: 10,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  secondaryButton: {
    minHeight: 44,
    justifyContent: 'center',
  },
  secondaryButtonDanger: {
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dangerText: {
    color: '#B42318',
    fontWeight: '600',
  },
});
