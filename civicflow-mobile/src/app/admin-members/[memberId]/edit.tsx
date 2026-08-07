import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { getAdminMember, updateAdminMember } from '@/lib/mobile-api';

/**
 * Mobile Admin program (PR B) — edit member. Always prepopulates from a
 * fresh GET (never from data passed through navigation params) so a stale
 * list-screen snapshot can never silently overwrite a change someone else
 * made in between. Status is not editable here -- terminate/reinstate on
 * the detail screen are the only status actions PR B exposes on mobile.
 */
export default function AdminMemberEditScreen() {
  const { selectedOrganizationId } = useAuth();
  const { memberId } = useLocalSearchParams<{ memberId: string }>();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !memberId) return;
    try {
      const member = await getAdminMember(selectedOrganizationId, memberId);
      setFirstName(member.firstName);
      setLastName(member.lastName);
      setEmail(member.email ?? '');
      setPhone(member.phone ?? '');
      setCity(member.city ?? '');
      setState(member.state ?? '');
      setNotes(member.notes ?? '');
      setLoadError(null);
    } catch {
      setLoadError('Unable to load this member. Check your connection and try again.');
    }
  }, [selectedOrganizationId, memberId]);

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

  function markDirty<T>(setter: (value: T) => void) {
    return (value: T) => {
      setDirty(true);
      setter(value);
    };
  }

  function validate(): string | null {
    if (!firstName.trim()) return 'First name is required.';
    if (!lastName.trim()) return 'Last name is required.';
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) return 'Enter a valid email address.';
    return null;
  }

  function handleCancel() {
    if (!dirty) {
      router.back();
      return;
    }
    Alert.alert('Discard changes?', 'You have unsaved changes that will be lost.', [
      { text: 'Keep Editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => router.back() },
    ]);
  }

  async function handleSubmit() {
    if (!selectedOrganizationId || !memberId || submitting) return;
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await updateAdminMember(memberId, {
        organizationId: selectedOrganizationId,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        city: city.trim() || null,
        state: state.trim() || null,
        notes: notes.trim() || null,
      });
      router.replace(`/admin-members/${memberId}`);
    } catch (err) {
      // Preserve entered form data on failure -- do not reset any field here.
      setError(err instanceof ApiError ? err.message : 'Unable to save changes. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <ThemedView style={styles.loadingContainer} accessibilityRole="progressbar" accessibilityLabel="Loading member">
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (loadError) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText type="small" style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">
          {loadError}
        </ThemedText>
        <Pressable style={styles.button} onPress={load} accessibilityRole="button" accessibilityLabel="Retry">
          <ThemedText style={styles.buttonText}>Retry</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container}>
        <ThemedText type="title">Edit Member</ThemedText>

        <ThemedText type="small" themeColor="textSecondary">First Name</ThemedText>
        <TextInput style={styles.input} value={firstName} onChangeText={markDirty(setFirstName)} accessibilityLabel="First name" autoCapitalize="words" />

        <ThemedText type="small" themeColor="textSecondary">Last Name</ThemedText>
        <TextInput style={styles.input} value={lastName} onChangeText={markDirty(setLastName)} accessibilityLabel="Last name" autoCapitalize="words" />

        <ThemedText type="small" themeColor="textSecondary">Email</ThemedText>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={markDirty(setEmail)}
          accessibilityLabel="Email"
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <ThemedText type="small" themeColor="textSecondary">Phone</ThemedText>
        <TextInput style={styles.input} value={phone} onChangeText={markDirty(setPhone)} accessibilityLabel="Phone" keyboardType="phone-pad" />

        <ThemedText type="small" themeColor="textSecondary">City</ThemedText>
        <TextInput style={styles.input} value={city} onChangeText={markDirty(setCity)} accessibilityLabel="City" />

        <ThemedText type="small" themeColor="textSecondary">State</ThemedText>
        <TextInput style={styles.input} value={state} onChangeText={markDirty(setState)} accessibilityLabel="State" />

        <ThemedText type="small" themeColor="textSecondary">Notes</ThemedText>
        <TextInput style={[styles.input, styles.multiline]} value={notes} onChangeText={markDirty(setNotes)} accessibilityLabel="Notes" multiline />

        {error ? (
          <ThemedText type="small" style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            {error}
          </ThemedText>
        ) : null}

        <ThemedView style={styles.actionRow}>
          <Pressable style={styles.secondaryButton} onPress={handleCancel} accessibilityRole="button" accessibilityLabel="Cancel">
            <ThemedText type="link">Cancel</ThemedText>
          </Pressable>
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
        </ThemedView>
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
  error: {
    color: '#B42318',
    marginBottom: Spacing.two,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'transparent',
    marginTop: Spacing.two,
  },
  secondaryButton: {
    minHeight: 44,
    justifyContent: 'center',
  },
  button: {
    backgroundColor: '#047857',
    borderRadius: 10,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
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
