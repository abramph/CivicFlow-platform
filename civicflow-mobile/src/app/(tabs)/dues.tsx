import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { API_BASE_URL } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { getDues, getPtaDues, type DuesSummary, type PtaDuesStatus, type PtaDuesSummary } from '@/lib/mobile-api';

function formatCurrency(value: number) {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function formatCentsCurrency(cents: number) {
  return formatCurrency(cents / 100);
}

const STATUS_LABELS: Record<PtaDuesStatus, string> = {
  NO_CHARGE: 'No charge on file',
  UNPAID: 'Unpaid',
  PARTIALLY_PAID: 'Partially paid',
  PAID: 'Paid',
  WAIVED: 'Waived',
  VOIDED: 'Voided',
  PENDING_REVIEW: 'Payment pending review',
};

const STATUS_STYLES: Record<PtaDuesStatus, 'good' | 'warning' | 'due' | 'neutral'> = {
  NO_CHARGE: 'neutral',
  UNPAID: 'due',
  PARTIALLY_PAID: 'warning',
  PAID: 'good',
  WAIVED: 'good',
  VOIDED: 'neutral',
  PENDING_REVIEW: 'warning',
};

export default function DuesScreen() {
  const { selectedOrganization, selectedOrganizationId } = useAuth();
  const hasMemberIdentity = Boolean(selectedOrganization?.memberId);
  const hasPtaIdentity = Boolean(selectedOrganization?.pta?.householdAdultId);
  const [summary, setSummary] = useState<DuesSummary | null>(null);
  const [ptaSummary, setPtaSummary] = useState<PtaDuesSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!selectedOrganizationId) return;
    if (hasMemberIdentity) {
      setSummary(await getDues(selectedOrganizationId));
    } else if (hasPtaIdentity) {
      setPtaSummary(await getPtaDues(selectedOrganizationId));
    }
  }, [selectedOrganizationId, hasMemberIdentity, hasPtaIdentity]);

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

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (hasPtaIdentity && !hasMemberIdentity) {
    const charge = ptaSummary?.currentCharge ?? null;
    const statusStyle = charge ? STATUS_STYLES[charge.status] : 'neutral';

    return (
      <ThemedView style={styles.container}>
        <ThemedText type="title">Membership Dues</ThemedText>

        {!loading && ptaSummary?.hasBillingIdentity === false ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            Your household doesn&apos;t have a dues billing record yet. Contact your PTA if you believe this is a mistake.
          </ThemedText>
        ) : null}

        {!loading && charge ? (
          <ThemedView type="backgroundElement" style={styles.summaryCard}>
            <ThemedText type="small" themeColor="textSecondary">
              {ptaSummary?.currentSchoolYear ?? 'Current'} membership
            </ThemedText>
            <ThemedText type="subtitle">{formatCentsCurrency(charge.remainingBalanceCents)} remaining</ThemedText>
            <ThemedText type="small" style={statusStyle === 'due' ? styles.due : statusStyle === 'warning' ? styles.warning : statusStyle === 'good' ? styles.good : undefined}>
              {STATUS_LABELS[charge.status]}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Due {new Date(charge.dueDate).toLocaleDateString()} · {formatCentsCurrency(charge.amountDueCents)} due · {formatCentsCurrency(charge.amountPaidCents)} paid
            </ThemedText>
          </ThemedView>
        ) : null}

        {charge && charge.adjustments.length > 0 ? (
          <>
            <ThemedText type="smallBold" style={styles.sectionLabel}>Adjustments</ThemedText>
            {charge.adjustments.map((adj) => (
              <ThemedView key={adj.id} type="backgroundElement" style={styles.chargeRow}>
                <ThemedText type="smallBold">{adj.type.replace('_', ' ')} · {formatCentsCurrency(adj.amountCents)}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{adj.reason}</ThemedText>
              </ThemedView>
            ))}
          </>
        ) : null}

        {charge && charge.payments.length > 0 ? (
          <>
            <ThemedText type="smallBold" style={styles.sectionLabel}>Payments</ThemedText>
            {charge.payments.map((p) => (
              <ThemedView key={p.id} type="backgroundElement" style={styles.chargeRow}>
                <ThemedText type="smallBold">{formatCentsCurrency(p.amountCents)} · {p.method}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{new Date(p.paymentDate).toLocaleDateString()}</ThemedText>
              </ThemedView>
            ))}
          </>
        ) : null}

        {ptaSummary?.onlinePaymentLinkSlug ? (
          <Pressable
            style={styles.payButton}
            onPress={() => WebBrowser.openBrowserAsync(`${API_BASE_URL}/pay/${ptaSummary.onlinePaymentLinkSlug}`)}
          >
            <ThemedText style={styles.payButtonText}>Open Payment Options</ThemedText>
          </Pressable>
        ) : null}

        {charge && charge.status !== 'PAID' && charge.status !== 'WAIVED' && charge.status !== 'VOIDED' ? (
          <Pressable style={styles.reportButton} onPress={() => router.push('/pta-report-payment')}>
            <ThemedText style={styles.reportButtonText}>Report a Payment</ThemedText>
          </Pressable>
        ) : null}

        {ptaSummary && ptaSummary.priorCharges.length > 0 ? (
          <>
            <ThemedText type="smallBold" style={styles.sectionLabel}>Prior school years</ThemedText>
            <FlatList
              data={ptaSummary.priorCharges}
              keyExtractor={(item) => item.id}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
              contentContainerStyle={styles.list}
              renderItem={({ item }) => (
                <ThemedView type="backgroundElement" style={styles.chargeRow}>
                  <ThemedText type="smallBold">{STATUS_LABELS[item.status]}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Due {new Date(item.dueDate).toLocaleDateString()} · {formatCentsCurrency(item.amountDueCents)} due · {formatCentsCurrency(item.amountPaidCents)} paid
                  </ThemedText>
                </ThemedView>
              )}
            />
          </>
        ) : null}
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title">Dues Status</ThemedText>

      {!loading && summary ? (
        <ThemedView type="backgroundElement" style={styles.summaryCard}>
          <ThemedText type="small" themeColor="textSecondary">Outstanding Balance</ThemedText>
          <ThemedText type="subtitle">{formatCurrency(summary.outstandingBalance)}</ThemedText>
          {summary.isDelinquent ? (
            <ThemedText type="small" style={styles.due}>
              Your dues are past due{summary.delinquentSince ? ` since ${new Date(summary.delinquentSince).toLocaleDateString()}` : ''}.
            </ThemedText>
          ) : null}
        </ThemedView>
      ) : null}

      <Pressable style={styles.payButton} onPress={() => router.push('/make-payment')}>
        <ThemedText style={styles.payButtonText}>Make a Payment</ThemedText>
      </Pressable>

      <Pressable style={styles.reportButton} onPress={() => router.push('/report-payment')}>
        <ThemedText style={styles.reportButtonText}>Report a Payment</ThemedText>
      </Pressable>

      <Pressable style={styles.linkButton} onPress={() => router.push('/payment-history')}>
        <ThemedText type="link">View Payment History</ThemedText>
      </Pressable>

      <ThemedText type="smallBold" style={styles.sectionLabel}>Charges</ThemedText>
      <FlatList
        data={summary?.charges ?? []}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <ThemedView type="backgroundElement" style={styles.chargeRow}>
            <ThemedText type="smallBold">{item.duesAccount.name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Due {new Date(item.dueDate).toLocaleDateString()} · {item.status}
            </ThemedText>
            <ThemedText type="small">
              {formatCurrency(Number(item.amountDue))} due · {formatCurrency(Number(item.amountPaid))} paid
            </ThemedText>
          </ThemedView>
        )}
        ListEmptyComponent={
          !loading ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              No dues charges on file.
            </ThemedText>
          ) : null
        }
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  summaryCard: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: 4,
  },
  due: {
    color: '#B42318',
    marginTop: 4,
  },
  warning: {
    color: '#B54708',
    marginTop: 4,
  },
  good: {
    color: '#047857',
    marginTop: 4,
  },
  payButton: {
    backgroundColor: '#047857',
    borderRadius: 10,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  payButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  reportButton: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 10,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  reportButtonText: {
    fontWeight: '600',
  },
  linkButton: {
    alignSelf: 'center',
  },
  sectionLabel: {
    marginTop: Spacing.two,
  },
  list: {
    gap: Spacing.two,
  },
  chargeRow: {
    borderRadius: 10,
    padding: Spacing.three,
    gap: 2,
  },
  empty: {
    textAlign: 'center',
    marginTop: Spacing.four,
  },
});
