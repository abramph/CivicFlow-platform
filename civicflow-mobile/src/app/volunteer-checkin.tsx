import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { getPtaVolunteerToday, type PtaVolunteerTodaySummary } from '@/lib/mobile-api';

/**
 * The Volunteer Coordinator's event-day entry point — a deliberately small
 * staffing summary, not a full opportunity-management screen (that stays
 * web-first). Tap an opportunity to reach its roster/check-in screen.
 */
export default function VolunteerCheckinScreen() {
  const { selectedOrganization, selectedOrganizationId } = useAuth();
  const canCheckIn = Boolean(selectedOrganization?.pta?.canCheckIn);
  const canApproveHours = Boolean(selectedOrganization?.pta?.canApproveHours);

  const [summary, setSummary] = useState<PtaVolunteerTodaySummary | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !canCheckIn) return;
    setSummary(await getPtaVolunteerToday(selectedOrganizationId));
  }, [selectedOrganizationId, canCheckIn]);

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

  if (!canCheckIn) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText type="subtitle" themeColor="textSecondary">
          You don&apos;t have volunteer check-in access for this organization.
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
    >
      <ThemedText type="title">Event-Day Check-In</ThemedText>

      {canApproveHours && summary && summary.pendingHourApprovalCount > 0 ? (
        <Pressable onPress={() => router.push('/volunteer-hour-approvals')}>
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">
              {summary.pendingHourApprovalCount} hour approval{summary.pendingHourApprovalCount === 1 ? '' : 's'} pending
            </ThemedText>
            <ThemedText type="link">Review now →</ThemedText>
          </ThemedView>
        </Pressable>
      ) : null}

      <ThemedText type="smallBold" style={styles.sectionLabel}>Open opportunities</ThemedText>
      {!summary || summary.opportunities.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">No open opportunities.</ThemedText>
      ) : (
        summary.opportunities.map((opp) => (
          <Pressable key={opp.id} onPress={() => router.push(`/volunteer-checkin/${opp.id}`)}>
            <ThemedView type="backgroundElement" style={styles.listCard}>
              <ThemedText type="smallBold">{opp.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {opp.claimedCount}/{opp.capacity} filled across {opp.slotCount} shift{opp.slotCount === 1 ? '' : 's'}
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
    flex: 1,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  card: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: 4,
  },
  listCard: {
    borderRadius: 10,
    padding: Spacing.three,
    gap: 2,
  },
  sectionLabel: {
    marginTop: Spacing.two,
  },
});
