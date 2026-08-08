import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { createAdminHoaProperty, type HoaPropertyType } from '@/lib/mobile-api';

const PROPERTY_TYPES: { value: HoaPropertyType; label: string }[] = [
  { value: 'SINGLE_FAMILY', label: 'Single Family' },
  { value: 'CONDO_UNIT', label: 'Condo Unit' },
  { value: 'TOWNHOME', label: 'Townhome' },
  { value: 'VACANT_LOT', label: 'Vacant Lot' },
  { value: 'COMMON_PROPERTY', label: 'Common Property' },
  { value: 'OTHER', label: 'Other' },
];

/** Mobile Admin program (PR E) — create an HOA property. Uses the exact same createProperty() service the web /hoa/properties/new form uses. */
export default function AdminHoaPropertyCreateScreen() {
  const { selectedOrganizationId } = useAuth();

  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zipCode, setZipCode] = useState('');
  const [unitLabel, setUnitLabel] = useState('');
  const [propertyType, setPropertyType] = useState<HoaPropertyType>('SINGLE_FAMILY');
  const [displayName, setDisplayName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!selectedOrganizationId || submitting) return;
    if (!addressLine1.trim()) {
      setError('Street address is required.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const created = await createAdminHoaProperty({
        organizationId: selectedOrganizationId,
        addressLine1: addressLine1.trim(),
        addressLine2: addressLine2.trim() || null,
        city: city.trim() || null,
        state: state.trim() || null,
        zipCode: zipCode.trim() || null,
        unitLabel: unitLabel.trim() || null,
        propertyType,
        displayName: displayName.trim() || null,
      });
      router.replace(`/admin-hoa-properties/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to create this property. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container}>
        <ThemedText type="title">New Property</ThemedText>

        <ThemedText type="small" themeColor="textSecondary">Street Address</ThemedText>
        <TextInput style={styles.input} value={addressLine1} onChangeText={setAddressLine1} accessibilityLabel="Street address" />

        <ThemedText type="small" themeColor="textSecondary">Address Line 2 (optional)</ThemedText>
        <TextInput style={styles.input} value={addressLine2} onChangeText={setAddressLine2} accessibilityLabel="Address line 2, optional" />

        <ThemedText type="small" themeColor="textSecondary">Unit / Lot Label (optional)</ThemedText>
        <TextInput style={styles.input} value={unitLabel} onChangeText={setUnitLabel} accessibilityLabel="Unit label, optional" placeholder="e.g. Unit 4B" />

        <ThemedText type="small" themeColor="textSecondary">City (optional)</ThemedText>
        <TextInput style={styles.input} value={city} onChangeText={setCity} accessibilityLabel="City, optional" />

        <ThemedText type="small" themeColor="textSecondary">State (optional)</ThemedText>
        <TextInput style={styles.input} value={state} onChangeText={setState} accessibilityLabel="State, optional" />

        <ThemedText type="small" themeColor="textSecondary">ZIP Code (optional)</ThemedText>
        <TextInput style={styles.input} value={zipCode} onChangeText={setZipCode} accessibilityLabel="ZIP code, optional" keyboardType="number-pad" />

        <ThemedText type="small" themeColor="textSecondary">Property Type</ThemedText>
        <ThemedView style={styles.chipRow} accessibilityRole="radiogroup" accessibilityLabel="Property type">
          {PROPERTY_TYPES.map((option) => (
            <Pressable
              key={option.value}
              style={[styles.chip, option.value === propertyType && styles.chipSelected]}
              onPress={() => setPropertyType(option.value)}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ selected: option.value === propertyType }}
            >
              <ThemedText type="small" style={option.value === propertyType ? styles.chipTextSelected : undefined}>{option.label}</ThemedText>
            </Pressable>
          ))}
        </ThemedView>

        <ThemedText type="small" themeColor="textSecondary">Display Name (optional)</ThemedText>
        <TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} accessibilityLabel="Display name, optional" placeholder="e.g. Clubhouse" />

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
          accessibilityLabel="Create property"
          accessibilityState={{ disabled: submitting, busy: submitting }}
        >
          {submitting ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.buttonText}>Create Property</ThemedText>}
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
