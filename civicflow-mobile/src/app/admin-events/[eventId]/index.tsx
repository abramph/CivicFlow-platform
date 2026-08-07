import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet } from 'react-native';

import { LoadErrorBanner } from '@/components/load-error-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { getAdminEvent, updateAdminEvent, type AdminEventDetail, type EventStatusValue } from '@/lib/mobile-api';

const STATUS_LABELS: Record<EventStatusValue, string> = {
  upcoming: 'Upcoming',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/**
 * Mobile Admin program (PR C) — event detail. Re-fetches by (eventId,
 * organizationId) on every mount, never trusts navigation params. Cancel
 * is PATCH { status: "cancelled" } -- there's no separate cancel route on
 * the web side either.
 */
export default function AdminEventDetailScreen() {
  const { selectedOrganization, selectedOrganizationId } = useAuth();
  const hasManageEvents = Boolean(selectedOrganization?.capability?.adminCapabilities?.includes('manageEvents'));
  const hasManageAttendance = Boolean(selectedOrganization?.capability?.adminCapabilities?.includes('manageAttendance'));
  const { eventId } = useLocalSearchParams<{ eventId: string }>();

  const [event, setEvent] = useState<AdminEventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !eventId || !hasManageEvents) return;
    try {
      setEvent(await getAdminEvent(selectedOrganizationId, eventId));
      setLoadError(null);
    } catch (error) {
      setEvent(null);
      setLoadError(error instanceof ApiError && error.status === 404 ? 'This event could not be found.' : 'Unable to load this event. Check your connection and try again.');
    }
  }, [selectedOrganizationId, eventId, hasManageEvents]);

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

  function confirmCancel() {
    Alert.alert('Cancel this event?', 'This marks the event as cancelled. Historical records are preserved.', [
      { text: 'Keep Event', style: 'cancel' },
      { text: 'Cancel Event', style: 'destructive', onPress: handleCancel },
    ]);
  }

  async function handleCancel() {
    if (!selectedOrganizationId || !eventId || cancelling) return;
    setCancelling(true);
    try {
      await updateAdminEvent(eventId, { organizationId: selectedOrganizationId, status: 'cancelled' });
      await load();
    } catch (error) {
      Alert.alert('Unable to cancel', error instanceof ApiError ? error.message : 'Please try again.');
    } finally {
      setCancelling(false);
    }
  }

  if (!hasManageEvents) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText type="subtitle" themeColor="textSecondary">
          You don&apos;t have event administration access for this organization.
        </ThemedText>
      </ThemedView>
    );
  }

  if (loading) {
    return (
      <ThemedView style={styles.loadingContainer} accessibilityRole="progressbar" accessibilityLabel="Loading event">
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (!event) {
    return (
      <ThemedView style={styles.container}>
        <LoadErrorBanner message={loadError ?? 'This event could not be found.'} onRetry={load} />
      </ThemedView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ThemedText type="title">{event.title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {STATUS_LABELS[event.status]}
      </ThemedText>

      <ThemedView type="backgroundElement" style={styles.card}>
        {event.startAt ? (
          <ThemedText type="default">
            {new Date(event.startAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
          </ThemedText>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">No date set</ThemedText>
        )}
        {event.location ? <ThemedText type="default">{event.location}</ThemedText> : null}
        {event.description ? (
          <ThemedText type="small" themeColor="textSecondary">
            {event.description}
          </ThemedText>
        ) : null}
      </ThemedView>

      <Pressable
        style={styles.secondaryButton}
        onPress={() => router.push(`/admin-events/${event.id}/edit`)}
        accessibilityRole="button"
        accessibilityLabel="Edit event"
      >
        <ThemedText type="link">Edit Event</ThemedText>
      </Pressable>

      {hasManageAttendance ? (
        <Pressable
          style={styles.button}
          onPress={() => router.push(`/admin-events/${event.id}/attendance-session`)}
          accessibilityRole="button"
          accessibilityLabel="Manage attendance"
        >
          <ThemedText style={styles.buttonPrimaryText}>Manage Check-In / Attendance</ThemedText>
        </Pressable>
      ) : null}

      {event.status !== 'cancelled' ? (
        <Pressable
          style={styles.secondaryButtonDanger}
          onPress={confirmCancel}
          disabled={cancelling}
          accessibilityRole="button"
          accessibilityLabel="Cancel event"
          accessibilityState={{ disabled: cancelling, busy: cancelling }}
        >
          <ThemedText style={styles.dangerText}>{cancelling ? 'Cancelling…' : 'Cancel Event'}</ThemedText>
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
    gap: 6,
  },
  button: {
    backgroundColor: '#047857',
    borderRadius: 10,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  buttonPrimaryText: {
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
  },
  dangerText: {
    color: '#B42318',
    fontWeight: '600',
  },
});
