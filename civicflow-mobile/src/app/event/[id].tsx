import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { getEventsForIdentity, setPtaEventRsvp, type MobileEvent, type PtaEvent } from '@/lib/mobile-api';

const RSVP_OPTIONS: { value: 'GOING' | 'MAYBE' | 'NOT_GOING'; label: string }[] = [
  { value: 'GOING', label: 'Going' },
  { value: 'MAYBE', label: 'Maybe' },
  { value: 'NOT_GOING', label: "Can't go" },
];

function isPtaEvent(event: MobileEvent | PtaEvent): event is PtaEvent {
  return 'myRsvp' in event;
}

export default function EventDetailScreen() {
  const { selectedOrganization, selectedOrganizationId } = useAuth();
  const hasMemberIdentity = Boolean(selectedOrganization?.memberId);
  const hasPtaIdentity = Boolean(selectedOrganization?.pta?.householdAdultId);
  const { id } = useLocalSearchParams<{ id: string }>();
  const [event, setEvent] = useState<MobileEvent | PtaEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [rsvpSubmitting, setRsvpSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !id || (!hasMemberIdentity && !hasPtaIdentity)) return;
    const all = await getEventsForIdentity(selectedOrganizationId, hasMemberIdentity);
    setEvent(all.find((item) => item.id === id) ?? null);
  }, [selectedOrganizationId, id, hasMemberIdentity, hasPtaIdentity]);

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

  async function handleRsvp(status: 'GOING' | 'MAYBE' | 'NOT_GOING') {
    if (!selectedOrganizationId || !id || rsvpSubmitting) return;
    setRsvpSubmitting(true);
    try {
      const rsvp = await setPtaEventRsvp(selectedOrganizationId, id, status);
      setEvent((current) => (current && isPtaEvent(current) ? { ...current, myRsvp: rsvp } : current));
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

      {isPtaEvent(event) ? (
        <ThemedView type="backgroundElement" style={styles.rsvpCard}>
          <ThemedText type="smallBold">Your RSVP</ThemedText>
          <ThemedView style={styles.rsvpRow} accessibilityRole="radiogroup" accessibilityLabel="RSVP status">
            {RSVP_OPTIONS.map((option) => (
              <Pressable
                key={option.value}
                disabled={rsvpSubmitting}
                style={[styles.rsvpChip, event.myRsvp?.status === option.value && styles.rsvpChipSelected]}
                onPress={() => handleRsvp(option.value)}
                accessibilityRole="radio"
                accessibilityLabel={option.label}
                accessibilityState={{ selected: event.myRsvp?.status === option.value, disabled: rsvpSubmitting, busy: rsvpSubmitting }}
              >
                <ThemedText
                  type="small"
                  style={event.myRsvp?.status === option.value ? styles.rsvpChipTextSelected : undefined}
                >
                  {option.label}
                </ThemedText>
              </Pressable>
            ))}
          </ThemedView>
          {event.myRsvp ? (
            <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">
              {event.myRsvp.attendeeCount} attendee{event.myRsvp.attendeeCount === 1 ? '' : 's'} from your household
            </ThemedText>
          ) : null}
          {event.volunteerOpportunities.length > 0 ? (
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
