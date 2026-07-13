import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import {
  getAnnouncements,
  getDues,
  getEvents,
  getPaymentHistory,
  type Announcement,
  type DuesSummary,
  type MobileEvent,
} from '@/lib/mobile-api';
import { useUnreadConversationCount } from '@/lib/unread-count';

function formatCurrency(value: number) {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export default function DashboardScreen() {
  const { selectedOrganization, selectedOrganizationId } = useAuth();
  const [dues, setDues] = useState<DuesSummary | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [events, setEvents] = useState<MobileEvent[]>([]);
  const [pendingReportCount, setPendingReportCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const unreadCount = useUnreadConversationCount(selectedOrganizationId);

  const load = useCallback(async () => {
    if (!selectedOrganizationId) return;
    const [duesData, announcementsData, eventsData, historyData] = await Promise.all([
      getDues(selectedOrganizationId),
      getAnnouncements(selectedOrganizationId),
      getEvents(selectedOrganizationId),
      getPaymentHistory(selectedOrganizationId),
    ]);
    setDues(duesData);
    setAnnouncements(announcementsData.slice(0, 3));
    setEvents(eventsData.slice(0, 3));
    setPendingReportCount(historyData.reports.filter((r) => r.status === 'pending').length);
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

  const nextEvent = events[0] ?? null;
  const unreadAnnouncementCount = announcements.filter((a) => !a.isRead).length;

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
    >
      <ThemedText type="title">
        {selectedOrganization?.organizationName ?? 'Unestra'}
      </ThemedText>
      <ThemedText type="subtitle" themeColor="textSecondary">
        Welcome back, {selectedOrganization?.firstName ?? 'member'}
      </ThemedText>

      <ThemedView style={styles.summaryRow}>
        <Pressable style={styles.summaryTile} onPress={() => router.push('/dues')}>
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="small" themeColor="textSecondary">Balance</ThemedText>
            <ThemedText type="subtitle">{dues ? formatCurrency(dues.outstandingBalance) : '—'}</ThemedText>
            {dues?.isDelinquent ? <ThemedText type="small" style={styles.delinquent}>Past due</ThemedText> : null}
          </ThemedView>
        </Pressable>
        <Pressable style={styles.summaryTile} onPress={() => router.push('/inbox')}>
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="small" themeColor="textSecondary">Unread Messages</ThemedText>
            <ThemedText type="subtitle">{unreadCount}</ThemedText>
          </ThemedView>
        </Pressable>
      </ThemedView>

      {pendingReportCount > 0 ? (
        <Pressable onPress={() => router.push('/payment-history')}>
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">
              {pendingReportCount} payment report{pendingReportCount === 1 ? '' : 's'} awaiting review
            </ThemedText>
          </ThemedView>
        </Pressable>
      ) : null}

      {nextEvent ? (
        <Pressable onPress={() => router.push(`/event/${nextEvent.id}`)}>
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="small" themeColor="textSecondary">Next Upcoming Event</ThemedText>
            <ThemedText type="smallBold">{nextEvent.title}</ThemedText>
            {nextEvent.startAt ? (
              <ThemedText type="small" themeColor="textSecondary">{new Date(nextEvent.startAt).toLocaleString()}</ThemedText>
            ) : null}
          </ThemedView>
        </Pressable>
      ) : null}

      <ThemedText type="smallBold" style={styles.sectionLabel}>Quick Actions</ThemedText>
      <ThemedView style={styles.quickActionsRow}>
        <Pressable style={styles.actionButton} onPress={() => router.push('/make-payment')}>
          <ThemedText style={styles.actionButtonText}>Make a Payment</ThemedText>
        </Pressable>
        <Pressable style={styles.actionButtonSecondary} onPress={() => router.push('/attendance-scan')}>
          <ThemedText style={styles.actionButtonSecondaryText}>Scan Attendance Code</ThemedText>
        </Pressable>
        <Pressable style={styles.actionButtonSecondary} onPress={() => router.push('/report-payment')}>
          <ThemedText style={styles.actionButtonSecondaryText}>Report a Payment</ThemedText>
        </Pressable>
        <Pressable style={styles.actionButtonSecondary} onPress={() => router.push('/inbox')}>
          <ThemedText style={styles.actionButtonSecondaryText}>Inbox</ThemedText>
        </Pressable>
        <Pressable style={styles.actionButtonSecondary} onPress={() => router.push('/announcements')}>
          <ThemedText style={styles.actionButtonSecondaryText}>Announcements</ThemedText>
        </Pressable>
        <Pressable style={styles.actionButtonSecondary} onPress={() => router.push('/events')}>
          <ThemedText style={styles.actionButtonSecondaryText}>Events</ThemedText>
        </Pressable>
      </ThemedView>

      <ThemedView style={styles.sectionHeaderRow}>
        <ThemedText type="smallBold" style={styles.sectionLabel}>Recent Announcements</ThemedText>
        {unreadAnnouncementCount > 0 ? (
          <ThemedText type="small" style={styles.unreadBadgeText}>{unreadAnnouncementCount} new</ThemedText>
        ) : null}
      </ThemedView>
      {announcements.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">No announcements yet.</ThemedText>
      ) : (
        announcements.map((item) => (
          <Pressable key={item.id} onPress={() => router.push(`/announcement/${item.id}`)}>
            <ThemedView type="backgroundElement" style={styles.listCard}>
              <ThemedText type={item.isRead ? 'small' : 'smallBold'}>{item.subject || item.title}</ThemedText>
            </ThemedView>
          </Pressable>
        ))
      )}

      <ThemedText type="smallBold" style={styles.sectionLabel}>Upcoming Events</ThemedText>
      {events.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">No upcoming events.</ThemedText>
      ) : (
        events.map((item) => (
          <Pressable key={item.id} onPress={() => router.push(`/event/${item.id}`)}>
            <ThemedView type="backgroundElement" style={styles.listCard}>
              <ThemedText type="smallBold">{item.title}</ThemedText>
              {item.startAt ? (
                <ThemedText type="small" themeColor="textSecondary">{new Date(item.startAt).toLocaleString()}</ThemedText>
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
    gap: Spacing.three,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: Spacing.three,
    backgroundColor: 'transparent',
  },
  summaryTile: {
    flex: 1,
  },
  card: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: 4,
  },
  delinquent: {
    color: '#B42318',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
  },
  unreadBadgeText: {
    color: '#047857',
    fontWeight: '600',
  },
  sectionLabel: {
    marginTop: Spacing.two,
  },
  quickActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    backgroundColor: 'transparent',
  },
  actionButton: {
    backgroundColor: '#047857',
    borderRadius: 10,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
  },
  actionButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  actionButtonSecondary: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 10,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
  },
  actionButtonSecondaryText: {
    fontWeight: '600',
  },
  listCard: {
    borderRadius: 10,
    padding: Spacing.three,
    gap: 2,
  },
});
