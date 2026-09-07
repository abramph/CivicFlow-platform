import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet } from 'react-native';

import { AdminRsvpSection } from '@/components/admin-rsvp-section';
import { LoadErrorBanner } from '@/components/load-error-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { getAdminMeetingRsvp, type AdminMeetingRsvpDetail } from '@/lib/mobile-api';

/**
 * Read-only meeting RSVP planning for an authorized administrator — the
 * meeting counterpart of the admin event detail's RSVP card, reached from
 * the Admin dashboard's Upcoming Attendance rows. Deliberately shows NO
 * meeting-administration controls (no edit, agenda, minutes, attendance
 * sessions): meetings administration stays web-first, and this screen
 * exists only so a mobile admin can see how many people are coming and who
 * responded.
 *
 * Double-gated like every admin screen: the entry point only appears for
 * manageMeetings holders, this screen re-checks the same server-resolved
 * capability, and the API independently enforces manageMeetings + tenancy
 * regardless of navigation.
 */
export default function AdminMeetingRsvpScreen() {
  const { selectedOrganization, selectedOrganizationId } = useAuth();
  const hasManageMeetings = Boolean(selectedOrganization?.capability?.adminCapabilities?.includes('manageMeetings'));
  const { meetingId } = useLocalSearchParams<{ meetingId: string }>();

  // Org-tagged: respondent names are organization-wide data, so a previous
  // organization's payload must never render after a switch.
  const [loaded, setLoaded] = useState<{ organizationId: string; data: AdminMeetingRsvpDetail } | null>(null);
  const meeting = loaded && loaded.organizationId === selectedOrganizationId ? loaded.data : null;
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !meetingId || !hasManageMeetings) return;
    try {
      const data = await getAdminMeetingRsvp(selectedOrganizationId, meetingId);
      setLoaded({ organizationId: selectedOrganizationId, data });
      setLoadError(null);
    } catch (error) {
      setLoaded(null);
      setLoadError(
        error instanceof ApiError && error.status === 404
          ? 'This meeting could not be found.'
          : 'Unable to load meeting RSVPs. Check your connection and try again.'
      );
    }
  }, [selectedOrganizationId, meetingId, hasManageMeetings]);

  // Focus-driven like the admin event detail: RSVPs change while this
  // screen sits in the stack, so every return trip re-fetches.
  useFocusEffect(
    useCallback(() => {
      (async () => {
        setLoading(true);
        try {
          await load();
        } finally {
          setLoading(false);
        }
      })();
    }, [load])
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  if (!hasManageMeetings) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText type="subtitle" themeColor="textSecondary">
          You don&apos;t have meeting administration access for this organization.
        </ThemedText>
      </ThemedView>
    );
  }

  if (loading) {
    return (
      <ThemedView style={styles.loadingContainer} accessibilityRole="progressbar" accessibilityLabel="Loading meeting RSVPs">
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (!meeting) {
    return (
      <ThemedView style={styles.container}>
        <LoadErrorBanner message={loadError ?? 'This meeting could not be found.'} onRetry={load} />
      </ThemedView>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
    >
      <ThemedText type="title">{meeting.title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {new Date(meeting.meetingDate).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
      </ThemedText>
      {meeting.location ? (
        <ThemedText type="small" themeColor="textSecondary">{meeting.location}</ThemedText>
      ) : null}
      {meeting.rsvp && meeting.rsvp.mode !== 'none' ? (
        <ThemedText type="small" themeColor="textSecondary">
          {meeting.rsvp.mode === 'household' ? 'Household RSVP mode' : 'Individual RSVP mode'}
        </ThemedText>
      ) : null}

      {meeting.rsvp ? <AdminRsvpSection rsvp={meeting.rsvp} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
