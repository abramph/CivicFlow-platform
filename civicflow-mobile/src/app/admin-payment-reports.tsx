import { Redirect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput } from 'react-native';

import { LoadErrorBanner } from '@/components/load-error-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import {
  approveAdminPaymentLinkReport,
  approveAdminPaymentReport,
  getAdminPaymentLinkReports,
  getAdminPaymentReports,
  rejectAdminPaymentLinkReport,
  rejectAdminPaymentReport,
  type AdminPaymentLinkReportRow,
  type AdminPaymentReportRow,
} from '@/lib/mobile-api';

type Tab = 'self-reported' | 'payment-links';

/**
 * Mobile Admin program (PR D) — payment report review queue. Combines the
 * two independent report families the web /payment-reports and
 * /payment-link-reports pages review: member self-reported payments
 * (PaymentReport) and payment-link offline reports (PaymentLinkOfflineReport).
 * They're gated on different permissions server-side (dues:write vs
 * payment_link_reports:review) — this screen just renders whichever tab's
 * list call succeeds and shows a permission-denied message for the other if
 * it 403s, rather than assuming both are held together.
 */
export default function AdminPaymentReportsScreen() {
  const { selectedOrganization, selectedOrganizationId } = useAuth();
  const hasManagePayments = Boolean(selectedOrganization?.capability?.adminCapabilities?.includes('managePayments'));

  const [tab, setTab] = useState<Tab>('self-reported');
  const [selfReported, setSelfReported] = useState<AdminPaymentReportRow[]>([]);
  const [paymentLinks, setPaymentLinks] = useState<AdminPaymentLinkReportRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionPendingId, setActionPendingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !hasManagePayments) return;
    try {
      if (tab === 'self-reported') {
        setSelfReported(await getAdminPaymentReports(selectedOrganizationId, 'pending'));
      } else {
        setPaymentLinks(await getAdminPaymentLinkReports(selectedOrganizationId, 'pending'));
      }
      setLoadError(null);
    } catch (error) {
      setLoadError(
        error instanceof ApiError && error.status === 403
          ? "You don't have access to review this type of payment report."
          : 'Unable to load payment reports. Check your connection and try again.'
      );
    }
  }, [selectedOrganizationId, hasManagePayments, tab]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function confirmApprove(id: string, isPaymentLink: boolean) {
    Alert.alert('Approve this payment?', 'This will mark the payment as confirmed and update related records.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Approve', onPress: () => handleApprove(id, isPaymentLink) },
    ]);
  }

  async function handleApprove(id: string, isPaymentLink: boolean) {
    if (!selectedOrganizationId || actionPendingId) return;
    setActionPendingId(id);
    try {
      if (isPaymentLink) {
        await approveAdminPaymentLinkReport(id, selectedOrganizationId);
      } else {
        await approveAdminPaymentReport(id, selectedOrganizationId);
      }
      await load();
    } catch (error) {
      Alert.alert('Unable to approve', error instanceof ApiError ? error.message : 'Please try again.');
    } finally {
      setActionPendingId(null);
    }
  }

  async function handleReject(id: string, isPaymentLink: boolean) {
    if (!selectedOrganizationId || actionPendingId || !rejectionReason.trim()) return;
    setActionPendingId(id);
    try {
      if (isPaymentLink) {
        await rejectAdminPaymentLinkReport(id, selectedOrganizationId, rejectionReason.trim());
      } else {
        await rejectAdminPaymentReport(id, selectedOrganizationId, rejectionReason.trim());
      }
      setRejectingId(null);
      setRejectionReason('');
      await load();
    } catch (error) {
      Alert.alert('Unable to reject', error instanceof ApiError ? error.message : 'Please try again.');
    } finally {
      setActionPendingId(null);
    }
  }

  if (!selectedOrganizationId) {
    return <Redirect href="/org-switcher" />;
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

  const rows: { id: string; title: string; subtitle: string; isPaymentLink: boolean }[] =
    tab === 'self-reported'
      ? selfReported.map((r) => ({
          id: r.id,
          title: `${r.member.firstName} ${r.member.lastName} · $${Number(r.amount).toFixed(2)}`,
          subtitle: `${r.category.replace(/_/g, ' ')} · ${r.paymentMethod.replace('_', ' ')} · ${new Date(r.paymentDate).toLocaleDateString()}`,
          isPaymentLink: false,
        }))
      : paymentLinks.map((r) => ({
          id: r.id,
          title: `${r.payerName} · $${Number(r.amount).toFixed(2)}`,
          subtitle: `${r.paymentLink.title}${r.referenceNumber ? ` · Ref: ${r.referenceNumber}` : ''}`,
          isPaymentLink: true,
        }));

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
    >
      <ThemedText type="title">Payment Reports</ThemedText>

      <ThemedView style={styles.tabRow} accessibilityRole="tablist">
        <Pressable
          style={[styles.tab, tab === 'self-reported' && styles.tabSelected]}
          onPress={() => setTab('self-reported')}
          accessibilityRole="tab"
          accessibilityLabel="Self-reported payments"
          accessibilityState={{ selected: tab === 'self-reported' }}
        >
          <ThemedText type="small" style={tab === 'self-reported' ? styles.tabTextSelected : undefined}>Self-Reported</ThemedText>
        </Pressable>
        <Pressable
          style={[styles.tab, tab === 'payment-links' && styles.tabSelected]}
          onPress={() => setTab('payment-links')}
          accessibilityRole="tab"
          accessibilityLabel="Payment link reports"
          accessibilityState={{ selected: tab === 'payment-links' }}
        >
          <ThemedText type="small" style={tab === 'payment-links' ? styles.tabTextSelected : undefined}>Payment Links</ThemedText>
        </Pressable>
      </ThemedView>

      <LoadErrorBanner message={loadError} onRetry={load} />

      {rows.length === 0 && !loadError ? (
        <ThemedText type="small" themeColor="textSecondary">
          Nothing pending review.
        </ThemedText>
      ) : (
        rows.map((row) => (
          <ThemedView key={row.id} type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">{row.title}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{row.subtitle}</ThemedText>

            {rejectingId === row.id ? (
              <>
                <TextInput
                  style={styles.input}
                  placeholder="Reason for rejection"
                  value={rejectionReason}
                  onChangeText={setRejectionReason}
                  accessibilityLabel="Rejection reason"
                />
                <ThemedView style={styles.actionRow}>
                  <Pressable
                    onPress={() => {
                      setRejectingId(null);
                      setRejectionReason('');
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel rejection"
                  >
                    <ThemedText type="link">Cancel</ThemedText>
                  </Pressable>
                  <Pressable
                    style={[styles.smallButton, styles.buttonDanger, (!rejectionReason.trim() || actionPendingId === row.id) && styles.buttonDisabled]}
                    onPress={() => handleReject(row.id, row.isPaymentLink)}
                    disabled={!rejectionReason.trim() || actionPendingId === row.id}
                    accessibilityRole="button"
                    accessibilityLabel="Confirm rejection"
                    accessibilityState={{ disabled: !rejectionReason.trim() || actionPendingId === row.id, busy: actionPendingId === row.id }}
                  >
                    {actionPendingId === row.id ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.buttonPrimaryText}>Confirm Reject</ThemedText>}
                  </Pressable>
                </ThemedView>
              </>
            ) : (
              <ThemedView style={styles.actionRow}>
                <Pressable
                  onPress={() => setRejectingId(row.id)}
                  disabled={actionPendingId === row.id}
                  accessibilityRole="button"
                  accessibilityLabel="Reject"
                >
                  <ThemedText type="link" style={styles.dangerText}>Reject</ThemedText>
                </Pressable>
                <Pressable
                  style={[styles.smallButton, actionPendingId === row.id && styles.buttonDisabled]}
                  onPress={() => confirmApprove(row.id, row.isPaymentLink)}
                  disabled={actionPendingId === row.id}
                  accessibilityRole="button"
                  accessibilityLabel="Approve"
                  accessibilityState={{ disabled: actionPendingId === row.id, busy: actionPendingId === row.id }}
                >
                  {actionPendingId === row.id ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.buttonPrimaryText}>Approve</ThemedText>}
                </Pressable>
              </ThemedView>
            )}
          </ThemedView>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.four,
    gap: Spacing.two,
  },
  tabRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    backgroundColor: 'transparent',
  },
  tab: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    minHeight: 44,
    justifyContent: 'center',
  },
  tabSelected: {
    backgroundColor: '#047857',
    borderColor: '#047857',
  },
  tabTextSelected: {
    color: '#fff',
  },
  card: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: Spacing.three,
    backgroundColor: 'transparent',
  },
  smallButton: {
    backgroundColor: '#047857',
    borderRadius: 8,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
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
  dangerText: {
    color: '#B42318',
    fontWeight: '600',
  },
});
