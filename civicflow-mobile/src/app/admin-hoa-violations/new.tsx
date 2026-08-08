import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { createAdminHoaViolation, getAdminHoaProperties, type AdminHoaPropertyListRow } from '@/lib/mobile-api';

function propertyLabel(property: AdminHoaPropertyListRow) {
  if (property.displayName) return property.displayName;
  return property.unitLabel ? `${property.addressLine1} · ${property.unitLabel}` : property.addressLine1;
}

/**
 * Mobile Admin program (PR E) — create an HOA violation draft. Uses the
 * exact same createViolationDraft() service the web /hoa/violations/new
 * form uses. Creates a DRAFT only — issuing (which sends the resident's
 * first notice) happens as a separate step on the detail screen.
 */
export default function AdminHoaViolationCreateScreen() {
  const { selectedOrganizationId } = useAuth();

  const [propertySearch, setPropertySearch] = useState('');
  const [propertyResults, setPropertyResults] = useState<AdminHoaPropertyListRow[]>([]);
  const [selectedProperty, setSelectedProperty] = useState<AdminHoaPropertyListRow | null>(null);
  const [violationType, setViolationType] = useState('');
  const [description, setDescription] = useState('');
  const [cureByDate, setCureByDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function searchProperties(query: string) {
    setPropertySearch(query);
    if (!selectedOrganizationId || query.trim().length < 2) {
      setPropertyResults([]);
      return;
    }
    try {
      const result = await getAdminHoaProperties(selectedOrganizationId, { search: query.trim() });
      setPropertyResults(result.properties.slice(0, 8));
    } catch {
      setPropertyResults([]);
    }
  }

  function validate(): string | null {
    if (!selectedProperty) return 'Select a property.';
    if (!violationType.trim()) return 'Violation type is required.';
    if (!description.trim()) return 'Description is required.';
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
      const created = await createAdminHoaViolation({
        organizationId: selectedOrganizationId,
        propertyId: selectedProperty!.id,
        violationType: violationType.trim(),
        description: description.trim(),
        cureByDate: cureByDate.trim() ? new Date(cureByDate.trim()).toISOString() : null,
      });
      router.replace(`/admin-hoa-violations/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to create this violation. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container}>
        <ThemedText type="title">New Violation</ThemedText>

        {selectedProperty ? (
          <ThemedView type="backgroundElement" style={styles.selectedRow}>
            <ThemedText type="smallBold">{propertyLabel(selectedProperty)}</ThemedText>
            <Pressable onPress={() => { setSelectedProperty(null); setPropertySearch(''); }} accessibilityRole="button" accessibilityLabel="Change property">
              <ThemedText type="link">Change</ThemedText>
            </Pressable>
          </ThemedView>
        ) : (
          <>
            <ThemedText type="small" themeColor="textSecondary">Property</ThemedText>
            <TextInput style={styles.input} placeholder="Search by address" value={propertySearch} onChangeText={searchProperties} accessibilityLabel="Search properties" />
            {propertyResults.map((property) => (
              <Pressable key={property.id} onPress={() => { setSelectedProperty(property); setPropertyResults([]); }} accessibilityRole="button" accessibilityLabel={propertyLabel(property)}>
                <ThemedView type="backgroundElement" style={styles.resultCard}>
                  <ThemedText type="small">{propertyLabel(property)}</ThemedText>
                </ThemedView>
              </Pressable>
            ))}
          </>
        )}

        <ThemedText type="small" themeColor="textSecondary">Violation Type</ThemedText>
        <TextInput style={styles.input} value={violationType} onChangeText={setViolationType} accessibilityLabel="Violation type" placeholder="e.g. Fence height" />

        <ThemedText type="small" themeColor="textSecondary">Description</ThemedText>
        <TextInput style={[styles.input, styles.multiline]} value={description} onChangeText={setDescription} accessibilityLabel="Description" multiline />

        <ThemedText type="small" themeColor="textSecondary">Cure-By Date (optional, YYYY-MM-DD)</ThemedText>
        <TextInput style={styles.input} value={cureByDate} onChangeText={setCureByDate} accessibilityLabel="Cure-by date, optional" />

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
          accessibilityLabel="Create violation"
          accessibilityState={{ disabled: submitting, busy: submitting }}
        >
          {submitting ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.buttonText}>Create Violation</ThemedText>}
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
  selectedRow: {
    borderRadius: 10,
    padding: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.two,
  },
  resultCard: {
    borderRadius: 10,
    padding: Spacing.two,
    marginBottom: 4,
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
