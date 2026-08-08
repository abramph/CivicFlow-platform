import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet } from 'react-native';

import { LoadErrorBanner } from '@/components/load-error-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useScreenTopPadding } from '@/hooks/use-screen-top-padding';
import { useAuth } from '@/lib/auth-context';
import { getEventsForIdentity, type MobileEvent, type PtaEvent } from '@/lib/mobile-api';

export default function EventsScreen() {
  const { selectedOrganization, selectedOrganizationId } = useAuth();
  const hasMemberIdentity = Boolean(selectedOrganization?.memberId);
  const hasPtaIdentity = Boolean(selectedOrganization?.pta?.householdAdultId);
  const [events, setEvents] = useState<(MobileEvent | PtaEvent)[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedOrganizationId || (!hasMemberIdentity && !hasPtaIdentity)) return;
    try {
      setEvents(await getEventsForIdentity(selectedOrganizationId, hasMemberIdentity));
      setLoadError(null);
    } catch {
      setLoadError('Unable to load events. Check your connection and try again.');
    }
  }, [selectedOrganizationId, hasMemberIdentity, hasPtaIdentity]);

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

  const topPadding = useScreenTopPadding();

  return (
    <ThemedView style={[styles.container, topPadding]}>
      <ThemedText type="title">Events</ThemedText>
      <LoadErrorBanner message={loadError} onRetry={load} />
      {hasMemberIdentity ? (
        <Pressable
          style={styles.scanButton}
          onPress={() => router.push('/attendance-scan')}
          accessibilityRole="button"
          accessibilityLabel="Scan attendance code"
        >
          <ThemedText style={styles.scanButtonText}>Scan Attendance Code</ThemedText>
        </Pressable>
      ) : null}
      <FlatList
        data={events}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/event/${item.id}`)}
            accessibilityRole="button"
            accessibilityLabel={`${item.title}, ${item.startAt ? new Date(item.startAt).toLocaleString() : 'date TBD'}${item.location ? `, ${item.location}` : ''}${'myRsvp' in item && item.myRsvp ? `, you're ${item.myRsvp.status.replace('_', ' ').toLowerCase()}` : ''}`}
          >
            <ThemedView type="backgroundElement" style={styles.row}>
              <ThemedText type="smallBold">{item.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {item.startAt ? new Date(item.startAt).toLocaleString() : 'Date TBD'}
                {item.location ? ` · ${item.location}` : ''}
              </ThemedText>
              {item.description ? (
                <ThemedText type="default" numberOfLines={2} style={styles.body}>{item.description}</ThemedText>
              ) : null}
              {'myRsvp' in item && item.myRsvp ? (
                <ThemedText type="small" style={styles.rsvpBadge}>You&apos;re {item.myRsvp.status.replace('_', ' ').toLowerCase()}</ThemedText>
              ) : null}
            </ThemedView>
          </Pressable>
        )}
        ListEmptyComponent={
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            No upcoming events.
          </ThemedText>
        }
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  scanButton: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 10,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  scanButtonText: {
    fontWeight: '600',
  },
  list: {
    gap: Spacing.two,
  },
  row: {
    borderRadius: 10,
    padding: Spacing.three,
    gap: 4,
  },
  body: {
    marginTop: 4,
  },
  rsvpBadge: {
    color: '#047857',
    marginTop: 2,
  },
  empty: {
    textAlign: 'center',
    marginTop: Spacing.five,
  },
});
