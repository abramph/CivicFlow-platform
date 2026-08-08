import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { LoadErrorBanner } from '@/components/load-error-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import {
  generateAdminContributionReceipt,
  getAdminContribution,
  voidAdminContribution,
  type AdminContributionDetail,
} from '@/lib/mobile-api';

function contributorLabel(detail: AdminContributionDetail) {
  if (detail.member) return `${detail.member.firstName} ${detail.member.lastName}`;
  if (detail.campaign) return `Campaign: ${detail.campaign.name}`;
  if (detail.event) return `Event: ${detail.event.title}`;
  return 'Unknown contributor';
}

/**
 * Mobile Admin program (PR D) — contribution detail. Re-fetches by
 * (contributionId, organizationId) on every mount, never trusting anything
 * passed through navigation params, matching admin-members/[memberId]. Void
 * is the only destructive-adjacent action available here — it's the only
 * one with a real, tested route on the web (see contribution-mutations.ts);
 * no delete/refund is invented for mobile.
 */
export default function AdminContributionDetailScreen() {
  const { selectedOrganization, selectedOrganizationId } = useAuth();
  const hasManagePayments = Boolean(selectedOrganization?.capability?.adminCapabilities?.includes('managePayments'));
  const { contributionId } = useLocalSearchParams<{ contributionId: string }>();

  const [contribution, setContribution] = useState<AdminContributionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [showVoidForm, setShowVoidForm] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [receiptSent, setReceiptSent] = useState(false);

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !contributionId || !hasManagePayments) return;
    try {
      setContribution(await getAdminContribution(selectedOrganizationId, contributionId));
      setLoadError(null);
    } catch (error) {
      setContribution(null);
      setLoadError(error instanceof ApiError && error.status === 404 ? 'This contribution could not be found.' : 'Unable to load this contribution. Check your connection and try again.');
    }
  }, [selectedOrganizationId, contributionId, hasManagePayments]);

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

  function confirmVoid() {
    setShowVoidForm(true);
  }

  async function handleVoid() {
    if (!selectedOrganizationId || !contributionId || actionPending) return;
    setActionPending(true);
    try {
      await voidAdminContribution(contributionId, selectedOrganizationId, voidReason.trim() || undefined);
      setShowVoidForm(false);
      setVoidReason('');
      await load();
    } catch (error) {
      Alert.alert('Unable to void', error instanceof ApiError ? error.message : 'Please try again.');
    } finally {
      setActionPending(false);
    }
  }

  async function handleGenerateReceipt() {
    if (!selectedOrganizationId || !contributionId || actionPending) return;
    setActionPending(true);
    try {
      await generateAdminContributionReceipt(contributionId, selectedOrganizationId);
      setReceiptSent(true);
      await load();
    } catch (error) {
      Alert.alert('Unable to generate receipt', error instanceof ApiError ? error.message : 'Please try again.');
    } finally {
      setActionPending(false);
    }
  }

  if (!hasManagePayments) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText type="subtitle" themeColor="textSecondary">
          You don&apos;t have payments administration access for this organization.
        </ThemedText>
      </ThemedView>
    );
  }

  if (loading) {
    return (
      <ThemedView style={styles.loadingContainer} accessibilityRole="progressbar" accessibilityLabel="Loading contribution">
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (!contribution) {
    return (
      <ThemedView style={styles.container}>
        <LoadErrorBanner message={loadError ?? 'This contribution could not be found.'} onRetry={load} />
      </ThemedView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ThemedText type="title">{contributorLabel(contribution)}</ThemedText>
      <ThemedText type="subtitle" themeColor="textSecondary">
        ${Number(contribution.amount).toFixed(2)} · {new Date(contribution.contributionDate).toLocaleDateString()}
        {contribution.voidedAt ? ' · Voided' : ''}
      </ThemedText>

      <ThemedView type="backgroundElement" style={styles.card}>
        {contribution.paymentMethod ? <ThemedText type="default">Method: {contribution.paymentMethod.replace('_', ' ')}</ThemedText> : null}
        <ThemedText type="small" themeColor="textSecondary">Source: {contribution.source.replace('_', ' ')}</ThemedText>
        {contribution.notes ? <ThemedText type="small" themeColor="textSecondary">{contribution.notes}</ThemedText> : null}
        {contribution.voidedAt ? (
          <ThemedText type="small" style={styles.voidedText}>
            Voided {new Date(contribution.voidedAt).toLocaleDateString()}{contribution.voidReason ? `: ${contribution.voidReason}` : ''}
          </ThemedText>
        ) : null}
      </ThemedView>

      {contribution.receipts.length > 0 ? (
        <ThemedView style={styles.section}>
          <ThemedText type="subtitle">Receipts</ThemedText>
          {contribution.receipts.map((receipt) => (
            <ThemedView key={receipt.id} type="backgroundElement" style={styles.receiptCard}>
              <ThemedText type="small">{receipt.receiptNumber}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{receipt.deliveryStatus}</ThemedText>
            </ThemedView>
          ))}
        </ThemedView>
      ) : null}

      {!contribution.voidedAt && !contribution.lockedAt ? (
        <>
          <Pressable
            style={styles.secondaryButton}
            onPress={() => router.push(`/admin-contributions/${contribution.id}/edit`)}
            accessibilityRole="button"
            accessibilityLabel="Edit contribution"
          >
            <ThemedText type="link">Edit Contribution</ThemedText>
          </Pressable>

          {contribution.receipts.length === 0 ? (
            <Pressable
              style={[styles.secondaryButton, actionPending && styles.buttonDisabled]}
              onPress={handleGenerateReceipt}
              disabled={actionPending}
              accessibilityRole="button"
              accessibilityLabel="Generate receipt"
              accessibilityState={{ disabled: actionPending, busy: actionPending }}
            >
              <ThemedText type="link">{actionPending ? 'Generating…' : receiptSent ? 'Receipt Generated' : 'Generate Receipt'}</ThemedText>
            </Pressable>
          ) : null}

          {!showVoidForm ? (
            <Pressable
              style={styles.secondaryButtonDanger}
              onPress={confirmVoid}
              accessibilityRole="button"
              accessibilityLabel="Void contribution"
            >
              <ThemedText style={styles.dangerText}>Void Contribution</ThemedText>
            </Pressable>
          ) : (
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">Void this contribution?</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                This cannot be undone. The record is kept for audit purposes but excluded from totals.
              </ThemedText>
              <TextInput
                style={styles.input}
                placeholder="Reason (optional)"
                value={voidReason}
                onChangeText={setVoidReason}
                accessibilityLabel="Void reason, optional"
              />
              <ThemedView style={styles.actionRow}>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => {
                    setShowVoidForm(false);
                    setVoidReason('');
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel void"
                >
                  <ThemedText type="link">Cancel</ThemedText>
                </Pressable>
                <Pressable
                  style={[styles.button, styles.buttonDanger, actionPending && styles.buttonDisabled]}
                  onPress={handleVoid}
                  disabled={actionPending}
                  accessibilityRole="button"
                  accessibilityLabel="Confirm void"
                  accessibilityState={{ disabled: actionPending, busy: actionPending }}
                >
                  <ThemedText style={styles.buttonPrimaryText}>{actionPending ? 'Voiding…' : 'Confirm Void'}</ThemedText>
                </Pressable>
              </ThemedView>
            </ThemedView>
          )}
        </>
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
  section: {
    gap: Spacing.two,
  },
  receiptCard: {
    borderRadius: 10,
    padding: Spacing.two,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  input: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  button: {
    borderRadius: 10,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  buttonDanger: {
    backgroundColor: '#B42318',
  },
  buttonPrimaryText: {
    color: '#fff',
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  secondaryButton: {
    minHeight: 44,
    justifyContent: 'center',
  },
  secondaryButtonDanger: {
    minHeight: 44,
    justifyContent: 'center',
  },
  dangerText: {
    color: '#B42318',
    fontWeight: '600',
  },
  voidedText: {
    color: '#B42318',
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
});
