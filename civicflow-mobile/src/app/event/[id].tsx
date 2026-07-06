import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { getEvents, type MobileEvent } from '@/lib/mobile-api';

export default function EventDetailScreen() {
  const { selectedOrganizationId } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [event, setEvent] = useState<MobileEvent | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !id) return;
    const all = await getEvents(selectedOrganizationId);
    setEvent(all.find((item) => item.id === id) ?? null);
  }, [selectedOrganizationId, id]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  if (loading) {
    return (
      <ThemedView style={styles.loadingContainer}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (!event) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText type="title">Event</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">This event isn&apos;t available.</ThemedText>
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
