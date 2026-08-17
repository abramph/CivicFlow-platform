import { Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { getProfile, submitProfileUpdate, type ProfileUpdateFieldKey } from '@/lib/mobile-api';

/**
 * MEMBER-QR-J — "Profile → Update My Information," reusing the same Member
 * Intake submission/apply backend the public QR form uses (see
 * self-service.ts). Not every field the member types necessarily takes
 * effect immediately: a HIGH-sensitivity change (legal name, email) may
 * come back needing staff review even though the request itself succeeded.
 */

const FIELDS: { key: ProfileUpdateFieldKey; label: string; keyboardType?: 'email-address' | 'phone-pad' }[] = [
  { key: 'preferredName', label: 'Preferred name' },
  { key: 'phone', label: 'Phone', keyboardType: 'phone-pad' },
  { key: 'addressLine1', label: 'Address line 1' },
  { key: 'addressLine2', label: 'Address line 2' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'zipCode', label: 'ZIP code' },
];

// Identity-critical fields are on their own section with a note -- they're
// still submitted through the exact same form, but §16/§39's "translate
// internal state into human-readable language" applies here too: a member
// shouldn't be surprised that changing their legal name takes longer than
// changing their phone number.
const SENSITIVE_FIELDS: { key: ProfileUpdateFieldKey; label: string; keyboardType?: 'email-address' }[] = [
  { key: 'firstName', label: 'First name' },
  { key: 'lastName', label: 'Last name' },
  { key: 'email', label: 'Email', keyboardType: 'email-address' },
];

type Outcome = 'APPLIED' | 'REVIEW_REQUIRED' | null;

export default function ProfileEditScreen() {
  const { status, organizations, selectedOrganizationId } = useAuth();
  const [values, setValues] = useState<Partial<Record<ProfileUpdateFieldKey, string>>>({});
  const [initial, setInitial] = useState<Partial<Record<ProfileUpdateFieldKey, string>>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);

  useEffect(() => {
    if (!selectedOrganizationId) return;
    let cancelled = false;
    (async () => {
      const profile = await getProfile(selectedOrganizationId);
      if (cancelled) return;
      const loaded: Partial<Record<ProfileUpdateFieldKey, string>> = {
        firstName: profile.firstName,
        lastName: profile.lastName,
        preferredName: profile.preferredName ?? '',
        email: profile.email ?? '',
        phone: profile.phone ?? '',
        addressLine1: profile.addressLine1 ?? '',
        addressLine2: profile.addressLine2 ?? '',
        city: profile.city ?? '',
        state: profile.state ?? '',
        zipCode: profile.zipCode ?? '',
      };
      setValues(loaded);
      setInitial(loaded);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedOrganizationId]);

  if (status === 'signedOut') {
    return <Redirect href={{ pathname: '/login', params: { redirectTo: '/profile-edit' } }} />;
  }
  if (status === 'signedIn' && !selectedOrganizationId) {
    return <Redirect href="/org-switcher" />;
  }
  const selectedOrg = organizations.find((org) => org.organizationId === selectedOrganizationId);
  if (status === 'signedIn' && selectedOrg && !selectedOrg.memberId) {
    return <Redirect href="/profile" />;
  }

  function setField(key: ProfileUpdateFieldKey, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit() {
    if (!selectedOrganizationId) return;
    setError(null);
    setOutcome(null);

    // §17: only actually-changed fields are sent -- a blank/unchanged value
    // never risks clearing something on the server that the member simply
    // didn't touch on this screen.
    const changed: Partial<Record<ProfileUpdateFieldKey, string>> = {};
    for (const key of Object.keys(values) as ProfileUpdateFieldKey[]) {
      if (values[key] !== initial[key] && values[key]?.trim()) changed[key] = values[key]!.trim();
    }
    if (Object.keys(changed).length === 0) {
      setError('Change at least one field before submitting.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await submitProfileUpdate(selectedOrganizationId, changed);
      setOutcome(result.status);
      setInitial(values);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to submit your update.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container}>
        <ThemedText type="title">Update My Information</ThemedText>

        {outcome === 'APPLIED' ? (
          <ThemedView type="backgroundElement" style={styles.notice}>
            <ThemedText type="smallBold">Your information has been updated.</ThemedText>
          </ThemedView>
        ) : null}
        {outcome === 'REVIEW_REQUIRED' ? (
          <ThemedView type="backgroundElement" style={styles.notice}>
            <ThemedText type="smallBold">Thank you. Some of your changes need staff review before they take effect.</ThemedText>
          </ThemedView>
        ) : null}

        {FIELDS.map((field) => (
          <ThemedView key={field.key} style={styles.fieldGroup}>
            <ThemedText type="small" themeColor="textSecondary">{field.label}</ThemedText>
            <TextInput
              style={styles.input}
              value={values[field.key] ?? ''}
              onChangeText={(text) => setField(field.key, text)}
              keyboardType={field.keyboardType}
              accessibilityLabel={field.label}
            />
          </ThemedView>
        ))}

        <ThemedText type="smallBold" style={styles.sectionLabel}>Identity Information</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionNote}>
          Changes here may need staff review before they take effect.
        </ThemedText>
        {SENSITIVE_FIELDS.map((field) => (
          <ThemedView key={field.key} style={styles.fieldGroup}>
            <ThemedText type="small" themeColor="textSecondary">{field.label}</ThemedText>
            <TextInput
              style={styles.input}
              value={values[field.key] ?? ''}
              onChangeText={(text) => setField(field.key, text)}
              keyboardType={field.keyboardType}
              accessibilityLabel={field.label}
            />
          </ThemedView>
        ))}

        {error ? (
          <ThemedText type="small" style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            {error}
          </ThemedText>
        ) : null}

        <Pressable
          style={[styles.button, (submitting || loading) && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={submitting || loading}
          accessibilityRole="button"
          accessibilityLabel="Save changes"
          accessibilityState={{ disabled: submitting || loading, busy: submitting }}
        >
          {submitting ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.buttonText}>Save Changes</ThemedText>}
        </Pressable>

        <Pressable style={styles.secondaryButton} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Cancel">
          <ThemedText type="link">Cancel</ThemedText>
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
  notice: {
    borderRadius: 10,
    padding: Spacing.three,
    marginBottom: Spacing.two,
  },
  fieldGroup: {
    marginBottom: Spacing.two,
  },
  input: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  sectionLabel: {
    marginTop: Spacing.two,
  },
  sectionNote: {
    marginBottom: Spacing.two,
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
    marginTop: Spacing.two,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  secondaryButton: {
    alignItems: 'center',
    marginTop: Spacing.two,
  },
});
