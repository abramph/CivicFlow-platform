import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { LoadErrorBanner } from '@/components/load-error-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { getAdminPtaHousehold, updateAdminPtaHousehold, type PtaHouseholdStatus } from '@/lib/mobile-api';

const STATUS_OPTIONS: { value: PtaHouseholdStatus; label: string }[] = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'INACTIVE', label: 'Inactive' },
];

/** Mobile Admin program (PR E) — edit a PTA household. School year is immutable post-creation, matching the web edit form exactly. */
export default function AdminPtaHouseholdEditScreen() {
  const { selectedOrganizationId } = useAuth();
  const { householdId } = useLocalSearchParams<{ householdId: string }>();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [status, setStatus] = useState<PtaHouseholdStatus>('ACTIVE');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !householdId) return;
    try {
      const household = await getAdminPtaHousehold(selectedOrganizationId, householdId);
      setDisplayName(household.displayName);
      setStatus(household.status);
      setNotes(household.notes ?? '');
      setLoadError(null);
    } catch {
      setLoadError('Unable to load this household. Check your connection and try again.');
    }
  }, [selectedOrganizationId, householdId]);

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

  async function handleSubmit() {
    if (!selectedOrganizationId || !householdId || submitting) return;
    if (!displayName.trim()) {
      setError('Household name is required.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await updateAdminPtaHousehold(householdId, {
        organizationId: selectedOrganizationId,
        displayName: displayName.trim(),
        status,
        notes: notes.trim() || null,
      });
      router.replace(`/admin-pta-households/${householdId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to save changes. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <ThemedView style={styles.loadingContainer} accessibilityRole="progressbar" accessibilityLabel="Loading household">
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (loadError) {
    return (
      <ThemedView style={styles.container}>
        <LoadErrorBanner message={loadError} onRetry={load} />
      </ThemedView>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container}>
        <ThemedText type="title">Edit Household</ThemedText>

        <ThemedText type="small" themeColor="textSecondary">Household Name</ThemedText>
        <TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} accessibilityLabel="Household name" autoCapitalize="words" />

        <ThemedText type="small" themeColor="textSecondary">Status</ThemedText>
        <ThemedView style={styles.chipRow} accessibilityRole="radiogroup" accessibilityLabel="Status">
          {STATUS_OPTIONS.map((option) => (
            <Pressable
              key={option.value}
              style={[styles.chip, option.value === status && styles.chipSelected]}
              onPress={() => setStatus(option.value)}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ selected: option.value === status }}
            >
              <ThemedText type="small" style={option.value === status ? styles.chipTextSelected : undefined}>{option.label}</ThemedText>
            </Pressable>
          ))}
        </ThemedView>

        <ThemedText type="small" themeColor="textSecondary">Notes</ThemedText>
        <TextInput style={[styles.input, styles.multiline]} value={notes} onChangeText={setNotes} accessibilityLabel="Notes" multiline />

        {error ? (
          <ThemedText type="small" style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            {error}
          </ThemedText>
        ) : null}

        <Pressable
          style={[styles.button, submitting && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel="Save changes"
          accessibilityState={{ disabled: submitting, busy: submitting }}
        >
          {submitting ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.buttonText}>Save Changes</ThemedText>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.four,
    gap: Spacing.two,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
    marginBottom: Spacing.two,
  },
  multiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginBottom: Spacing.two,
  },
  chip: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  chipSelected: {
    backgroundColor: '#047857',
    borderColor: '#047857',
  },
  chipTextSelected: {
    color: '#fff',
  },
  error: {
    color: '#B42318',
    marginBottom: Spacing.two,
  },
  button: {
    backgroundColor: '#047857',
    borderRadius: 10,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
    marginTop: Spacing.two,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
});
