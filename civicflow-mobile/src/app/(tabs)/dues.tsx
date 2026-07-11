import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { getDues, type DuesSummary } from '@/lib/mobile-api';

function formatCurrency(value: number) {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export default function DuesScreen() {
  const { selectedOrganizationId } = useAuth();
  const [summary, setSummary] = useState<DuesSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!selectedOrganizationId) return;
    const data = await getDues(selectedOrganizationId);
    setSummary(data);
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

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title">Dues Status</ThemedText>

      {!loading && summary ? (
        <ThemedView type="backgroundElement" style={styles.summaryCard}>
          <ThemedText type="small" themeColor="textSecondary">Outstanding Balance</ThemedText>
          <ThemedText type="subtitle">{formatCurrency(summary.outstandingBalance)}</ThemedText>
          {summary.isDelinquent ? (
            <ThemedText type="small" style={styles.delinquent}>
              Your dues are past due{summary.delinquentSince ? ` since ${new Date(summary.delinquentSince).toLocaleDateString()}` : ''}.
            </ThemedText>
          ) : null}
        </ThemedView>
      ) : null}

      <Pressable style={styles.reportButton} onPress={() => router.push('/report-payment')}>
        <ThemedText style={styles.reportButtonText}>Report a Payment</ThemedText>
      </Pressable>

      <Pressable style={styles.linkButton} onPress={() => router.push('/payment-history')}>
        <ThemedText type="link">View Payment History</ThemedText>
      </Pressable>

      <Pressable style={styles.linkButton} onPress={() => router.push('/make-payment')}>
        <ThemedText type="link">Pay dues in advance, or contribute to a campaign or event</ThemedText>
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
  delinquent: {
    color: '#B42318',
    marginTop: 4,
  },
  reportButton: {
    backgroundColor: '#047857',
    borderRadius: 10,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  reportButtonText: {
    color: '#fff',
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
