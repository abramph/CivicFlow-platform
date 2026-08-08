import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet } from 'react-native';

import { LoadErrorBanner } from '@/components/load-error-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useScreenTopPadding } from '@/hooks/use-screen-top-padding';
import { useAuth } from '@/lib/auth-context';
import { getAnnouncementsForIdentity, type Announcement } from '@/lib/mobile-api';

export default function AnnouncementsScreen() {
  const { selectedOrganization, selectedOrganizationId } = useAuth();
  const hasMemberIdentity = Boolean(selectedOrganization?.memberId);
  const hasPtaIdentity = Boolean(selectedOrganization?.pta?.householdAdultId);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedOrganizationId || (!hasMemberIdentity && !hasPtaIdentity)) return;
    try {
      setAnnouncements(await getAnnouncementsForIdentity(selectedOrganizationId, hasMemberIdentity));
      setLoadError(null);
    } catch {
      setLoadError('Unable to load announcements. Check your connection and try again.');
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
      <ThemedText type="title">Announcements</ThemedText>
      <LoadErrorBanner message={loadError} onRetry={load} />
      <FlatList
        data={announcements}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/announcement/${item.id}`)}
            accessibilityRole="button"
            accessibilityLabel={`${item.isRead ? '' : 'Unread, '}${item.subject || item.title}${item.sentAt ? `, ${new Date(item.sentAt).toLocaleDateString()}` : ''}`}
          >
            <ThemedView type="backgroundElement" style={styles.row}>
              <ThemedView style={styles.rowHeader}>
                <ThemedText type={item.isRead ? 'small' : 'smallBold'}>{item.subject || item.title}</ThemedText>
                {!item.isRead ? <ThemedView style={styles.unreadDot} accessibilityElementsHidden importantForAccessibility="no" /> : null}
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
