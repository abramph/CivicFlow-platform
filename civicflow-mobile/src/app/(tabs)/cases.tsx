import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { LoadErrorBanner } from '@/components/load-error-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useScreenTopPadding } from '@/hooks/use-screen-top-padding';
import { useAuth } from '@/lib/auth-context';
import { getUnionCases, type UnionCaseStatus, type UnionCaseSummary } from '@/lib/mobile-api';

const STATUS_LABELS: Record<UnionCaseStatus, string> = {
  NEW: 'New',
  TRIAGE: 'Under review',
  ASSIGNED: 'Assigned',
  ACTIVE: 'In progress',
  PENDING: 'Waiting',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
  WITHDRAWN: 'Withdrawn',
};

const OPEN_STATUSES: UnionCaseStatus[] = ['NEW', 'TRIAGE', 'ASSIGNED', 'ACTIVE'];
const RESOLVED_STATUSES: UnionCaseStatus[] = ['RESOLVED', 'CLOSED', 'WITHDRAWN'];

function groupCases(cases: UnionCaseSummary[]) {
  return {
    open: cases.filter((c) => OPEN_STATUSES.includes(c.status)),
    awaitingResponse: cases.filter((c) => c.status === 'PENDING'),
    resolved: cases.filter((c) => RESOLVED_STATUSES.includes(c.status)),
  };
}

/**
 * Union Cases tab — "My union is here when I need it." Get Help is the
 * first thing a member sees, above every case list, so it never requires
 * scrolling to find (mirrors the design goal in the Union mobile UX
 * correction: get help -> communicate -> track -> know what's happening,
 * not dashboard -> payments -> generic app features).
 */
export default function CasesScreen() {
  const { selectedOrganizationId, selectedOrganization } = useAuth();
  const [cases, setCases] = useState<UnionCaseSummary[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedOrganizationId) return;
    try {
      setCases(await getUnionCases(selectedOrganizationId));
      setLoadError(null);
    } catch {
      setLoadError('Unable to load your cases. Check your connection and try again.');
    }
  }, [selectedOrganizationId]);

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

  const topPadding = useScreenTopPadding();
  const { open, awaitingResponse, resolved } = groupCases(cases);

  return (
    <ScrollView
      contentContainerStyle={[styles.container, topPadding]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
    >
      <ThemedText type="title">Cases</ThemedText>

      <Pressable
        style={styles.getHelpButton}
        onPress={() => router.push('/union-cases/get-help')}
        accessibilityRole="button"
        accessibilityLabel="Get Union Help"
      >
        <ThemedText style={styles.getHelpTitle}>Get Union Help</ThemedText>
        <ThemedText style={styles.getHelpSubtitle}>Tell us what&apos;s going on and a steward will follow up.</ThemedText>
      </Pressable>

      <LoadErrorBanner message={loadError} onRetry={load} />

      {cases.length === 0 && !loadError ? (
        <ThemedView type="backgroundElement" style={styles.emptyState}>
          <ThemedText type="smallBold">No current cases</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.emptyStateBody}>
            If you have a workplace concern, contract question, or need representation, {selectedOrganization?.organizationName ?? 'your union'} can help.
          </ThemedText>
          <Pressable
            style={styles.emptyStateButton}
            onPress={() => router.push('/union-cases/get-help')}
            accessibilityRole="button"
            accessibilityLabel="Get Help"
          >
            <ThemedText style={styles.emptyStateButtonText}>Get Help</ThemedText>
          </Pressable>
        </ThemedView>
      ) : (
        <>
          <CaseGroup title="Open" cases={open} />
          <CaseGroup title="Awaiting Response" cases={awaitingResponse} />
          <CaseGroup title="Resolved" cases={resolved} />
        </>
      )}
    </ScrollView>
  );
}

function CaseGroup({ title, cases }: { title: string; cases: UnionCaseSummary[] }) {
  if (cases.length === 0) return null;
  return (
    <View style={styles.group}>
      <ThemedText type="smallBold" style={styles.groupLabel}>{title}</ThemedText>
      {cases.map((c) => {
        const latestUpdate = c.comments[0] ?? null;
        const nextDate = c.upcomingDates[0] ?? null;
        return (
          <Pressable
            key={c.id}
            onPress={() => router.push(`/union-cases/${c.id}`)}
            accessibilityRole="button"
            accessibilityLabel={`UC-${c.caseNumber}, ${c.title}, ${STATUS_LABELS[c.status]}`}
          >
            <ThemedView type="backgroundElement" style={styles.card}>
              <View style={styles.cardHeader}>
                <ThemedText type="smallBold" style={styles.cardTitle}>
                  UC-{c.caseNumber} · {c.title}
                </ThemedText>
                <View style={styles.statusPill}>
                  <ThemedText type="small">{STATUS_LABELS[c.status]}</ThemedText>
                </View>
              </View>
              {c.representativeName ? (
                <ThemedText type="small" themeColor="textSecondary">Union Representative: {c.representativeName}</ThemedText>
              ) : null}
              {latestUpdate ? (
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>{latestUpdate.body}</ThemedText>
              ) : null}
              {nextDate ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Next: {nextDate.description ?? nextDate.deadlineType.replace(/_/g, ' ').toLowerCase()} — {new Date(nextDate.dueAt).toLocaleDateString()}
                </ThemedText>
              ) : null}
            </ThemedView>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  getHelpButton: {
    backgroundColor: '#047857',
    borderRadius: 14,
    padding: Spacing.four,
    gap: 4,
  },
  getHelpTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  getHelpSubtitle: {
    color: '#D1FAE5',
    fontSize: 13,
  },
  emptyState: {
    borderRadius: 14,
    padding: Spacing.four,
    gap: Spacing.two,
    alignItems: 'flex-start',
  },
  emptyStateBody: {
    lineHeight: 20,
  },
  emptyStateButton: {
    marginTop: Spacing.one,
    backgroundColor: '#047857',
    borderRadius: 10,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  emptyStateButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  group: {
    gap: Spacing.two,
  },
  groupLabel: {
    marginTop: Spacing.one,
  },
  card: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: 4,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  cardTitle: {
    flex: 1,
  },
  statusPill: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
});
