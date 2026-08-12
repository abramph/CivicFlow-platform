import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet } from 'react-native';

import { LoadErrorBanner } from '@/components/load-error-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useScreenTopPadding } from '@/hooks/use-screen-top-padding';
import { API_BASE_URL } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import {
  getAnnouncementsForIdentity,
  getDues,
  getEventsForOrganization,
  getPaymentHistory,
  getPtaDues,
  getPtaVolunteerCommitments,
  getPtaVolunteerHours,
  type Announcement,
  type DuesSummary,
  type MobileEvent,
  type PtaDuesSummary,
  type PtaEvent,
  type PtaVolunteerCommitment,
  type PtaVolunteerHours,
} from '@/lib/mobile-api';
import { useUnreadConversationCount } from '@/lib/unread-count';

function formatCurrency(value: number) {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function formatCentsCurrency(cents: number) {
  return formatCurrency(cents / 100);
}

function formatHours(minutes: number): string {
  const hours = minutes / 60;
  return hours === Math.trunc(hours) ? String(hours) : hours.toFixed(1);
}

export default function DashboardScreen() {
  const { selectedOrganization, selectedOrganizationId } = useAuth();
  const [dues, setDues] = useState<DuesSummary | null>(null);
  const [ptaDues, setPtaDues] = useState<PtaDuesSummary | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [events, setEvents] = useState<(MobileEvent | PtaEvent)[]>([]);
  const [pendingReportCount, setPendingReportCount] = useState(0);
  const [ptaHours, setPtaHours] = useState<PtaVolunteerHours | null>(null);
  const [ptaUpcoming, setPtaUpcoming] = useState<PtaVolunteerCommitment | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const unreadCount = useUnreadConversationCount(selectedOrganizationId);
  const hasMemberIdentity = Boolean(selectedOrganization?.memberId);
  const pta = selectedOrganization?.pta ?? null;
  const hasPtaIdentity = Boolean(pta?.householdAdultId);
  // A pure PTA parent (household link, no OrgMember) reads announcements,
  // events, and messages through the org-access / household-authorized
  // bridge routes instead of the conventional member routes — see
  // requireMobileOrgAccess / requireMobilePtaHouseholdAccess in
  // civicflow-portal's mobile-auth.ts, and docs/mobile-pta-parent-parity.md.
  const hasAnyIdentity = hasMemberIdentity || hasPtaIdentity;

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !hasAnyIdentity) return;

    try {
      const [announcementsData, eventsData] = await Promise.all([
        getAnnouncementsForIdentity(selectedOrganizationId, hasMemberIdentity),
        getEventsForOrganization(selectedOrganizationId, selectedOrganization?.capability?.rsvp, hasMemberIdentity),
      ]);
      setAnnouncements(announcementsData.slice(0, 3));
      setEvents(eventsData.slice(0, 3));

      if (hasMemberIdentity) {
        const [duesData, historyData] = await Promise.all([getDues(selectedOrganizationId), getPaymentHistory(selectedOrganizationId)]);
        setDues(duesData);
        setPendingReportCount(historyData.reports.filter((r) => r.status === 'pending').length);
      } else if (hasPtaIdentity) {
        const duesData = await getPtaDues(selectedOrganizationId);
        setPtaDues(duesData);
        setPendingReportCount(duesData.currentCharge?.pendingReportCount ?? 0);
      }

      if (pta?.householdAdultId) {
        const [hoursData, commitments] = await Promise.all([
          getPtaVolunteerHours(selectedOrganizationId),
          getPtaVolunteerCommitments(selectedOrganizationId),
        ]);
        setPtaHours(hoursData);
        setPtaUpcoming(commitments.find((c) => c.status === 'SIGNED_UP') ?? null);
      }
      setLoadError(null);
    } catch {
      setLoadError('Unable to load your dashboard. Check your connection and try again.');
    }
  }, [selectedOrganizationId, hasAnyIdentity, hasMemberIdentity, hasPtaIdentity, pta?.householdAdultId, selectedOrganization?.capability?.rsvp]);

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
  const topPadding = useScreenTopPadding();

  return (
    <ScrollView
      contentContainerStyle={[styles.container, topPadding]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
    >
      <ThemedText type="title">
        {selectedOrganization?.organizationName ?? 'Unestra'}
      </ThemedText>
      <ThemedText type="subtitle" themeColor="textSecondary">
        Welcome back, {selectedOrganization?.firstName ?? 'member'}
      </ThemedText>

      <LoadErrorBanner message={loadError} onRetry={load} />

      {hasMemberIdentity ? (
        <ThemedView style={styles.summaryRow}>
          <Pressable
            style={styles.summaryTile}
            onPress={() => router.push('/dues')}
            accessibilityRole="button"
            accessibilityLabel={`Balance, ${dues ? formatCurrency(dues.outstandingBalance) : 'unknown'}${dues?.isDelinquent ? ', past due' : ''}`}
          >
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="small" themeColor="textSecondary">Balance</ThemedText>
              <ThemedText type="subtitle">{dues ? formatCurrency(dues.outstandingBalance) : '—'}</ThemedText>
              {dues?.isDelinquent ? <ThemedText type="small" style={styles.delinquent}>Past due</ThemedText> : null}
            </ThemedView>
          </Pressable>
          <Pressable
            style={styles.summaryTile}
            onPress={() => router.push('/inbox')}
            accessibilityRole="button"
            accessibilityLabel={`Unread messages, ${unreadCount}`}
          >
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="small" themeColor="textSecondary">Unread Messages</ThemedText>
              <ThemedText type="subtitle">{unreadCount}</ThemedText>
            </ThemedView>
          </Pressable>
        </ThemedView>
      ) : null}

      {hasPtaIdentity && !hasMemberIdentity ? (
        <ThemedView style={styles.summaryRow}>
          <Pressable
            style={styles.summaryTile}
            onPress={() => router.push('/dues')}
            accessibilityRole="button"
            accessibilityLabel={`Dues balance, ${ptaDues?.currentCharge ? formatCentsCurrency(ptaDues.currentCharge.remainingBalanceCents) : 'unknown'}${ptaDues?.currentCharge?.status === 'PENDING_REVIEW' ? ', payment pending review' : ''}${ptaDues?.hasBillingIdentity === false ? ', no billing record' : ''}`}
          >
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="small" themeColor="textSecondary">Dues Balance</ThemedText>
              <ThemedText type="subtitle">
                {ptaDues?.currentCharge ? formatCentsCurrency(ptaDues.currentCharge.remainingBalanceCents) : '—'}
              </ThemedText>
              {ptaDues?.currentCharge?.status === 'PENDING_REVIEW' ? (
                <ThemedText type="small" style={styles.pending}>Payment pending review</ThemedText>
              ) : null}
              {ptaDues?.hasBillingIdentity === false ? (
                <ThemedText type="small" themeColor="textSecondary">No billing record</ThemedText>
              ) : null}
            </ThemedView>
          </Pressable>
          <Pressable
            style={styles.summaryTile}
            onPress={() => router.push('/inbox')}
            accessibilityRole="button"
            accessibilityLabel={`Unread messages, ${unreadCount}`}
          >
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="small" themeColor="textSecondary">Unread Messages</ThemedText>
              <ThemedText type="subtitle">{unreadCount}</ThemedText>
            </ThemedView>
          </Pressable>
        </ThemedView>
      ) : null}

      {pta?.householdAdultId ? (
        <Pressable
          onPress={() => router.push('/volunteers')}
          accessibilityRole="button"
          accessibilityLabel={`Volunteer hours approved, ${ptaHours ? formatHours(ptaHours.approvedMinutes) : 'unknown'}${ptaHours?.requiredMinutes != null ? `, ${formatHours(ptaHours.remainingMinutes ?? 0)} remaining toward the ${formatHours(ptaHours.requiredMinutes)}-hour goal` : ''}${ptaUpcoming ? `, next: ${ptaUpcoming.opportunityTitle}, ${ptaUpcoming.slotLabel ?? 'shift'}` : ''}`}
        >
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="small" themeColor="textSecondary">Volunteer hours approved</ThemedText>
            <ThemedText type="subtitle">{ptaHours ? formatHours(ptaHours.approvedMinutes) : '—'}</ThemedText>
            {ptaHours?.requiredMinutes != null ? (
              <ThemedText type="small" themeColor="textSecondary">
                {formatHours(ptaHours.remainingMinutes ?? 0)} remaining toward the {formatHours(ptaHours.requiredMinutes)}-hour goal
              </ThemedText>
            ) : null}
            {ptaUpcoming ? (
              <ThemedText type="small" themeColor="textSecondary">
                Next: {ptaUpcoming.opportunityTitle} — {ptaUpcoming.slotLabel ?? 'shift'}
              </ThemedText>
            ) : null}
          </ThemedView>
        </Pressable>
      ) : null}

      {pendingReportCount > 0 ? (
        <Pressable
          onPress={() => router.push(hasMemberIdentity ? '/payment-history' : '/dues')}
          accessibilityRole="button"
          accessibilityLabel={`${pendingReportCount} payment report${pendingReportCount === 1 ? '' : 's'} awaiting review`}
        >
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">
              {pendingReportCount} payment report{pendingReportCount === 1 ? '' : 's'} awaiting review
            </ThemedText>
          </ThemedView>
        </Pressable>
      ) : null}

      {nextEvent ? (
        <Pressable
          onPress={() => router.navigate(`/event/${nextEvent.id}`)}
          accessibilityRole="button"
          accessibilityLabel={`Next upcoming event, ${nextEvent.title}${nextEvent.startAt ? `, ${new Date(nextEvent.startAt).toLocaleString()}` : ''}${nextEvent.rsvp?.response ? `, you're ${nextEvent.rsvp.response.status.replace('_', ' ').toLowerCase()}` : ''}`}
        >
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="small" themeColor="textSecondary">Next Upcoming Event</ThemedText>
            <ThemedText type="smallBold">{nextEvent.title}</ThemedText>
            {nextEvent.startAt ? (
              <ThemedText type="small" themeColor="textSecondary">{new Date(nextEvent.startAt).toLocaleString()}</ThemedText>
            ) : null}
            {nextEvent.rsvp?.response ? (
              <ThemedText type="small" style={styles.rsvpBadge}>You&apos;re {nextEvent.rsvp.response.status.replace('_', ' ').toLowerCase()}</ThemedText>
            ) : null}
          </ThemedView>
        </Pressable>
      ) : null}

      <ThemedText type="smallBold" style={styles.sectionLabel}>Quick Actions</ThemedText>
      <ThemedView style={styles.quickActionsRow}>
        {hasMemberIdentity ? (
          <Pressable style={styles.actionButton} onPress={() => router.push('/make-payment')} accessibilityRole="button" accessibilityLabel="Make a payment">
            <ThemedText style={styles.actionButtonText}>Make a Payment</ThemedText>
          </Pressable>
        ) : null}
        {hasPtaIdentity && !hasMemberIdentity && ptaDues?.onlinePaymentLinkSlug ? (
          <Pressable
            style={styles.actionButton}
            onPress={() => WebBrowser.openBrowserAsync(`${API_BASE_URL}/pay/${ptaDues.onlinePaymentLinkSlug}`)}
            accessibilityRole="button"
            accessibilityLabel="Make a payment"
          >
            <ThemedText style={styles.actionButtonText}>Make a Payment</ThemedText>
          </Pressable>
        ) : null}
        {hasMemberIdentity ? (
          <Pressable style={styles.actionButtonSecondary} onPress={() => router.push('/attendance-scan')} accessibilityRole="button" accessibilityLabel="Scan attendance code">
            <ThemedText style={styles.actionButtonSecondaryText}>Scan Attendance Code</ThemedText>
          </Pressable>
        ) : null}
        {hasAnyIdentity ? (
          <Pressable
            style={styles.actionButtonSecondary}
            onPress={() => router.push(hasPtaIdentity && !hasMemberIdentity ? '/pta-report-payment' : '/report-payment')}
            accessibilityRole="button"
            accessibilityLabel="Report a payment"
          >
            <ThemedText style={styles.actionButtonSecondaryText}>Report a Payment</ThemedText>
          </Pressable>
        ) : null}
        <Pressable style={styles.actionButtonSecondary} onPress={() => router.push('/inbox')} accessibilityRole="button" accessibilityLabel="Inbox">
          <ThemedText style={styles.actionButtonSecondaryText}>Inbox</ThemedText>
        </Pressable>
        <Pressable style={styles.actionButtonSecondary} onPress={() => router.push('/announcements')} accessibilityRole="button" accessibilityLabel="Announcements">
          <ThemedText style={styles.actionButtonSecondaryText}>Announcements</ThemedText>
        </Pressable>
        <Pressable style={styles.actionButtonSecondary} onPress={() => router.push('/events')} accessibilityRole="button" accessibilityLabel="Events">
          <ThemedText style={styles.actionButtonSecondaryText}>Events</ThemedText>
        </Pressable>
        <Pressable style={styles.actionButtonSecondary} onPress={() => router.push('/meetings')} accessibilityRole="button" accessibilityLabel="Meetings">
          <ThemedText style={styles.actionButtonSecondaryText}>Meetings</ThemedText>
        </Pressable>
        <Pressable style={styles.actionButtonSecondary} onPress={() => router.push('/minutes')} accessibilityRole="button" accessibilityLabel="Meeting minutes">
          <ThemedText style={styles.actionButtonSecondaryText}>Meeting Minutes</ThemedText>
        </Pressable>
        {hasPtaIdentity ? (
          <Pressable style={styles.actionButtonSecondary} onPress={() => router.push('/pta-documents')} accessibilityRole="button" accessibilityLabel="Documents">
            <ThemedText style={styles.actionButtonSecondaryText}>Documents</ThemedText>
          </Pressable>
        ) : null}
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
          <Pressable
            key={item.id}
            onPress={() => router.navigate(`/announcement/${item.id}`)}
            accessibilityRole="button"
            accessibilityLabel={`${item.isRead ? '' : 'Unread, '}${item.subject || item.title}`}
          >
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
          <Pressable
            key={item.id}
            onPress={() => router.navigate(`/event/${item.id}`)}
            accessibilityRole="button"
            accessibilityLabel={`${item.title}${item.startAt ? `, ${new Date(item.startAt).toLocaleString()}` : ''}`}
          >
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
  pending: {
    color: '#B54708',
  },
  rsvpBadge: {
    color: '#047857',
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
