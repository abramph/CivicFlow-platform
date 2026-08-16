import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet } from 'react-native';

import { LoadErrorBanner } from '@/components/load-error-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useScreenTopPadding } from '@/hooks/use-screen-top-padding';
import { useAuth } from '@/lib/auth-context';
import {
  getPtaVolunteerCommitments,
  getPtaVolunteerHours,
  getPtaVolunteerOpportunities,
  getPtaVolunteerToday,
  type PtaVolunteerCommitment,
  type PtaVolunteerHours,
  type PtaVolunteerOpportunitySummary,
  type PtaVolunteerTodaySummary,
} from '@/lib/mobile-api';

function formatMinutes(minutes: number): string {
  const hours = minutes / 60;
  return hours === Math.trunc(hours) ? String(hours) : hours.toFixed(1);
}

/**
 * One screen serving two very different audiences, switched on
 * `selectedOrganization.pta`: a parent sees the volunteer hub (browse,
 * claim, hours, goal); a Volunteer Coordinator additionally sees the
 * event-day staffing summary up top, with a link into the check-in screen.
 * Officer administration otherwise stays web-first — this is deliberately
 * NOT a full opportunity-management screen.
 */
export default function VolunteersScreen() {
  const { selectedOrganization, selectedOrganizationId } = useAuth();
  const pta = selectedOrganization?.pta ?? null;
  const isParent = Boolean(pta?.householdAdultId);
  const isOfficer = Boolean(pta?.isOfficer);

  const [opportunities, setOpportunities] = useState<PtaVolunteerOpportunitySummary[]>([]);
  const [commitments, setCommitments] = useState<PtaVolunteerCommitment[]>([]);
  const [hours, setHours] = useState<PtaVolunteerHours | null>(null);
  const [today, setToday] = useState<PtaVolunteerTodaySummary | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !pta) return;
    try {
      const tasks: Promise<void>[] = [];
      if (isParent) {
        tasks.push(
          getPtaVolunteerOpportunities(selectedOrganizationId).then(setOpportunities),
          getPtaVolunteerCommitments(selectedOrganizationId).then(setCommitments),
          getPtaVolunteerHours(selectedOrganizationId).then(setHours)
        );
      }
      if (isOfficer) {
        tasks.push(getPtaVolunteerToday(selectedOrganizationId).then(setToday));
      }
      await Promise.all(tasks);
      setLoadError(null);
    } catch {
      setLoadError('Unable to load volunteer data. Check your connection and try again.');
    }
  }, [selectedOrganizationId, pta, isParent, isOfficer]);

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

  if (!pta) {
    // Not enrolled in PTA Labs, or no PTA identity for this org — the tab
    // itself is hidden in this case (see (tabs)/_layout.tsx), but this
    // guards direct navigation too.
    return (
      <ThemedView style={[styles.container, topPadding]}>
        <ThemedText type="subtitle" themeColor="textSecondary">
          Volunteer features aren&apos;t available for this organization.
        </ThemedText>
      </ThemedView>
    );
  }

  const upcoming = commitments.filter((c) => c.status === 'SIGNED_UP');
  const completed = commitments.filter((c) => c.status !== 'SIGNED_UP' && c.status !== 'CANCELLED');

  return (
    <ScrollView
      contentContainerStyle={[styles.container, topPadding]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
    >
      <ThemedText type="title">Volunteers</ThemedText>
      <LoadErrorBanner message={loadError} onRetry={load} />

      {isOfficer && today ? (
        <Pressable
          onPress={() => router.push('/volunteer-checkin')}
          accessibilityRole="button"
          accessibilityLabel={`Today's staffing, ${today.understaffedShiftCount} understaffed shift${today.understaffedShiftCount === 1 ? '' : 's'}, ${today.pendingHourApprovalCount} pending hour approval${today.pendingHourApprovalCount === 1 ? '' : 's'}. Open check-in`}
        >
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">Today&apos;s staffing</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {today.understaffedShiftCount} understaffed shift{today.understaffedShiftCount === 1 ? '' : 's'} ·{' '}
              {today.pendingHourApprovalCount} pending hour approval{today.pendingHourApprovalCount === 1 ? '' : 's'}
            </ThemedText>
            <ThemedText type="link" style={styles.link}>
              Open check-in →
            </ThemedText>
          </ThemedView>
        </Pressable>
      ) : null}

      {isParent ? (
        <>
          <ThemedView
            type="backgroundElement"
            style={styles.card}
            accessible
            accessibilityLabel={`Family volunteer goal${hours ? `, ${formatMinutes(hours.approvedMinutes)} hours approved${hours.pendingMinutes > 0 ? `, ${formatMinutes(hours.pendingMinutes)} hours awaiting approval` : ''}${hours.requiredMinutes != null ? `, ${formatMinutes(hours.remainingMinutes ?? 0)} hours remaining toward the ${formatMinutes(hours.requiredMinutes)}-hour goal` : ", this PTA doesn't require a set number of hours"}` : ''}`}
          >
            <ThemedText type="smallBold">Family volunteer goal</ThemedText>
            {hours ? (
              <>
                <ThemedText type="default">{formatMinutes(hours.approvedMinutes)} hours approved</ThemedText>
                {hours.pendingMinutes > 0 ? (
                  <ThemedText type="small" themeColor="textSecondary">{formatMinutes(hours.pendingMinutes)} hours awaiting approval</ThemedText>
                ) : null}
                {hours.requiredMinutes != null ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {formatMinutes(hours.remainingMinutes ?? 0)} hours remaining toward the {formatMinutes(hours.requiredMinutes)}-hour goal
                  </ThemedText>
                ) : (
                  <ThemedText type="small" themeColor="textSecondary">This PTA doesn&apos;t require a set number of hours.</ThemedText>
                )}
              </>
            ) : null}
          </ThemedView>

          {upcoming.length > 0 ? (
            <>
              <ThemedText type="smallBold" style={styles.sectionLabel}>My upcoming shifts</ThemedText>
              {upcoming.map((c) => (
                <ThemedView
                  key={c.id}
                  type="backgroundElement"
                  style={styles.listCard}
                  accessible
                  accessibilityLabel={`${c.opportunityTitle}, ${c.slotLabel ?? 'Shift'}`}
                >
                  <ThemedText type="smallBold">{c.opportunityTitle}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">{c.slotLabel ?? 'Shift'}</ThemedText>
                </ThemedView>
              ))}
            </>
          ) : null}

          <ThemedText type="smallBold" style={styles.sectionLabel}>Open opportunities</ThemedText>
          {opportunities.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">No open volunteer opportunities right now.</ThemedText>
          ) : (
            opportunities.map((opp) => {
              const claimed = opp.slots.reduce((sum, s) => sum + s.claimedCount, 0);
              const capacity = opp.slots.reduce((sum, s) => sum + s.capacity, 0);
              return (
                <Pressable
                  key={opp.id}
                  onPress={() => router.push(`/volunteer-opportunity/${opp.id}`)}
                  accessibilityRole="button"
                  accessibilityLabel={`${opp.title}${opp.description ? `, ${opp.description}` : ''}, ${claimed} of ${capacity} filled`}
                >
                  <ThemedView type="backgroundElement" style={styles.listCard}>
                    <ThemedText type="smallBold">{opp.title}</ThemedText>
                    {opp.description ? (
                      <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>{opp.description}</ThemedText>
                    ) : null}
                    <ThemedText type="small" themeColor="textSecondary">
                      {claimed}/{capacity} filled
                    </ThemedText>
                  </ThemedView>
                </Pressable>
              );
            })
          )}

          {completed.length > 0 ? (
            <>
              <ThemedText type="smallBold" style={styles.sectionLabel}>Completed service</ThemedText>
              {completed.map((c) => (
                <ThemedView
                  key={c.id}
                  type="backgroundElement"
                  style={styles.listCard}
                  accessible
                  accessibilityLabel={`${c.opportunityTitle}, ${c.status.replace('_', ' ')}`}
                >
                  <ThemedText type="smallBold">{c.opportunityTitle}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">{c.status.replace('_', ' ')}</ThemedText>
                </ThemedView>
              ))}
            </>
          ) : null}
        </>
      ) : null}
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
  listCard: {
    borderRadius: 10,
    padding: Spacing.three,
    gap: 2,
  },
  sectionLabel: {
    marginTop: Spacing.two,
  },
  link: {
    marginTop: 4,
  },
});
