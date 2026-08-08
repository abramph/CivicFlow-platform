import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { createAdminPtaHousehold } from '@/lib/mobile-api';

function currentSchoolYear() {
  const now = new Date();
  const startYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return `${startYear}-${startYear + 1}`;
}

/**
 * Mobile Admin program (PR E) — create a PTA household. Uses the exact same
 * createPtaHousehold() service the web /labs/pta/households/new form uses.
 * Matches the web form's exact field set (displayName, schoolYear, notes) —
 * status/volunteerInterests aren't exposed on create there either.
 */
export default function AdminPtaHouseholdCreateScreen() {
  const { selectedOrganizationId } = useAuth();

  const [displayName, setDisplayName] = useState('');
  const [schoolYear, setSchoolYear] = useState(currentSchoolYear());
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function validate(): string | null {
    if (!displayName.trim()) return 'Household name is required.';
    if (!schoolYear.trim()) return 'School year is required.';
    return null;
  }

  async function handleSubmit() {
    if (!selectedOrganizationId || submitting) return;
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const created = await createAdminPtaHousehold({
        organizationId: selectedOrganizationId,
        displayName: displayName.trim(),
        schoolYear: schoolYear.trim(),
        notes: notes.trim() || null,
      });
      router.replace(`/admin-pta-households/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to create this household. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container}>
        <ThemedText type="title">New Household</ThemedText>

        <ThemedText type="small" themeColor="textSecondary">Household Name</ThemedText>
        <TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} accessibilityLabel="Household name" autoCapitalize="words" />

        <ThemedText type="small" themeColor="textSecondary">School Year</ThemedText>
        <TextInput style={styles.input} value={schoolYear} onChangeText={setSchoolYear} accessibilityLabel="School year" placeholder="2026-2027" />

        <ThemedText type="small" themeColor="textSecondary">Notes (optional)</ThemedText>
        <TextInput style={[styles.input, styles.multiline]} value={notes} onChangeText={setNotes} accessibilityLabel="Notes, optional" multiline />

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
          accessibilityLabel="Create household"
          accessibilityState={{ disabled: submitting, busy: submitting }}
        >
          {submitting ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.buttonText}>Create Household</ThemedText>}
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
