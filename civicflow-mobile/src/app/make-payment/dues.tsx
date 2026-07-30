import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet } from 'react-native';

import { PaymentOptions } from '@/components/payment-options';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { getPaymentLinkSlug, getPaymentMethods, type PayableMethod } from '@/lib/mobile-api';

export default function MakePaymentDuesScreen() {
  const { selectedOrganizationId } = useAuth();
  const [slug, setSlug] = useState<string | null>(null);
  const [methods, setMethods] = useState<PayableMethod[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!selectedOrganizationId) return;
    const [linkResult, methodsResult] = await Promise.all([
      getPaymentLinkSlug(selectedOrganizationId, { dues: true }),
      getPaymentMethods(selectedOrganizationId),
    ]);
    setSlug(linkResult.slug);
    setMethods(methodsResult);
  }, [selectedOrganizationId]);

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
      <ThemedView style={styles.loadingContainer} accessibilityRole="progressbar" accessibilityLabel="Loading">
        <ActivityIndicator />
      </ThemedView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ThemedText type="title">Pay Dues in Advance</ThemedText>
      <ThemedText type="default" themeColor="textSecondary">
        Get ahead on your membership dues in any amount, even before your next charge is due.
      </ThemedText>

      <PaymentOptions paymentLinkSlug={slug} methods={methods} reportCategory="MEMBERSHIP_DUES" />
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
