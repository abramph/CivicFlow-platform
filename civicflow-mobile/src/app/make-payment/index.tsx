import { Redirect, router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { getCampaigns, getEvents, type Campaign, type MobileEvent } from '@/lib/mobile-api';

function formatCurrency(value: string | number) {
  return Number(value).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export default function MakePaymentScreen() {
  const { status, selectedOrganization, selectedOrganizationId } = useAuth();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [events, setEvents] = useState<MobileEvent[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!selectedOrganizationId) return;
    // Both endpoints are member-scoped. Previously an unhandled rejection on
    // failure — the screen threw rather than rendering anything.
    try {
      const [campaignsData, eventsData] = await Promise.all([
        getCampaigns(selectedOrganizationId),
        getEvents(selectedOrganizationId),
      ]);
      setCampaigns(campaignsData);
      setEvents(eventsData);
    } catch {
      setCampaigns([]);
      setEvents([]);
    }
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

  // Direct-route defense: campaigns and events here are member-scoped, so a
  // staff/owner login with no linked member record would 403 on mount.
  if (status === 'signedIn' && selectedOrganization && !selectedOrganization.memberId) {
    return <Redirect href="/dues" />;
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
    >
      <ThemedText type="title">Make a Payment</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">Choose what you&apos;d like to pay for.</ThemedText>

      <Pressable onPress={() => router.push('/make-payment/dues')} accessibilityRole="button" accessibilityLabel="Membership dues, pay ahead on your dues in any amount">
        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="smallBold">Membership Dues</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">Pay ahead on your dues, in any amount.</ThemedText>
        </ThemedView>
      </Pressable>

      <ThemedText type="smallBold" style={styles.sectionLabel}>Campaigns</ThemedText>
      {campaigns.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">No active campaigns right now.</ThemedText>
      ) : (
        campaigns.map((campaign) => (
          <Pressable
            key={campaign.id}
            onPress={() => router.push({ pathname: '/make-payment/campaign/[id]', params: { id: campaign.id } })}
            accessibilityRole="button"
            accessibilityLabel={`${campaign.name}${campaign.goal ? `, goal ${formatCurrency(campaign.goal)}` : ''}`}
          >
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">{campaign.name}</ThemedText>
              {campaign.goal ? (
                <ThemedText type="small" themeColor="textSecondary">Goal: {formatCurrency(campaign.goal)}</ThemedText>
              ) : null}
            </ThemedView>
          </Pressable>
        ))
      )}

      <ThemedText type="smallBold" style={styles.sectionLabel}>Events</ThemedText>
      {events.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">No upcoming events right now.</ThemedText>
      ) : (
        events.map((event) => (
          <Pressable
            key={event.id}
            onPress={() => router.push({ pathname: '/make-payment/event/[id]', params: { id: event.id } })}
            accessibilityRole="button"
            accessibilityLabel={`${event.title}, ${event.startAt ? new Date(event.startAt).toLocaleDateString() : 'date TBD'}`}
          >
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">{event.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {event.startAt ? new Date(event.startAt).toLocaleDateString() : 'Date TBD'}
              </ThemedText>
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
  card: {
    borderRadius: 10,
    padding: Spacing.three,
    gap: 4,
  },
  sectionLabel: {
    marginTop: Spacing.two,
  },
});
