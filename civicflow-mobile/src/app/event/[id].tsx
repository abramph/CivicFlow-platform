import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import {
  getEventsForOrganization,
  setEventRsvp,
  setPtaEventRsvp,
  type EventRsvpBlock,
  type MobileEvent,
  type PtaEvent,
  type RsvpStatus,
} from '@/lib/mobile-api';

const RSVP_OPTIONS: { value: RsvpStatus; label: string }[] = [
  { value: 'GOING', label: 'Going' },
  { value: 'MAYBE', label: 'Maybe' },
  { value: 'NOT_GOING', label: "Can't go" },
];

export default function EventDetailScreen() {
  const { selectedOrganization, selectedOrganizationId } = useAuth();
  const hasMemberIdentity = Boolean(selectedOrganization?.memberId);
  const { id } = useLocalSearchParams<{ id: string }>();
  const [event, setEvent] = useState<MobileEvent | PtaEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [rsvpSubmitting, setRsvpSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !id) return;
    const all = await getEventsForOrganization(
      selectedOrganizationId,
      selectedOrganization?.capability?.rsvp,
      hasMemberIdentity
    );
    setEvent(all.find((item) => item.id === id) ?? null);
  }, [selectedOrganizationId, id, selectedOrganization?.capability?.rsvp, hasMemberIdentity]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await load();
      } finally {
        setLoading(false);
      }
    })();
  }, [load]);

  // The event's own rsvp block is the sole authority for what RSVP UI to show
  // and which endpoint a response goes to — never the event object's shape
  // ('myRsvp' in event) and never the caller's identity fields.
  const rsvp: EventRsvpBlock | null = event?.rsvp ?? null;

  async function handleRsvp(status: RsvpStatus) {
    if (!selectedOrganizationId || !id || rsvpSubmitting || !rsvp?.canRsvp) return;
    setRsvpSubmitting(true);
    try {
      let nextBlock: EventRsvpBlock;
      if (rsvp.mode === 'household') {
        // Preserve the household's existing attendee count on a status change
        // rather than silently resetting it to the server default.
        const saved = await setPtaEventRsvp(selectedOrganizationId, id, status, rsvp.response?.attendeeCount);
        nextBlock = { ...rsvp, response: { status: saved.status, attendeeCount: saved.attendeeCount } };
      } else {
        nextBlock = await setEventRsvp(selectedOrganizationId, id, status);
      }
      setEvent((current) => (current ? { ...current, rsvp: nextBlock } : current));
    } finally {
      setRsvpSubmitting(false);
    }
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
        <ThemedText type="title">Event</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" accessibilityRole="alert" accessibilityLiveRegion="assertive">
          This event isn&apos;t available.
        </ThemedText>
      </ThemedView>
    );
  }

  const volunteerOpportunities = 'volunteerOpportunities' in event ? event.volunteerOpportunities : [];

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ThemedText type="title">{event.title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {event.startAt ? new Date(event.startAt).toLocaleString() : 'Date TBD'}
        {event.endAt ? ` – ${new Date(event.endAt).toLocaleString()}` : ''}
      </ThemedText>
      {event.location ? (
        <ThemedText type="small" themeColor="textSecondary">{event.location}</ThemedText>
      ) : null}
      {event.description ? (
        <ThemedText type="default" style={styles.body}>{event.description}</ThemedText>
      ) : null}

      {rsvp?.canRsvp ? (
        <ThemedView type="backgroundElement" style={styles.rsvpCard}>
          <ThemedText type="smallBold">Your RSVP</ThemedText>
          <ThemedView style={styles.rsvpRow} accessibilityRole="radiogroup" accessibilityLabel="RSVP status">
            {RSVP_OPTIONS.map((option) => (
              <Pressable
                key={option.value}
                disabled={rsvpSubmitting}
                style={[styles.rsvpChip, rsvp.response?.status === option.value && styles.rsvpChipSelected]}
                onPress={() => handleRsvp(option.value)}
                accessibilityRole="radio"
                accessibilityLabel={option.label}
                accessibilityState={{ selected: rsvp.response?.status === option.value, disabled: rsvpSubmitting, busy: rsvpSubmitting }}
              >
                <ThemedText
                  type="small"
                  style={rsvp.response?.status === option.value ? styles.rsvpChipTextSelected : undefined}
                >
                  {option.label}
                </ThemedText>
              </Pressable>
            ))}
          </ThemedView>
          {rsvp.guestCounts && rsvp.response ? (
            <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">
              {rsvp.response.attendeeCount} attendee{rsvp.response.attendeeCount === 1 ? '' : 's'} from your household
            </ThemedText>
          ) : null}
          {volunteerOpportunities.length > 0 ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.volunteerNote}>
              Volunteer opportunities are available for this event — see the Volunteer tab.
            </ThemedText>
          ) : null}
        </ThemedView>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.four,
    gap: Spacing.two,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    marginTop: Spacing.two,
  },
  rsvpCard: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.two,
    marginTop: Spacing.three,
  },
  rsvpRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    backgroundColor: 'transparent',
  },
  rsvpChip: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  rsvpChipSelected: {
    backgroundColor: '#047857',
    borderColor: '#047857',
  },
  rsvpChipTextSelected: {
    color: '#fff',
  },
  volunteerNote: {
    marginTop: Spacing.one,
  },
});
