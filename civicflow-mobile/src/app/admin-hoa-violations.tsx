import { Redirect, router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet } from 'react-native';

import { LoadErrorBanner } from '@/components/load-error-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { getAdminHoaViolations, type AdminHoaViolationListRow, type HoaViolationStatus } from '@/lib/mobile-api';

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'ISSUED', label: 'Issued' },
  { value: 'ACKNOWLEDGED', label: 'Acknowledged' },
  { value: 'IN_REVIEW', label: 'In Review' },
  { value: 'CURED', label: 'Cured' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'DISMISSED', label: 'Dismissed' },
];

const STATUS_LABELS: Record<HoaViolationStatus, string> = {
  DRAFT: 'Draft',
  ISSUED: 'Issued',
  ACKNOWLEDGED: 'Acknowledged',
  IN_REVIEW: 'In Review',
  CURED: 'Cured',
  RESOLVED: 'Resolved',
  DISMISSED: 'Dismissed',
};

function propertyLabel(property: AdminHoaViolationListRow['property']) {
  if (property.displayName) return property.displayName;
  return property.unitLabel ? `${property.addressLine1} · ${property.unitLabel}` : property.addressLine1;
}

/** Mobile Admin program (PR E) — HOA violation list. Double-gated on manageHoaViolations. */
export default function AdminHoaViolationsScreen() {
  const { selectedOrganization, selectedOrganizationId } = useAuth();
  const hasManageHoaViolations = Boolean(selectedOrganization?.capability?.adminCapabilities?.includes('manageHoaViolations'));

  const [status, setStatus] = useState('');
  const [violations, setViolations] = useState<AdminHoaViolationListRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !hasManageHoaViolations) return;
    try {
      setViolations(await getAdminHoaViolations(selectedOrganizationId, { status: status || undefined }));
      setLoadError(null);
    } catch {
      setLoadError('Unable to load violations. Check your connection and try again.');
    }
  }, [selectedOrganizationId, hasManageHoaViolations, status]);

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

  if (!hasManageHoaViolations) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText type="subtitle" themeColor="textSecondary">
          You don&apos;t have violation administration access for this organization.
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
        <ThemedText type="title">Violations</ThemedText>
        <Pressable
          style={styles.addButton}
          onPress={() => router.push('/admin-hoa-violations/new')}
          accessibilityRole="button"
          accessibilityLabel="New violation"
        >
          <ThemedText style={styles.addButtonText}>+ New</ThemedText>
        </Pressable>
      </ThemedView>

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

      {violations.length === 0 && !loadError ? (
        <ThemedText type="small" themeColor="textSecondary">
          {status ? 'No violations match this filter.' : 'No violations yet.'}
        </ThemedText>
      ) : (
        violations.map((violation) => (
          <Pressable
            key={violation.id}
            onPress={() => router.push(`/admin-hoa-violations/${violation.id}`)}
            accessibilityRole="button"
            accessibilityLabel={`${violation.violationType}, ${propertyLabel(violation.property)}`}
          >
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">{violation.violationType}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{propertyLabel(violation.property)}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{STATUS_LABELS[violation.status]}</ThemedText>
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
