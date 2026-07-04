import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { getAnnouncements, getDues, getEvents, type Announcement, type DuesSummary, type MobileEvent } from '@/lib/mobile-api';

function formatCurrency(value: number) {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export default function DashboardScreen() {
  const { selectedOrganization, selectedOrganizationId } = useAuth();
  const [dues, setDues] = useState<DuesSummary | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [events, setEvents] = useState<MobileEvent[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!selectedOrganizationId) return;
    const [duesData, announcementsData, eventsData] = await Promise.all([
      getDues(selectedOrganizationId),
      getAnnouncements(selectedOrganizationId),
      getEvents(selectedOrganizationId),
    ]);
    setDues(duesData);
    setAnnouncements(announcementsData.slice(0, 3));
    setEvents(eventsData.slice(0, 3));
  }, [selectedOrganizationId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
    >
      <ThemedText type="title">
        {selectedOrganization?.organizationName ?? 'CivicFlow'}
      </ThemedText>
      <ThemedText type="subtitle" themeColor="textSecondary">
        Welcome back, {selectedOrganization?.firstName ?? 'member'}
      </ThemedText>

      {dues ? (
        <Pressable onPress={() => router.push('/dues')}>
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="small" themeColor="textSecondary">Dues Balance</ThemedText>
            <ThemedText type="subtitle">{formatCurrency(dues.outstandingBalance)}</ThemedText>
            {dues.isDelinquent ? <ThemedText type="small" style={styles.delinquent}>Past due — tap to report a payment</ThemedText> : null}
          </ThemedView>
        </Pressable>
      ) : null}

      <Pressable style={styles.button} onPress={() => router.push('/report-payment')}>
        <ThemedText style={styles.buttonText}>Report a Payment</ThemedText>
      </Pressable>

      <ThemedText type="smallBold" style={styles.sectionLabel}>Recent Announcements</ThemedText>
      {announcements.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">No announcements yet.</ThemedText>
      ) : (
        announcements.map((item) => (
          <ThemedView key={item.id} type="backgroundElement" style={styles.listCard}>
            <ThemedText type="smallBold">{item.subject || item.title}</ThemedText>
          </ThemedView>
        ))
      )}

      <ThemedText type="smallBold" style={styles.sectionLabel}>Upcoming Events</ThemedText>
      {events.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">No upcoming events.</ThemedText>
      ) : (
        events.map((item) => (
          <ThemedView key={item.id} type="backgroundElement" style={styles.listCard}>
            <ThemedText type="smallBold">{item.title}</ThemedText>
            {item.startAt ? (
              <ThemedText type="small" themeColor="textSecondary">{new Date(item.startAt).toLocaleString()}</ThemedText>
            ) : null}
          </ThemedView>
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
  card: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: 4,
  },
  delinquent: {
    color: '#B42318',
  },
  button: {
    backgroundColor: '#047857',
    borderRadius: 10,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  sectionLabel: {
    marginTop: Spacing.two,
  },
  listCard: {
    borderRadius: 10,
    padding: Spacing.three,
    gap: 2,
  },
});
