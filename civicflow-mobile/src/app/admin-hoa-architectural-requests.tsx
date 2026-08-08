import { Redirect, router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet } from 'react-native';

import { LoadErrorBanner } from '@/components/load-error-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { getAdminHoaArchitecturalRequests, type AdminHoaArchitecturalRequestListRow, type HoaArchitecturalRequestStatus } from '@/lib/mobile-api';

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'SUBMITTED', label: 'Submitted' },
  { value: 'IN_REVIEW', label: 'In Review' },
  { value: 'CHANGES_REQUESTED', label: 'Changes Requested' },
  { value: 'RESUBMITTED', label: 'Resubmitted' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'DENIED', label: 'Denied' },
];

const STATUS_LABELS: Record<HoaArchitecturalRequestStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  IN_REVIEW: 'In Review',
  CHANGES_REQUESTED: 'Changes Requested',
  RESUBMITTED: 'Resubmitted',
  APPROVED: 'Approved',
  CONDITIONALLY_APPROVED: 'Conditionally Approved',
  DENIED: 'Denied',
  WITHDRAWN: 'Withdrawn',
  EXPIRED: 'Expired',
};

function propertyLabel(property: AdminHoaArchitecturalRequestListRow['property']) {
  if (property.displayName) return property.displayName;
  return property.unitLabel ? `${property.addressLine1} · ${property.unitLabel}` : property.addressLine1;
}

/**
 * Mobile Admin program (PR E) — HOA architectural requests, READ ONLY (plus
 * commenting on the detail screen). There is no "New" button and no
 * approve/deny action anywhere in this screen tree — requests are
 * resident-submitted, and deciding one is a board-level action that stays
 * web-only by design (see docs/hoa-mobile-strategy.md).
 */
export default function AdminHoaArchitecturalRequestsScreen() {
  const { selectedOrganization, selectedOrganizationId } = useAuth();
  const hasManageHoaArchitecturalRequests = Boolean(selectedOrganization?.capability?.adminCapabilities?.includes('manageHoaArchitecturalRequests'));

  const [status, setStatus] = useState('');
  const [requests, setRequests] = useState<AdminHoaArchitecturalRequestListRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !hasManageHoaArchitecturalRequests) return;
    try {
      setRequests(await getAdminHoaArchitecturalRequests(selectedOrganizationId, { status: status || undefined }));
      setLoadError(null);
    } catch {
      setLoadError('Unable to load requests. Check your connection and try again.');
    }
  }, [selectedOrganizationId, hasManageHoaArchitecturalRequests, status]);

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

  if (!hasManageHoaArchitecturalRequests) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText type="subtitle" themeColor="textSecondary">
          You don&apos;t have architectural request access for this organization.
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
    >
      <ThemedText type="title">Architectural Requests</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        View and comment here. Approvals and denials are handled on the web portal.
      </ThemedText>

      <ThemedView style={styles.filterRow} accessibilityRole="radiogroup" accessibilityLabel="Status filter">
        {STATUS_FILTERS.map((filter) => (
          <Pressable
            key={filter.value}
            style={[styles.filterChip, filter.value === status && styles.filterChipSelected]}
            onPress={() => setStatus(filter.value)}
            accessibilityRole="radio"
            accessibilityLabel={filter.label}
            accessibilityState={{ selected: filter.value === status }}
          >
            <ThemedText type="small" style={filter.value === status ? styles.filterChipTextSelected : undefined}>
              {filter.label}
            </ThemedText>
          </Pressable>
        ))}
      </ThemedView>

      <LoadErrorBanner message={loadError} onRetry={load} />

      {requests.length === 0 && !loadError ? (
        <ThemedText type="small" themeColor="textSecondary">
          {status ? 'No requests match this filter.' : 'No architectural requests yet.'}
        </ThemedText>
      ) : (
        requests.map((request) => (
          <Pressable
            key={request.id}
            onPress={() => router.push(`/admin-hoa-architectural-requests/${request.id}`)}
            accessibilityRole="button"
            accessibilityLabel={`${request.title}, ${propertyLabel(request.property)}`}
          >
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">AR-{request.requestNumber} · {request.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{propertyLabel(request.property)} · {request.category}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{STATUS_LABELS[request.status]}</ThemedText>
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
  card: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: 4,
  },
});
