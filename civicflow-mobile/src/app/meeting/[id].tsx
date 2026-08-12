import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet } from 'react-native';

import { RsvpCard } from '@/components/rsvp-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import {
  getMeetingsForOrganization,
  setMeetingRsvp,
  setPtaMeetingRsvp,
  type EventRsvpBlock,
  type MobileMeeting,
  type RsvpStatus,
} from '@/lib/mobile-api';

export default function MeetingDetailScreen() {
  const { selectedOrganization, selectedOrganizationId } = useAuth();
  const hasMemberIdentity = Boolean(selectedOrganization?.memberId);
  const { id } = useLocalSearchParams<{ id: string }>();
  const [meeting, setMeeting] = useState<MobileMeeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [rsvpSubmitting, setRsvpSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !id) return;
    const all = await getMeetingsForOrganization(
      selectedOrganizationId,
      selectedOrganization?.capability?.rsvp,
      hasMemberIdentity
    );
    setMeeting(all.find((item) => item.id === id) ?? null);
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

  // The meeting's own rsvp block is the sole authority for the RSVP UI and
  // endpoint choice — same contract as event detail.
  const rsvp: EventRsvpBlock | null = meeting?.rsvp ?? null;

  async function handleRsvp(status: RsvpStatus) {
    if (!selectedOrganizationId || !id || rsvpSubmitting || !rsvp?.canRsvp) return;
    setRsvpSubmitting(true);
    try {
      let nextBlock: EventRsvpBlock;
      if (rsvp.mode === 'household') {
        // Preserve the household's existing head count on a status change
        // (min 1; the server records 0 for Not Going regardless).
        const saved = await setPtaMeetingRsvp(selectedOrganizationId, id, status, Math.max(1, rsvp.response?.attendeeCount ?? 1));
        nextBlock = { ...rsvp, response: { status: saved.status, attendeeCount: saved.attendeeCount } };
      } else {
        nextBlock = await setMeetingRsvp(selectedOrganizationId, id, status);
      }
      setMeeting((current) => (current ? { ...current, rsvp: nextBlock } : current));
    } finally {
      setRsvpSubmitting(false);
    }
  }

  async function handleCountChange(count: number) {
    if (!selectedOrganizationId || !id || rsvpSubmitting || !rsvp?.canRsvp || rsvp.mode !== 'household' || count < 1) return;
    setRsvpSubmitting(true);
    try {
      const saved = await setPtaMeetingRsvp(selectedOrganizationId, id, rsvp.response?.status ?? 'GOING', count);
      setMeeting((current) =>
        current ? { ...current, rsvp: { ...rsvp, response: { status: saved.status, attendeeCount: saved.attendeeCount } } } : current
      );
    } finally {
      setRsvpSubmitting(false);
    }
  }

  if (loading) {
    return (
      <ThemedView style={styles.loadingContainer} accessibilityRole="progressbar" accessibilityLabel="Loading meeting">
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (!meeting) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText type="title">Meeting</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" accessibilityRole="alert" accessibilityLiveRegion="assertive">
          This meeting isn&apos;t available.
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ThemedText type="title">{meeting.title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {new Date(meeting.meetingDate).toLocaleString()}
      </ThemedText>
      {meeting.location ? (
        <ThemedText type="small" themeColor="textSecondary">{meeting.location}</ThemedText>
      ) : null}
      {meeting.meetingType ? (
        <ThemedText type="small" themeColor="textSecondary">{meeting.meetingType}</ThemedText>
      ) : null}
      {meeting.description ? (
        <ThemedText type="default" style={styles.body}>{meeting.description}</ThemedText>
      ) : null}

      <RsvpCard rsvp={rsvp} submitting={rsvpSubmitting} onSelect={handleRsvp} onChangeCount={handleCountChange} />
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
});
