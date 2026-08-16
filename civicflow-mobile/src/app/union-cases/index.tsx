import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { LoadErrorBanner } from '@/components/load-error-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
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

/**
 * Native "My Cases" -- replaces the old WebBrowser link-out to the web
 * member portal's /m/union/cases, which always showed the "get the app"
 * fallback banner because the system browser shares no session with the
 * app's own bearer-token auth. Read-only for now, same reduced-mobile-scope
 * reasoning as the rest of this app's member self-service surfaces.
 */
export default function UnionCasesScreen() {
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

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
    >
      <ThemedText type="small" themeColor="textSecondary">
        Issues you&apos;ve raised with {selectedOrganization?.organizationName ?? 'your union'}.
      </ThemedText>

      <LoadErrorBanner message={loadError} onRetry={load} />

      {cases.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No cases yet.
        </ThemedText>
      ) : (
        cases.map((c) => (
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
              <ThemedText type="small" themeColor="textSecondary">
                Submitted {new Date(c.createdAt).toLocaleDateString()}
              </ThemedText>
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
    gap: Spacing.three,
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
