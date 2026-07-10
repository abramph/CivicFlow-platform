import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet } from 'react-native';

import { PaymentOptions } from '@/components/payment-options';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { getEvents, getPaymentLinkSlug, getPaymentMethods, type MobileEvent, type PayableMethod } from '@/lib/mobile-api';

export default function MakePaymentEventScreen() {
  const { selectedOrganizationId } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [event, setEvent] = useState<MobileEvent | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [methods, setMethods] = useState<PayableMethod[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !id) return;
    const [events, linkResult, methodsResult] = await Promise.all([
      getEvents(selectedOrganizationId),
      getPaymentLinkSlug(selectedOrganizationId, { eventId: id }),
      getPaymentMethods(selectedOrganizationId),
    ]);
    setEvent(events.find((item) => item.id === id) ?? null);
    setSlug(linkResult.slug);
    setMethods(methodsResult);
  }, [selectedOrganizationId, id]);

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
        {event.location ? ` · ${event.location}` : ''}
      </ThemedText>
      {event.description ? <ThemedText type="default">{event.description}</ThemedText> : null}

      <PaymentOptions paymentLinkSlug={slug} methods={methods} reportCategory="EVENT_REGISTRATION" />
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
