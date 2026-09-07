import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { EmptyState, StatusChip } from '@/components/ui';
import { Elevation, Spacing, type StatusTone } from '@/constants/theme';
import type { AdminEventRsvpView, AdminRsvpStatus } from '@/lib/mobile-api';

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
 * The authorized administrator's RSVP planning card — shared verbatim by
 * the admin EVENT detail and the admin MEETING planning screen, which is
 * exactly why the server gives both the same AdminEventRsvpView shape.
 * Display-only: the server decides the mode from the org's RSVP capability
 * and enforces manageEvents/manageMeetings + tenancy; this component
 * renders nothing for mode 'none' or a summary-less payload.
 */
export function AdminRsvpSection({ rsvp }: { rsvp: AdminEventRsvpView }) {
  if (rsvp.mode === 'none' || !rsvp.summary) return null;
  const summary = rsvp.summary;

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="smallBold" accessibilityRole="header">
        RSVPs
      </ThemedText>
      {summary.totalResponses === 0 ? (
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
            accessibilityLabel={`${summary.going} attending, ${summary.maybe} maybe, ${summary.notGoing} declined, ${summary.totalResponses} total responses`}
          >
            <ThemedText type="default">
              {summary.going} attending · {summary.maybe} maybe · {summary.notGoing} declined
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {summary.totalResponses} {summary.totalResponses === 1 ? 'response' : 'responses'}
              {rsvp.guestCounts
                ? ` · ${summary.totalAttendees} expected ${summary.totalAttendees === 1 ? 'attendee' : 'attendees'} including guests`
                : ` · ${summary.totalAttendees} expected ${summary.totalAttendees === 1 ? 'attendee' : 'attendees'}`}
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
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: 6,
    ...(Elevation.card as object),
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
});
