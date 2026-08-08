import { Redirect, router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet } from 'react-native';

import { LoadErrorBanner } from '@/components/load-error-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { getAdminContributions, type AdminContributionListRow } from '@/lib/mobile-api';

function contributorLabel(row: AdminContributionListRow) {
  if (row.member) return `${row.member.firstName} ${row.member.lastName}`;
  if (row.campaign) return `Campaign: ${row.campaign.name}`;
  if (row.event) return `Event: ${row.event.title}`;
  return 'Unknown contributor';
}

/**
 * Mobile Admin program (PR D) — contribution list. Double-gated on
 * managePayments; the create/detail/edit/void screens further check the
 * specific contributions:read/write permission server-side (managePayments
 * alone doesn't imply it — see mobile-admin-payments.ts).
 */
export default function AdminContributionsScreen() {
  const { selectedOrganization, selectedOrganizationId } = useAuth();
  const hasManagePayments = Boolean(selectedOrganization?.capability?.adminCapabilities?.includes('managePayments'));

  const [contributions, setContributions] = useState<AdminContributionListRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !hasManagePayments) return;
    try {
      setContributions(await getAdminContributions(selectedOrganizationId));
      setLoadError(null);
    } catch {
      setLoadError('Unable to load contributions. Check your connection and try again.');
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

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
    >
      <ThemedView style={styles.headerRow}>
        <ThemedText type="title">Contributions</ThemedText>
        <Pressable
          style={styles.addButton}
          onPress={() => router.push('/admin-contributions/new')}
          accessibilityRole="button"
          accessibilityLabel="New contribution"
        >
          <ThemedText style={styles.addButtonText}>+ New</ThemedText>
        </Pressable>
      </ThemedView>

      <LoadErrorBanner message={loadError} onRetry={load} />

      {contributions.length === 0 && !loadError ? (
        <ThemedText type="small" themeColor="textSecondary">
          No contributions yet.
        </ThemedText>
      ) : (
        contributions.map((row) => (
          <Pressable
            key={row.id}
            onPress={() => router.push(`/admin-contributions/${row.id}`)}
            accessibilityRole="button"
            accessibilityLabel={`${contributorLabel(row)}, $${Number(row.amount).toFixed(2)}`}
          >
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">{contributorLabel(row)}</ThemedText>
              <ThemedView style={styles.cardMetaRow}>
                <ThemedText type="small" themeColor="textSecondary">${Number(row.amount).toFixed(2)}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{new Date(row.contributionDate).toLocaleDateString()}</ThemedText>
                {row.voidedAt ? <ThemedText type="small" style={styles.voidedTag}>Voided</ThemedText> : null}
              </ThemedView>
            </ThemedView>
          </Pressable>
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
  },
  addButton: {
    backgroundColor: '#047857',
    borderRadius: 10,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    minHeight: 44,
    justifyContent: 'center',
  },
  addButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  card: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: 4,
  },
  cardMetaRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    backgroundColor: 'transparent',
  },
  voidedTag: {
    color: '#B42318',
    fontWeight: '600',
  },
});
