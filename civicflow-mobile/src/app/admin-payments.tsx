import { Redirect, router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet } from 'react-native';

import { LoadErrorBanner } from '@/components/load-error-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { getAdminFinancialSummary, type AdminFinancialSummary } from '@/lib/mobile-api';

function centsToCurrency(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Mobile Admin program (PR D) — payments hub. Double-gated on managePayments
 * like every other admin screen. This is the landing point the dashboard's
 * "Dues Outstanding" / "Dues Collected" metrics deep-link to (see
 * (tabs)/admin.tsx + GET /api/mobile/admin/dashboard); it does not duplicate
 * that aggregation, it re-fetches the same getMemberPaymentsFinancialSummary
 * result plus the two pending-review counts. Record Payment / Add Adjustment
 * / Generate Charges are member-scoped actions and live on the member detail
 * screen (admin-members/[memberId]/index.tsx), not here.
 */
export default function AdminPaymentsScreen() {
  const { selectedOrganization, selectedOrganizationId } = useAuth();
  const hasManagePayments = Boolean(selectedOrganization?.capability?.adminCapabilities?.includes('managePayments'));
  const hasManageReports = Boolean(selectedOrganization?.capability?.adminCapabilities?.includes('manageReports'));

  const [summary, setSummary] = useState<AdminFinancialSummary | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !hasManagePayments) return;
    try {
      setSummary(await getAdminFinancialSummary(selectedOrganizationId));
      setLoadError(null);
    } catch {
      setLoadError('Unable to load financial summary. Check your connection and try again.');
    }
  }, [selectedOrganizationId, hasManagePayments]);

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

  const pendingTotal = summary ? summary.pendingPaymentReports + summary.pendingPaymentLinkReports : 0;

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
    >
      <ThemedText type="title">Payments</ThemedText>

      <LoadErrorBanner message={loadError} onRetry={load} />

      {summary ? (
        <ThemedView style={styles.metricsGrid}>
          <ThemedView type="backgroundElement" style={styles.metricCard}>
            <ThemedText type="small" themeColor="textSecondary">Dues Outstanding</ThemedText>
            <ThemedText type="subtitle">{centsToCurrency(summary.duesOutstandingCents)}</ThemedText>
          </ThemedView>
          <ThemedView type="backgroundElement" style={styles.metricCard}>
            <ThemedText type="small" themeColor="textSecondary">Dues Collected (30d)</ThemedText>
            <ThemedText type="subtitle">{centsToCurrency(summary.duesCollected30dCents)}</ThemedText>
          </ThemedView>
          <ThemedView type="backgroundElement" style={styles.metricCard}>
            <ThemedText type="small" themeColor="textSecondary">Total Dues Collected</ThemedText>
            <ThemedText type="subtitle">{centsToCurrency(summary.totalDuesCollectedCents)}</ThemedText>
          </ThemedView>
          <ThemedView type="backgroundElement" style={styles.metricCard}>
            <ThemedText type="small" themeColor="textSecondary">Total Contributions</ThemedText>
            <ThemedText type="subtitle">{centsToCurrency(summary.totalContributionsCents)}</ThemedText>
          </ThemedView>
        </ThemedView>
      ) : null}

      <ThemedView style={styles.section}>
        <Pressable
          onPress={() => router.push('/admin-contributions')}
          accessibilityRole="button"
          accessibilityLabel="Contributions"
        >
          <ThemedView type="backgroundElement" style={styles.linkCard}>
            <ThemedText type="smallBold">Contributions</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">View, record, and manage contributions</ThemedText>
          </ThemedView>
        </Pressable>

        <Pressable
          onPress={() => router.push('/admin-payment-reports')}
          accessibilityRole="button"
          accessibilityLabel={`Payment reports${pendingTotal > 0 ? `, ${pendingTotal} awaiting review` : ''}`}
        >
          <ThemedView type="backgroundElement" style={styles.linkCard}>
            <ThemedText type="smallBold">
              Payment Reports{pendingTotal > 0 ? ` (${pendingTotal})` : ''}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">Review self-reported and payment-link payments</ThemedText>
          </ThemedView>
        </Pressable>

        {hasManageReports ? (
          <Pressable onPress={() => router.push('/admin-reports')} accessibilityRole="button" accessibilityLabel="Reports">
            <ThemedView type="backgroundElement" style={styles.linkCard}>
              <ThemedText type="smallBold">Reports</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">Email yourself a financial or membership report</ThemedText>
            </ThemedView>
          </Pressable>
        ) : null}
      </ThemedView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  metricCard: {
    flexBasis: '47%',
    borderRadius: 12,
    padding: Spacing.three,
    gap: 4,
  },
  section: {
    gap: Spacing.two,
  },
  linkCard: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: 4,
    minHeight: 44,
  },
});
