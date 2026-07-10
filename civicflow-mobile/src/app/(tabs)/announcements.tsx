import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { getAnnouncements, type Announcement } from '@/lib/mobile-api';

export default function AnnouncementsScreen() {
  const { selectedOrganizationId } = useAuth();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!selectedOrganizationId) return;
    setAnnouncements(await getAnnouncements(selectedOrganizationId));
  }, [selectedOrganizationId]);

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
      <ThemedText type="title">Announcements</ThemedText>
      <FlatList
        data={announcements}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push(`/announcement/${item.id}`)}>
            <ThemedView type="backgroundElement" style={styles.row}>
              <ThemedView style={styles.rowHeader}>
                <ThemedText type={item.isRead ? 'small' : 'smallBold'}>{item.subject || item.title}</ThemedText>
                {!item.isRead ? <ThemedView style={styles.unreadDot} /> : null}
              </ThemedView>
              {item.sentAt ? (
                <ThemedText type="small" themeColor="textSecondary">{new Date(item.sentAt).toLocaleDateString()}</ThemedText>
              ) : null}
              <ThemedText type="default" numberOfLines={2} style={styles.body}>{item.body}</ThemedText>
            </ThemedView>
          </Pressable>
        )}
        ListEmptyComponent={
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            No announcements yet.
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
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#047857',
  },
  body: {
    marginTop: 4,
  },
  empty: {
    textAlign: 'center',
    marginTop: Spacing.five,
  },
});
