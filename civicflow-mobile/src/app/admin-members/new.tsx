import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { createAdminMember } from '@/lib/mobile-api';

/**
 * Mobile Admin program (PR B) — create member. Uses the exact same
 * createMember() service and createMemberSchema the web /members/new form
 * uses (civicflow-portal src/lib/member-mutations.ts) via
 * POST /api/mobile/admin/members — server validation is authoritative;
 * this screen only validates for usability. Only first/last name are
 * required, matching the web form and the underlying schema.
 */
export default function AdminMemberCreateScreen() {
  const { selectedOrganizationId } = useAuth();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function validate(): string | null {
    if (!firstName.trim()) return 'First name is required.';
    if (!lastName.trim()) return 'Last name is required.';
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) return 'Enter a valid email address.';
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
      const created = await createAdminMember({
        organizationId: selectedOrganizationId,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        city: city.trim() || undefined,
        state: state.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      router.replace(`/admin-members/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to create this member. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container}>
        <ThemedText type="title">Add Member</ThemedText>

        <ThemedText type="small" themeColor="textSecondary">First Name</ThemedText>
        <TextInput style={styles.input} value={firstName} onChangeText={setFirstName} accessibilityLabel="First name" autoCapitalize="words" />

        <ThemedText type="small" themeColor="textSecondary">Last Name</ThemedText>
        <TextInput style={styles.input} value={lastName} onChangeText={setLastName} accessibilityLabel="Last name" autoCapitalize="words" />

        <ThemedText type="small" themeColor="textSecondary">Email (optional)</ThemedText>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          accessibilityLabel="Email, optional"
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <ThemedText type="small" themeColor="textSecondary">Phone (optional)</ThemedText>
        <TextInput style={styles.input} value={phone} onChangeText={setPhone} accessibilityLabel="Phone, optional" keyboardType="phone-pad" />

        <ThemedText type="small" themeColor="textSecondary">City (optional)</ThemedText>
        <TextInput style={styles.input} value={city} onChangeText={setCity} accessibilityLabel="City, optional" />

        <ThemedText type="small" themeColor="textSecondary">State (optional)</ThemedText>
        <TextInput style={styles.input} value={state} onChangeText={setState} accessibilityLabel="State, optional" />

        <ThemedText type="small" themeColor="textSecondary">Notes (optional)</ThemedText>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={notes}
          onChangeText={setNotes}
          accessibilityLabel="Notes, optional"
          multiline
        />

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
          accessibilityLabel="Create member"
          accessibilityState={{ disabled: submitting, busy: submitting }}
        >
          {submitting ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.buttonText}>Create Member</ThemedText>}
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
    marginTop: Spacing.two,
    minHeight: 44,
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
});
