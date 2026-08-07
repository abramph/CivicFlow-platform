import { Redirect, router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet } from 'react-native';

import { LoadErrorBanner } from '@/components/load-error-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { getAdminEvents, type AdminEventListRow, type EventStatusValue } from '@/lib/mobile-api';

const STATUS_LABELS: Record<EventStatusValue, string> = {
  upcoming: 'Upcoming',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

function formatWhen(startAt: string | null) {
  if (!startAt) return 'No date set';
  return new Date(startAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * Mobile Admin program (PR C) — event list. Double-gated like every other
 * admin screen: the Admin tab already hides this entry point for a caller
 * without manageEvents, and this screen independently re-checks the same
 * server-resolved adminCapabilities array.
 */
export default function AdminEventsScreen() {
  const { selectedOrganization, selectedOrganizationId } = useAuth();
  const hasManageEvents = Boolean(selectedOrganization?.capability?.adminCapabilities?.includes('manageEvents'));

  const [events, setEvents] = useState<AdminEventListRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !hasManageEvents) return;
    try {
      setEvents(await getAdminEvents(selectedOrganizationId));
      setLoadError(null);
    } catch {
      setLoadError('Unable to load events. Check your connection and try again.');
    }
  }, [selectedOrganizationId, hasManageEvents]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (!selectedOrganizationId) {
    return <Redirect href="/org-switcher" />;
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

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
    >
      <ThemedView style={styles.headerRow}>
        <ThemedText type="title">Events</ThemedText>
        <Pressable
          style={styles.addButton}
          onPress={() => router.push('/admin-events/new')}
          accessibilityRole="button"
          accessibilityLabel="Add event"
        >
          <ThemedText style={styles.addButtonText}>+ Add</ThemedText>
        </Pressable>
      </ThemedView>

      <LoadErrorBanner message={loadError} onRetry={load} />

      {events.length === 0 && !loadError ? (
        <ThemedText type="small" themeColor="textSecondary">
          No events yet.
        </ThemedText>
      ) : (
        events.map((event) => (
          <Pressable
            key={event.id}
            onPress={() => router.push(`/admin-events/${event.id}`)}
            accessibilityRole="button"
            accessibilityLabel={event.title}
          >
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">{event.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {formatWhen(event.startAt)} · {STATUS_LABELS[event.status]}
              </ThemedText>
              {event.location ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {event.location}
                </ThemedText>
              ) : null}
            </ThemedView>
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.four,
    gap: Spacing.two,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
  },
  addButton: {
    backgroundColor: '#047857',
    borderRadius: 10,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    minHeight: 44,
    justifyContent: 'center',
  },
  addButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  card: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: 4,
  },
});
