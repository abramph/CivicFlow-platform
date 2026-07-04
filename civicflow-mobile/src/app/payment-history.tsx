import { Redirect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { getPaymentHistory, type DuesPaymentRow, type PaymentReportRow } from '@/lib/mobile-api';

type Row =
  | { kind: 'payment'; id: string; date: string; label: string; amount: string }
  | { kind: 'report'; id: string; date: string; label: string; amount: string; status: string; rejectionReason: string | null };

function toRows(payments: DuesPaymentRow[], reports: PaymentReportRow[]): Row[] {
  const paymentRows: Row[] = payments.map((p) => ({
    kind: 'payment',
    id: p.id,
    date: p.paymentDate,
    label: `Confirmed · ${p.method.replace('_', ' ')}`,
    amount: p.amount,
  }));
  const reportRows: Row[] = reports.map((r) => ({
    kind: 'report',
    id: r.id,
    date: r.paymentDate,
    label: `Reported · ${r.paymentMethod.replace('_', ' ')}`,
    amount: r.amount,
    status: r.status,
    rejectionReason: r.rejectionReason,
  }));
  return [...paymentRows, ...reportRows].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export default function PaymentHistoryScreen() {
  const { status, selectedOrganizationId } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!selectedOrganizationId) return;
    const data = await getPaymentHistory(selectedOrganizationId);
    setRows(toRows(data.payments, data.reports));
  }, [selectedOrganizationId]);

  useEffect(() => {
    load();
  }, [load]);

  if (status === 'signedOut') {
    return <Redirect href={{ pathname: '/login', params: { redirectTo: '/payment-history' } }} />;
  }

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title">Payment History</ThemedText>
      <FlatList
        data={rows}
        keyExtractor={(item) => `${item.kind}-${item.id}`}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <ThemedView type="backgroundElement" style={styles.row}>
            <ThemedText type="smallBold">
              ${Number(item.amount).toFixed(2)} · {new Date(item.date).toLocaleDateString()}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {item.label}
              {item.kind === 'report' ? ` · ${item.status}` : ''}
            </ThemedText>
            {item.kind === 'report' && item.status === 'rejected' && item.rejectionReason ? (
              <ThemedText type="small" style={styles.rejected}>{item.rejectionReason}</ThemedText>
            ) : null}
          </ThemedView>
        )}
        ListEmptyComponent={
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            No payments or reports yet.
          </ThemedText>
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
  list: {
    gap: Spacing.two,
  },
  row: {
    borderRadius: 10,
    padding: Spacing.three,
    gap: 2,
  },
  rejected: {
    color: '#B42318',
  },
  empty: {
    textAlign: 'center',
    marginTop: Spacing.five,
  },
});
