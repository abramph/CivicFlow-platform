import { Redirect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { getPaymentHistory, type DuesPaymentRow, type PaymentReportRow } from '@/lib/mobile-api';

const CATEGORY_LABELS: Record<string, string> = {
  MEMBERSHIP_DUES: 'Membership Dues',
  EVENT_REGISTRATION: 'Event Registration',
  DONATION: 'Donation',
  FUNDRAISER: 'Fundraiser',
  MERCHANDISE: 'Merchandise',
  SPONSORSHIP: 'Sponsorship',
  ASSESSMENT: 'Assessment',
  OTHER: 'Other',
};

const STATUS_FILTERS = ['All', 'Pending', 'Approved', 'Rejected'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

type Row =
  | { kind: 'payment'; id: string; date: string; label: string; category: string; amount: string }
  | {
      kind: 'report';
      id: string;
      date: string;
      label: string;
      category: string;
      amount: string;
      status: string;
      rejectionReason: string | null;
    };

function toRows(payments: DuesPaymentRow[], reports: PaymentReportRow[]): Row[] {
  const paymentRows: Row[] = payments.map((p) => ({
    kind: 'payment',
    id: p.id,
    date: p.paymentDate,
    label: `Confirmed · ${p.method.replace('_', ' ')}`,
    category: CATEGORY_LABELS.MEMBERSHIP_DUES,
    amount: p.amount,
  }));
  const reportRows: Row[] = reports.map((r) => ({
    kind: 'report',
    id: r.id,
    date: r.paymentDate,
    label: `Reported · ${r.paymentMethod.replace('_', ' ')}`,
    category: CATEGORY_LABELS[r.category] ?? r.category,
    amount: r.amount,
    status: r.status,
    rejectionReason: r.rejectionReason,
  }));
  return [...paymentRows, ...reportRows].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

function matchesFilter(row: Row, filter: StatusFilter): boolean {
  if (filter === 'All') return true;
  if (row.kind === 'payment') return filter === 'Approved';
  return row.status === filter.toLowerCase();
}

export default function PaymentHistoryScreen() {
  const { status, selectedOrganizationId } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>('All');

  const load = useCallback(async () => {
    if (!selectedOrganizationId) return;
    const data = await getPaymentHistory(selectedOrganizationId);
    setRows(toRows(data.payments, data.reports));
  }, [selectedOrganizationId]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const filteredRows = useMemo(() => rows.filter((row) => matchesFilter(row, filter)), [rows, filter]);

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
      <ThemedView style={styles.filterRow}>
        {STATUS_FILTERS.map((option) => (
          <Pressable
            key={option}
            style={[styles.filterChip, option === filter && styles.filterChipSelected]}
            onPress={() => setFilter(option)}
          >
            <ThemedText type="small" style={option === filter ? styles.filterChipTextSelected : undefined}>
              {option}
            </ThemedText>
          </Pressable>
        ))}
      </ThemedView>
      <FlatList
        data={filteredRows}
        keyExtractor={(item) => `${item.kind}-${item.id}`}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <ThemedView type="backgroundElement" style={styles.row}>
            <ThemedText type="smallBold">
              ${Number(item.amount).toFixed(2)} · {new Date(item.date).toLocaleDateString()}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {item.category} · {item.label}
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
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    backgroundColor: 'transparent',
  },
  filterChip: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  filterChipSelected: {
    backgroundColor: '#047857',
    borderColor: '#047857',
  },
  filterChipTextSelected: {
    color: '#fff',
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
