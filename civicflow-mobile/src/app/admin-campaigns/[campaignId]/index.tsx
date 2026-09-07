import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet } from 'react-native';

import { LoadErrorBanner } from '@/components/load-error-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ActionColors, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import {
  deleteAdminCampaignDraft,
  getAdminCampaign,
  sendAdminCampaign,
  withdrawAdminCampaign,
  type AdminCampaignDetail,
  type CampaignStatus,
} from '@/lib/mobile-api';
import { requireAdminCapability } from '@/components/require-admin-capability';

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
function AdminCampaignDetailScreen() {
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

  function confirmWithdraw() {
    Alert.alert(
      'Withdraw this announcement?',
      'It disappears from member views in the app, but the campaign, its delivery records, and the audit trail are all preserved. Emails and texts already delivered cannot be pulled back.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Withdraw', style: 'destructive', onPress: handleWithdraw },
      ]
    );
  }

  async function handleWithdraw() {
    if (!selectedOrganizationId || !campaignId || sending) return;
    setSending(true);
    try {
      await withdrawAdminCampaign(selectedOrganizationId, campaignId);
      await load();
    } catch (error) {
      Alert.alert('Unable to withdraw', error instanceof ApiError ? error.message : 'Please try again.');
      await load();
    } finally {
      setSending(false);
    }
  }

  function confirmDeleteDraft() {
    Alert.alert('Delete this draft?', 'The draft has never been sent. Deleting it is recorded in the audit log.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete Draft', style: 'destructive', onPress: handleDeleteDraft },
    ]);
  }

  async function handleDeleteDraft() {
    if (!selectedOrganizationId || !campaignId || sending) return;
    setSending(true);
    try {
      await deleteAdminCampaignDraft(selectedOrganizationId, campaignId);
      router.replace('/admin-campaigns');
    } catch (error) {
      Alert.alert('Unable to delete', error instanceof ApiError ? error.message : 'Please try again.');
      await load();
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
        {campaign.withdrawnAt ? 'Withdrawn' : STATUS_LABELS[campaign.status]} · {campaign._count.recipients} recipient{campaign._count.recipients === 1 ? '' : 's'}
      </ThemedText>
      {campaign.withdrawnAt ? (
        <ThemedText type="small" style={styles.withdrawnNote} accessibilityRole="alert">
          Withdrawn {new Date(campaign.withdrawnAt).toLocaleString()} — hidden from member views; delivery records and
          audit history are preserved.
        </ThemedText>
      ) : null}

      <ThemedView type="backgroundElement" style={styles.card}>
        <ThemedText type="smallBold">{campaign.subject}</ThemedText>
        <ThemedText type="default">{campaign.body}</ThemedText>
      </ThemedView>

      {!campaign.withdrawnAt && SENDABLE_STATUSES.includes(campaign.status) ? (
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

      {campaign.status === 'DRAFT' ? (
        <Pressable
          style={styles.dangerLink}
          onPress={confirmDeleteDraft}
          disabled={sending}
          accessibilityRole="button"
          accessibilityLabel="Delete draft"
          accessibilityState={{ disabled: sending }}
        >
          <ThemedText type="link" style={styles.dangerText}>Delete Draft</ThemedText>
        </Pressable>
      ) : null}

      {campaign.status === 'SENT' && !campaign.withdrawnAt ? (
        <Pressable
          style={styles.dangerLink}
          onPress={confirmWithdraw}
          disabled={sending}
          accessibilityRole="button"
          accessibilityLabel="Withdraw announcement"
          accessibilityState={{ disabled: sending }}
        >
          <ThemedText type="link" style={styles.dangerText}>Withdraw Announcement</ThemedText>
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
  withdrawnNote: {
    color: ActionColors.warning,
  },
  dangerLink: {
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'center',
  },
  dangerText: {
    color: ActionColors.danger,
  },
});

export default requireAdminCapability('manageCommunications', 'communications administration', AdminCampaignDetailScreen);
