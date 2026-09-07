import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet } from 'react-native';

import { LoadErrorBanner } from '@/components/load-error-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { EmptyState, StatusChip } from '@/components/ui';
import { Spacing, type StatusTone } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { getAdminEvent, updateAdminEvent, type AdminEventDetail, type AdminRsvpStatus, type EventStatusValue } from '@/lib/mobile-api';

const STATUS_LABELS: Record<EventStatusValue, string> = {
  upcoming: 'Upcoming',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const RSVP_STATUS_LABELS: Record<AdminRsvpStatus, string> = {
  GOING: 'Attending',
  MAYBE: 'Maybe',
  NOT_GOING: 'Declined',
};

// A decline is a normal answer, not a failure -- neutral, never the red
// "rejected" tone; MAYBE reads as the undecided/pending tone.
const RSVP_STATUS_TONES: Record<AdminRsvpStatus, StatusTone> = {
  GOING: 'approved',
  MAYBE: 'pending',
  NOT_GOING: 'neutral',
};

/**
 * Mobile Admin program (PR C) — event detail. Re-fetches by (eventId,
 * organizationId) on every mount, never trusts navigation params. Cancel
 * is PATCH { status: "cancelled" } -- there's no separate cancel route on
 * the web side either.
 */
export default function AdminEventDetailScreen() {
  const { selectedOrganization, selectedOrganizationId } = useAuth();
  const hasManageEvents = Boolean(selectedOrganization?.capability?.adminCapabilities?.includes('manageEvents'));
  const hasManageAttendance = Boolean(selectedOrganization?.capability?.adminCapabilities?.includes('manageAttendance'));
  const { eventId } = useLocalSearchParams<{ eventId: string }>();

  // Org-tagged: RSVP respondent names are organization-wide data, so a
  // previous organization's payload must never render after a switch.
  const [loaded, setLoaded] = useState<{ organizationId: string; data: AdminEventDetail } | null>(null);
  const event = loaded && loaded.organizationId === selectedOrganizationId ? loaded.data : null;
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !eventId || !hasManageEvents) return;
    try {
      const data = await getAdminEvent(selectedOrganizationId, eventId);
      setLoaded({ organizationId: selectedOrganizationId, data });
      setLoadError(null);
    } catch (error) {
      setLoaded(null);
      setLoadError(error instanceof ApiError && error.status === 404 ? 'This event could not be found.' : 'Unable to load this event. Check your connection and try again.');
    }
  }, [selectedOrganizationId, eventId, hasManageEvents]);

  // useFocusEffect: RSVPs change while the screen sits in the stack (a
  // response arrives, the edit screen above changes the event), so every
  // return trip re-fetches; pull-to-refresh covers mid-view updates.
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

  function confirmCancel() {
    Alert.alert('Cancel this event?', 'This marks the event as cancelled. Historical records are preserved.', [
      { text: 'Keep Event', style: 'cancel' },
      { text: 'Cancel Event', style: 'destructive', onPress: handleCancel },
    ]);
  }

  async function handleCancel() {
    if (!selectedOrganizationId || !eventId || cancelling) return;
    setCancelling(true);
    try {
      await updateAdminEvent(eventId, { organizationId: selectedOrganizationId, status: 'cancelled' });
      await load();
    } catch (error) {
      Alert.alert('Unable to cancel', error instanceof ApiError ? error.message : 'Please try again.');
    } finally {
      setCancelling(false);
    }
  }

  if (!hasManageEvents) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText type="subtitle" themeColor="textSecondary">
          You don&apos;t have event administration access for this organization.
        </ThemedText>
      </ThemedView>
    );
  }

  if (loading) {
    return (
      <ThemedView style={styles.loadingContainer} accessibilityRole="progressbar" accessibilityLabel="Loading event">
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (!event) {
    return (
      <ThemedView style={styles.container}>
        <LoadErrorBanner message={loadError ?? 'This event could not be found.'} onRetry={load} />
      </ThemedView>
    );
  }

  const rsvp = event.rsvp && event.rsvp.mode !== 'none' ? event.rsvp : null;

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
    >
      <ThemedText type="title">{event.title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {STATUS_LABELS[event.status]}
      </ThemedText>

      <ThemedView type="backgroundElement" style={styles.card}>
        {event.startAt ? (
          <ThemedText type="default">
            {new Date(event.startAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
          </ThemedText>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">No date set</ThemedText>
        )}
        {event.location ? <ThemedText type="default">{event.location}</ThemedText> : null}
        {event.description ? (
          <ThemedText type="small" themeColor="textSecondary">
            {event.description}
          </ThemedText>
        ) : null}
      </ThemedView>

      {/* RSVP visibility for the authorized administrator. The server decides
          the mode from the org's RSVP capability and enforces manageEvents +
          tenancy; nothing renders for mode 'none' (HOA) or an older server
          payload without the block. Pull-to-refresh above re-fetches this. */}
      {rsvp && rsvp.summary ? (
        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="smallBold" accessibilityRole="header">
            RSVPs
          </ThemedText>
          {rsvp.summary.totalResponses === 0 ? (
            <EmptyState
              title="No responses yet"
              body={
                rsvp.mode === 'household'
                  ? 'Household RSVPs will appear here as families respond.'
                  : 'Member RSVPs will appear here as people respond.'
              }
            />
          ) : (
            <>
              <ThemedView
                style={styles.rsvpSummaryRow}
                accessible
                accessibilityLabel={`${rsvp.summary.going} attending, ${rsvp.summary.maybe} maybe, ${rsvp.summary.notGoing} declined, ${rsvp.summary.totalResponses} total responses`}
              >
                <ThemedText type="default">
                  {rsvp.summary.going} attending · {rsvp.summary.maybe} maybe · {rsvp.summary.notGoing} declined
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {rsvp.summary.totalResponses} {rsvp.summary.totalResponses === 1 ? 'response' : 'responses'}
                  {rsvp.guestCounts
                    ? ` · ${rsvp.summary.totalAttendees} expected ${rsvp.summary.totalAttendees === 1 ? 'attendee' : 'attendees'} including guests`
                    : ` · ${rsvp.summary.totalAttendees} expected ${rsvp.summary.totalAttendees === 1 ? 'attendee' : 'attendees'}`}
                </ThemedText>
              </ThemedView>
              {rsvp.responses.map((response) => (
                <ThemedView
                  key={response.id}
                  style={styles.rsvpRow}
                  accessible
                  accessibilityLabel={`${response.name}, ${RSVP_STATUS_LABELS[response.status]}${
                    rsvp.guestCounts && response.attendeeCount !== null && response.status !== 'NOT_GOING'
                      ? `, ${response.attendeeCount} ${response.attendeeCount === 1 ? 'person' : 'people'}`
                      : ''
                  }`}
                >
                  <ThemedView style={styles.rsvpRowText}>
                    <ThemedText type="default">{response.name}</ThemedText>
                    {rsvp.guestCounts && response.attendeeCount !== null && response.status !== 'NOT_GOING' ? (
                      <ThemedText type="small" themeColor="textSecondary">
                        {response.attendeeCount} {response.attendeeCount === 1 ? 'person' : 'people'}
                      </ThemedText>
                    ) : null}
                    <ThemedText type="small" themeColor="textSecondary">
                      Updated {new Date(response.respondedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </ThemedText>
                  </ThemedView>
                  <StatusChip tone={RSVP_STATUS_TONES[response.status]} label={RSVP_STATUS_LABELS[response.status]} />
                </ThemedView>
              ))}
            </>
          )}
        </ThemedView>
      ) : null}

      <Pressable
        style={styles.secondaryButton}
        onPress={() => router.push(`/admin-events/${event.id}/edit`)}
        accessibilityRole="button"
        accessibilityLabel="Edit event"
      >
        <ThemedText type="link">Edit Event</ThemedText>
      </Pressable>

      {hasManageAttendance ? (
        <Pressable
          style={styles.button}
          onPress={() => router.push(`/admin-events/${event.id}/attendance-session`)}
          accessibilityRole="button"
          accessibilityLabel="Manage attendance"
        >
          <ThemedText style={styles.buttonPrimaryText}>Manage Check-In / Attendance</ThemedText>
        </Pressable>
      ) : null}

      {event.status !== 'cancelled' ? (
        <Pressable
          style={styles.secondaryButtonDanger}
          onPress={confirmCancel}
          disabled={cancelling}
          accessibilityRole="button"
          accessibilityLabel="Cancel event"
          accessibilityState={{ disabled: cancelling, busy: cancelling }}
        >
          <ThemedText style={styles.dangerText}>{cancelling ? 'Cancelling…' : 'Cancel Event'}</ThemedText>
        </Pressable>
      ) : null}
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
  card: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: 6,
  },
  rsvpSummaryRow: {
    gap: 2,
    backgroundColor: 'transparent',
  },
  rsvpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
    backgroundColor: 'transparent',
  },
  rsvpRowText: {
    flex: 1,
    gap: 2,
    backgroundColor: 'transparent',
  },
  button: {
    backgroundColor: '#047857',
    borderRadius: 10,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  buttonPrimaryText: {
    color: '#fff',
    fontWeight: '600',
  },
  secondaryButton: {
    minHeight: 44,
    justifyContent: 'center',
  },
  secondaryButtonDanger: {
    minHeight: 44,
    justifyContent: 'center',
  },
  dangerText: {
    color: '#B42318',
    fontWeight: '600',
  },
});
