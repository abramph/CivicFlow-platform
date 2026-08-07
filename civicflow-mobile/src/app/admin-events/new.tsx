import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { createAdminEvent, type EventStatusValue } from '@/lib/mobile-api';

const STATUS_OPTIONS: { value: EventStatusValue; label: string }[] = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

function todayIsoDateTime() {
  return new Date().toISOString().slice(0, 16);
}

/**
 * Mobile Admin program (PR C) — create event. Uses the exact same
 * createEvent() service and validation the web /events/new form uses
 * (civicflow-portal src/lib/event-mutations.ts) via POST
 * /api/mobile/admin/events.
 */
export default function AdminEventCreateScreen() {
  const { selectedOrganizationId } = useAuth();

  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [startAt, setStartAt] = useState(todayIsoDateTime());
  const [endAt, setEndAt] = useState('');
  const [status, setStatus] = useState<EventStatusValue>('upcoming');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function validate(): string | null {
    if (!title.trim()) return 'Title is required.';
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
      const created = await createAdminEvent({
        organizationId: selectedOrganizationId,
        title: title.trim(),
        location: location.trim() || undefined,
        description: description.trim() || undefined,
        startAt: startAt ? new Date(startAt).toISOString() : undefined,
        endAt: endAt ? new Date(endAt).toISOString() : undefined,
        status,
      });
      router.replace(`/admin-events/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to create this event. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container}>
        <ThemedText type="title">Add Event</ThemedText>

        <ThemedText type="small" themeColor="textSecondary">Title</ThemedText>
        <TextInput style={styles.input} value={title} onChangeText={setTitle} accessibilityLabel="Title" />

        <ThemedText type="small" themeColor="textSecondary">Location (optional)</ThemedText>
        <TextInput style={styles.input} value={location} onChangeText={setLocation} accessibilityLabel="Location, optional" />

        <ThemedText type="small" themeColor="textSecondary">Start (YYYY-MM-DDTHH:MM)</ThemedText>
        <TextInput style={styles.input} value={startAt} onChangeText={setStartAt} accessibilityLabel="Start date and time" placeholder={todayIsoDateTime()} />

        <ThemedText type="small" themeColor="textSecondary">End (optional)</ThemedText>
        <TextInput style={styles.input} value={endAt} onChangeText={setEndAt} accessibilityLabel="End date and time, optional" />

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
              <ThemedText type="small" style={option.value === status ? styles.chipTextSelected : undefined}>
                {option.label}
              </ThemedText>
            </Pressable>
          ))}
        </ThemedView>

        <ThemedText type="small" themeColor="textSecondary">Description (optional)</ThemedText>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={description}
          onChangeText={setDescription}
          accessibilityLabel="Description, optional"
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
          accessibilityLabel="Create event"
          accessibilityState={{ disabled: submitting, busy: submitting }}
        >
          {submitting ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.buttonText}>Create Event</ThemedText>}
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
