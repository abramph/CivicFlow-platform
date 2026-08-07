import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { getAdminEvent, updateAdminEvent } from '@/lib/mobile-api';

/**
 * Mobile Admin program (PR C) — edit event. Always prepopulates from a
 * fresh GET, never from navigation params. Status is editable here too
 * (upcoming/in_progress/completed), but "cancelled" is handled by the
 * dedicated Cancel action on the detail screen for a clearer confirmation
 * step, matching the web CancelEventButton's separation from the generic
 * edit form.
 */
export default function AdminEventEditScreen() {
  const { selectedOrganizationId } = useAuth();
  const { eventId } = useLocalSearchParams<{ eventId: string }>();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !eventId) return;
    try {
      const event = await getAdminEvent(selectedOrganizationId, eventId);
      setTitle(event.title);
      setLocation(event.location ?? '');
      setDescription(event.description ?? '');
      setLoadError(null);
    } catch {
      setLoadError('Unable to load this event. Check your connection and try again.');
    }
  }, [selectedOrganizationId, eventId]);

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
    if (!selectedOrganizationId || !eventId || submitting) return;
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await updateAdminEvent(eventId, {
        organizationId: selectedOrganizationId,
        title: title.trim(),
        location: location.trim() || null,
        description: description.trim() || null,
      });
      router.replace(`/admin-events/${eventId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to save changes. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <ThemedView style={styles.loadingContainer} accessibilityRole="progressbar" accessibilityLabel="Loading event">
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
        <ThemedText type="title">Edit Event</ThemedText>

        <ThemedText type="small" themeColor="textSecondary">Title</ThemedText>
        <TextInput style={styles.input} value={title} onChangeText={markDirty(setTitle)} accessibilityLabel="Title" />

        <ThemedText type="small" themeColor="textSecondary">Location</ThemedText>
        <TextInput style={styles.input} value={location} onChangeText={markDirty(setLocation)} accessibilityLabel="Location" />

        <ThemedText type="small" themeColor="textSecondary">Description</ThemedText>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={description}
          onChangeText={markDirty(setDescription)}
          accessibilityLabel="Description"
          multiline
        />

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
