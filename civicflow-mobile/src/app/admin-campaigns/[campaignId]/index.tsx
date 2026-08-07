import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet } from 'react-native';

import { LoadErrorBanner } from '@/components/load-error-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { getAdminCampaign, sendAdminCampaign, type AdminCampaignDetail, type CampaignStatus } from '@/lib/mobile-api';

const STATUS_LABELS: Record<CampaignStatus, string> = {
  DRAFT: 'Draft',
  READY: 'Ready',
  SENDING: 'Sending',
  SENT: 'Sent',
  FAILED: 'Failed',
  CANCELED: 'Canceled',
};

const SENDABLE_STATUSES: CampaignStatus[] = ['DRAFT', 'READY', 'FAILED'];

/**
 * Mobile Admin program (PR C) — campaign detail. Re-fetches by
 * (campaignId, organizationId) on every mount. Send delegates to the same
 * idempotent/resumable sendCommunicationCampaign() the web "Send Campaign"
 * button uses -- safe to tap again if a prior send partially completed.
 */
export default function AdminCampaignDetailScreen() {
  const { selectedOrganizationId } = useAuth();
  const { campaignId } = useLocalSearchParams<{ campaignId: string }>();

  const [campaign, setCampaign] = useState<AdminCampaignDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !campaignId) return;
    try {
      setCampaign(await getAdminCampaign(selectedOrganizationId, campaignId));
      setLoadError(null);
    } catch (error) {
      setCampaign(null);
      setLoadError(error instanceof ApiError && error.status === 404 ? 'This campaign could not be found.' : 'Unable to load this campaign. Check your connection and try again.');
    }
  }, [selectedOrganizationId, campaignId]);

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

  function confirmSend() {
    if (!campaign) return;
    Alert.alert(
      'Send this campaign?',
      `This will send to ${campaign._count.recipients} recipient${campaign._count.recipients === 1 ? '' : 's'}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send', onPress: handleSend },
      ]
    );
  }

  async function handleSend() {
    if (!selectedOrganizationId || !campaignId || sending) return;
    setSending(true);
    try {
      await sendAdminCampaign(selectedOrganizationId, campaignId);
      await load();
    } catch (error) {
      Alert.alert('Unable to send', error instanceof ApiError ? error.message : 'Please try again.');
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <ThemedView style={styles.loadingContainer} accessibilityRole="progressbar" accessibilityLabel="Loading campaign">
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (!campaign) {
    return (
      <ThemedView style={styles.container}>
        <LoadErrorBanner message={loadError ?? 'This campaign could not be found.'} onRetry={load} />
      </ThemedView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ThemedText type="title">{campaign.title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {STATUS_LABELS[campaign.status]} · {campaign._count.recipients} recipient{campaign._count.recipients === 1 ? '' : 's'}
      </ThemedText>

      <ThemedView type="backgroundElement" style={styles.card}>
        <ThemedText type="smallBold">{campaign.subject}</ThemedText>
        <ThemedText type="default">{campaign.body}</ThemedText>
      </ThemedView>

      {SENDABLE_STATUSES.includes(campaign.status) ? (
        <Pressable
          style={[styles.button, sending && styles.buttonDisabled]}
          onPress={confirmSend}
          disabled={sending}
          accessibilityRole="button"
          accessibilityLabel="Send campaign"
          accessibilityState={{ disabled: sending, busy: sending }}
        >
          {sending ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.buttonText}>Send Campaign</ThemedText>}
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
  button: {
    backgroundColor: '#047857',
    borderRadius: 10,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
});
