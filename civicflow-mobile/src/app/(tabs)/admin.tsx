import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet } from 'react-native';

import { LoadErrorBanner } from '@/components/load-error-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Card, EmptyState, IconBadge, SectionHeader, StatTile, WorkspaceHero } from '@/components/ui';
import { Elevation, Radii, Spacing, WorkspaceColors } from '@/constants/theme';
import { useScreenTopPadding } from '@/hooks/use-screen-top-padding';
import { useAuth } from '@/lib/auth-context';
import { getAdminDashboard, type AdminDashboard } from '@/lib/mobile-api';
import { deriveOrgCapabilities } from '@/lib/org-capabilities';

/**
 * The Admin workspace's landing dashboard. Double-gated like
 * volunteer-checkin.tsx/volunteer-hour-approvals.tsx: the tab itself is
 * already hidden for a caller with no admin capability (see
 * (tabs)/_layout.tsx), and this screen independently re-checks the same
 * server-resolved adminCapabilities array before rendering anything, so a
 * direct/deep-link navigation can't bypass the gate.
 *
 * Build 27 made this operational rather than a metric grid: pending work
 * leads (Needs Attention), capability-gated Quick Actions follow (the
 * server includes an action only when the caller holds the capability
 * behind it), and manageOrganization holders get a recent-administrative-
 * activity feed. Everything rendered comes from GET
 * /api/mobile/admin/dashboard — the client never derives admin content
 * from role or permission strings.
 */
export default function AdminDashboardScreen() {
  const { selectedOrganization, selectedOrganizationId } = useAuth();
  const caps = deriveOrgCapabilities(selectedOrganization);
  const hasAdminAccess = caps.hasAdminAccess;

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
      {/* The slate hero is the admin workspace's identity — same product,
          visibly different room from the parent-green surfaces. */}
      <WorkspaceHero
        workspace="admin"
        title="Admin"
        subtitle={selectedOrganization?.organizationName ?? 'Unestra'}
        note={
          caps.hasParentIdentity || caps.hasMemberIdentity
            ? `You're in the admin workspace — your own ${caps.hasParentIdentity ? 'family and ' : ''}member screens stay in the other tabs.`
            : null
        }
      />

      <LoadErrorBanner message={loadError} onRetry={load} />

      {dashboard && dashboard.needsAttention.length > 0 ? (
        <ThemedView style={styles.section}>
          <SectionHeader title="Needs Attention" />
          {dashboard.needsAttention.map((item) => (
            <Pressable
              key={item.id}
              style={styles.attentionRow}
              onPress={() => router.push(item.href as never)}
              accessibilityRole="button"
              accessibilityLabel={item.label}
            >
              <Card style={styles.attentionCard}>
                <IconBadge glyph="!" tone="pending" />
                <ThemedText type="default" style={styles.attentionLabel}>
                  {item.label}
                </ThemedText>
              </Card>
            </Pressable>
          ))}
        </ThemedView>
      ) : null}

      {/* F-05: an empty queue is a state worth saying out loud, not a
          silently missing section — zero pending items reads as "caught
          up", never as "this dashboard has nothing". Suppressed for a
          truly empty dashboard, which keeps its own message below. */}
      {dashboard &&
      dashboard.needsAttention.length === 0 &&
      (dashboard.metrics.length > 0 || (dashboard.quickActions?.length ?? 0) > 0) ? (
        <Card>
          <EmptyState
            title="You're all caught up"
            body="Nothing needs your attention right now. Pending volunteer hours and family change requests will appear here."
          />
        </Card>
      ) : null}

      {dashboard && (dashboard.quickActions?.length ?? 0) > 0 ? (
        <ThemedView style={styles.section}>
          <SectionHeader title="Quick Actions" />
          <ThemedView style={styles.quickActionsRow}>
            {dashboard.quickActions!.map((action) => (
              <Pressable
                key={action.key}
                style={styles.quickActionButton}
                onPress={() => router.push(action.href as never)}
                accessibilityRole="button"
                accessibilityLabel={action.label}
              >
                <ThemedText style={styles.quickActionText}>{action.label}</ThemedText>
              </Pressable>
            ))}
          </ThemedView>
        </ThemedView>
      ) : null}

      {dashboard && dashboard.metrics.length > 0 ? (
        <ThemedView style={styles.section}>
          <SectionHeader title="Organization Snapshot" />
          <ThemedView style={styles.metricsGrid}>
            {dashboard.metrics.map((metric) => {
              if (!metric.href) {
                return (
                  <ThemedView key={metric.key} style={styles.metricTile}>
                    <StatTile label={metric.label} value={metric.value} />
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
                  <StatTile label={metric.label} value={metric.value} />
                </Pressable>
              );
            })}
          </ThemedView>
        </ThemedView>
      ) : null}

      {dashboard && (dashboard.recentActivity?.length ?? 0) > 0 ? (
        <ThemedView style={styles.section}>
          <SectionHeader title="Recent Activity" />
          {dashboard.recentActivity!.map((item) => (
            <Card
              key={item.id}
              style={styles.activityCard}
              accessible
              accessibilityLabel={`${item.action.replace(/[._]/g, ' ')}, ${new Date(item.createdAt).toLocaleString()}`}
            >
              <ThemedText type="small">{item.action.replace(/[._]/g, ' ')}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {item.actorEmail ? `${item.actorEmail} · ` : ''}
                {new Date(item.createdAt).toLocaleString()}
              </ThemedText>
            </Card>
          ))}
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
  attentionRow: {
    minHeight: 44,
  },
  attentionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + Spacing.one,
  },
  attentionLabel: {
    flex: 1,
  },
  activityCard: {
    gap: 4,
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
  quickActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  // The admin workspace's own accent — deliberately NOT the parent green,
  // so the two workspaces read differently at a glance while sharing the
  // same shapes and type scale.
  quickActionButton: {
    backgroundColor: WorkspaceColors.adminAccent,
    borderRadius: Radii.sm,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
    ...(Elevation.card as object),
  },
  quickActionText: {
    color: WorkspaceColors.adminHeaderText,
    fontWeight: '600',
  },
});
