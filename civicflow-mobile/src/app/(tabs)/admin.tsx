import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet } from 'react-native';

import { LoadErrorBanner } from '@/components/load-error-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useScreenTopPadding } from '@/hooks/use-screen-top-padding';
import { useAuth } from '@/lib/auth-context';
import { getAdminDashboard, type AdminDashboard } from '@/lib/mobile-api';

/**
 * Mobile Admin program (PR A) — the Admin tab's landing dashboard. Double-gated
 * like volunteer-checkin.tsx/volunteer-hour-approvals.tsx: the tab itself is
 * already hidden for a caller with no admin capability (see
 * (tabs)/_layout.tsx), and this screen independently re-checks the same
 * server-resolved adminCapabilities array before rendering anything, so a
 * direct/deep-link navigation can't bypass the gate.
 *
 * Quick Actions is deliberately not rendered in PR A — no member/event/
 * payment/report admin screens exist on mobile yet (PR B-E), and showing
 * buttons that go nowhere would be worse than showing nothing. Metrics and
 * Needs Attention only ever include what GET /api/mobile/admin/dashboard
 * actually returns, which itself only includes what the caller's real
 * permissions and this org's vertical support today.
 */
export default function AdminDashboardScreen() {
  const { selectedOrganization, selectedOrganizationId } = useAuth();
  const hasAdminAccess = Boolean(selectedOrganization?.capability?.adminCapabilities?.length);

  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !hasAdminAccess) return;
    try {
      setDashboard(await getAdminDashboard(selectedOrganizationId));
      setLoadError(null);
    } catch {
      setLoadError('Unable to load the admin dashboard. Check your connection and try again.');
    }
  }, [selectedOrganizationId, hasAdminAccess]);

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

  if (!hasAdminAccess) {
    return (
      <ThemedView style={[styles.container, topPadding]}>
        <ThemedText type="subtitle" themeColor="textSecondary">
          You don&apos;t have administration access for this organization.
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={[styles.container, topPadding]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
    >
      <ThemedText type="title">Admin</ThemedText>
      <ThemedText type="subtitle" themeColor="textSecondary">
        {selectedOrganization?.organizationName ?? 'Unestra'}
      </ThemedText>

      <LoadErrorBanner message={loadError} onRetry={load} />

      {dashboard && dashboard.needsAttention.length > 0 ? (
        <ThemedView style={styles.section}>
          <ThemedText type="subtitle">Needs Attention</ThemedText>
          {dashboard.needsAttention.map((item) => (
            <Pressable
              key={item.id}
              style={styles.attentionRow}
              onPress={() => router.push(item.href as never)}
              accessibilityRole="button"
              accessibilityLabel={item.label}
            >
              <ThemedView type="backgroundElement" style={styles.card}>
                <ThemedText type="default">{item.label}</ThemedText>
              </ThemedView>
            </Pressable>
          ))}
        </ThemedView>
      ) : null}

      {dashboard && dashboard.metrics.length > 0 ? (
        <ThemedView style={styles.section}>
          <ThemedText type="subtitle">Organization Snapshot</ThemedText>
          <ThemedView style={styles.metricsGrid}>
            {dashboard.metrics.map((metric) => {
              const card = (
                <ThemedView type="backgroundElement" style={styles.metricCard}>
                  <ThemedText type="small" themeColor="textSecondary">{metric.label}</ThemedText>
                  <ThemedText type="subtitle">{metric.value}</ThemedText>
                </ThemedView>
              );
              if (!metric.href) {
                return (
                  <ThemedView key={metric.key} style={styles.metricTile}>
                    {card}
                  </ThemedView>
                );
              }
              return (
                <Pressable
                  key={metric.key}
                  style={styles.metricTile}
                  onPress={() => router.push(metric.href as never)}
                  accessibilityRole="button"
                  accessibilityLabel={`${metric.label}, ${metric.value}`}
                >
                  {card}
                </Pressable>
              );
            })}
          </ThemedView>
        </ThemedView>
      ) : null}

      {dashboard && dashboard.metrics.length === 0 && dashboard.needsAttention.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Nothing to show here yet for your role in this organization.
        </ThemedText>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  section: {
    gap: Spacing.two,
  },
  card: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: 4,
  },
  attentionRow: {
    minHeight: 44,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  metricTile: {
    flexBasis: '47%',
    minHeight: 44,
  },
  metricCard: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: 4,
  },
});
