import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet } from 'react-native';

import { LoadErrorBanner } from '@/components/load-error-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { getMeetingsForOrganization, type MobileMeeting } from '@/lib/mobile-api';

export default function MeetingsScreen() {
  const { selectedOrganization, selectedOrganizationId } = useAuth();
  const hasMemberIdentity = Boolean(selectedOrganization?.memberId);
  const [meetings, setMeetings] = useState<MobileMeeting[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Meetings are readable with ANY active org tie (same visibility model as
  // events); the per-meeting rsvp block says whether this caller can respond.
  const load = useCallback(async () => {
    if (!selectedOrganizationId) return;
    try {
      setMeetings(
        await getMeetingsForOrganization(selectedOrganizationId, selectedOrganization?.capability?.rsvp, hasMemberIdentity)
      );
      setLoadError(null);
    } catch {
      setLoadError('Unable to load meetings. Check your connection and try again.');
    }
  }, [selectedOrganizationId, selectedOrganization?.capability?.rsvp, hasMemberIdentity]);

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

  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title">Meetings</ThemedText>
      <LoadErrorBanner message={loadError} onRetry={load} />
      <FlatList
        data={meetings}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.navigate(`/meeting/${item.id}`)}
            accessibilityRole="button"
            accessibilityLabel={`${item.title}, ${new Date(item.meetingDate).toLocaleString()}${item.location ? `, ${item.location}` : ''}${item.rsvp?.response ? `, you're ${item.rsvp.response.status.replace('_', ' ').toLowerCase()}` : ''}`}
          >
            <ThemedView type="backgroundElement" style={styles.row}>
              <ThemedText type="smallBold">{item.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {new Date(item.meetingDate).toLocaleString()}
                {item.location ? ` · ${item.location}` : ''}
              </ThemedText>
              {item.meetingType ? (
                <ThemedText type="small" themeColor="textSecondary">{item.meetingType}</ThemedText>
              ) : null}
              {item.rsvp?.response ? (
                <ThemedText type="small" style={styles.rsvpBadge}>You&apos;re {item.rsvp.response.status.replace('_', ' ').toLowerCase()}</ThemedText>
              ) : null}
            </ThemedView>
          </Pressable>
        )}
        ListEmptyComponent={
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            No upcoming meetings.
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
  list: {
    gap: Spacing.two,
  },
  row: {
    borderRadius: 10,
    padding: Spacing.three,
    gap: 4,
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
