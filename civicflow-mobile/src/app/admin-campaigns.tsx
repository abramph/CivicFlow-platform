import { Redirect, router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet } from 'react-native';

import { LoadErrorBanner } from '@/components/load-error-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { getAdminCampaigns, type AdminCampaignListRow, type CampaignStatus } from '@/lib/mobile-api';

const STATUS_LABELS: Record<CampaignStatus, string> = {
  DRAFT: 'Draft',
  READY: 'Ready',
  SENDING: 'Sending',
  SENT: 'Sent',
  FAILED: 'Failed',
  CANCELED: 'Canceled',
};

/**
 * Mobile Admin program (PR C) — campaign list. Double-gated on
 * manageCommunications like every other admin screen.
 */
export default function AdminCampaignsScreen() {
  const { selectedOrganization, selectedOrganizationId } = useAuth();
  const hasManageCommunications = Boolean(selectedOrganization?.capability?.adminCapabilities?.includes('manageCommunications'));

  const [campaigns, setCampaigns] = useState<AdminCampaignListRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !hasManageCommunications) return;
    try {
      setCampaigns(await getAdminCampaigns(selectedOrganizationId));
      setLoadError(null);
    } catch {
      setLoadError('Unable to load campaigns. Check your connection and try again.');
    }
  }, [selectedOrganizationId, hasManageCommunications]);

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

  if (!hasManageCommunications) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText type="subtitle" themeColor="textSecondary">
          You don&apos;t have communications administration access for this organization.
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
        <ThemedText type="title">Campaigns</ThemedText>
        <Pressable
          style={styles.addButton}
          onPress={() => router.push('/admin-campaigns/new')}
          accessibilityRole="button"
          accessibilityLabel="New campaign"
        >
          <ThemedText style={styles.addButtonText}>+ New</ThemedText>
        </Pressable>
      </ThemedView>

      <LoadErrorBanner message={loadError} onRetry={load} />

      {campaigns.length === 0 && !loadError ? (
        <ThemedText type="small" themeColor="textSecondary">
          No campaigns yet.
        </ThemedText>
      ) : (
        campaigns.map((campaign) => (
          <Pressable
            key={campaign.id}
            onPress={() => router.push(`/admin-campaigns/${campaign.id}`)}
            accessibilityRole="button"
            accessibilityLabel={campaign.title}
          >
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">{campaign.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {STATUS_LABELS[campaign.status]} · {campaign._count.recipients} recipient{campaign._count.recipients === 1 ? '' : 's'}
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
});
