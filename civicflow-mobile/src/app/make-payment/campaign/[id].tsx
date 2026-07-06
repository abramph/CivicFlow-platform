import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet } from 'react-native';

import { PaymentOptions } from '@/components/payment-options';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { getCampaigns, getPaymentLinkSlug, getPaymentMethods, type Campaign, type PayableMethod } from '@/lib/mobile-api';

function formatCurrency(value: string | number) {
  return Number(value).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export default function MakePaymentCampaignScreen() {
  const { selectedOrganizationId } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [methods, setMethods] = useState<PayableMethod[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !id) return;
    const [campaigns, linkResult, methodsResult] = await Promise.all([
      getCampaigns(selectedOrganizationId),
      getPaymentLinkSlug(selectedOrganizationId, { campaignId: id }),
      getPaymentMethods(selectedOrganizationId),
    ]);
    setCampaign(campaigns.find((item) => item.id === id) ?? null);
    setSlug(linkResult.slug);
    setMethods(methodsResult);
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

  if (!campaign) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText type="title">Campaign</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">This campaign isn&apos;t available.</ThemedText>
      </ThemedView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ThemedText type="title">{campaign.name}</ThemedText>
      {campaign.description ? <ThemedText type="default">{campaign.description}</ThemedText> : null}
      {campaign.goal ? (
        <ThemedText type="small" themeColor="textSecondary">Goal: {formatCurrency(campaign.goal)}</ThemedText>
      ) : null}

      <PaymentOptions paymentLinkSlug={slug} methods={methods} reportCategory="DONATION" />
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
