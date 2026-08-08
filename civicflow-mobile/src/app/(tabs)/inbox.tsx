import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet } from 'react-native';

import { LoadErrorBanner } from '@/components/load-error-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useScreenTopPadding } from '@/hooks/use-screen-top-padding';
import { useAuth } from '@/lib/auth-context';
import { getConversations, type ConversationSummary } from '@/lib/mobile-api';

const POLL_INTERVAL_MS = 20_000;

function otherParticipantNames(conversation: ConversationSummary) {
  return conversation.otherParticipants.map((p) => p.displayName).join(', ') || 'Officers';
}

export default function InboxScreen() {
  const { selectedOrganizationId } = useAuth();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedOrganizationId) return;
    try {
      const data = await getConversations(selectedOrganizationId);
      setConversations(data);
      setLoadError(null);
    } catch {
      setLoadError('Unable to load your inbox. Check your connection and try again.');
    }
  }, [selectedOrganizationId]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await load();
      } finally {
        setLoading(false);
      }
    })();
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const topPadding = useScreenTopPadding();

  return (
    <ThemedView style={[styles.container, topPadding]}>
      <ThemedText type="title">Inbox</ThemedText>
      <LoadErrorBanner message={loadError} onRetry={load} />
      <FlatList
        data={conversations}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/conversation/${item.id}`)}
            accessibilityRole="button"
            accessibilityLabel={`${item.hasUnread ? 'Unread, ' : ''}${item.subject || otherParticipantNames(item)}${item.subject ? `, ${otherParticipantNames(item)}` : ''}${item.lastMessageAt ? `, ${new Date(item.lastMessageAt).toLocaleDateString()}` : ''}`}
          >
            <ThemedView type="backgroundElement" style={styles.row}>
              <ThemedView style={styles.rowHeader}>
                <ThemedText type={item.hasUnread ? 'smallBold' : 'small'}>
                  {item.subject || otherParticipantNames(item)}
                </ThemedText>
                {item.hasUnread ? <ThemedView style={styles.unreadDot} accessibilityElementsHidden importantForAccessibility="no" /> : null}
              </ThemedView>
              <ThemedText type="small" themeColor="textSecondary">
                {otherParticipantNames(item)}
                {item.lastMessageAt ? ` · ${new Date(item.lastMessageAt).toLocaleDateString()}` : ''}
              </ThemedText>
            </ThemedView>
          </Pressable>
        )}
        ListEmptyComponent={
          !loading ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              No conversations yet.
            </ThemedText>
          ) : null
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
  empty: {
    textAlign: 'center',
    marginTop: Spacing.five,
  },
});
