import { Redirect, router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, TextInput } from 'react-native';

import { LoadErrorBanner } from '@/components/load-error-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { getAdminPtaHouseholds, type AdminPtaHouseholdListRow } from '@/lib/mobile-api';

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'INACTIVE', label: 'Inactive' },
];

/**
 * Mobile Admin program (PR E) — PTA household roster list. Double-gated on
 * managePtaHouseholds like every other admin screen; the create/detail/edit
 * screens further check the specific pta:households:manage/pta:students:
 * manage permission server-side (managePtaHouseholds alone doesn't imply
 * either — see mobile-admin-pta.ts).
 */
export default function AdminPtaHouseholdsScreen() {
  const { selectedOrganization, selectedOrganizationId } = useAuth();
  const hasManagePtaHouseholds = Boolean(selectedOrganization?.capability?.adminCapabilities?.includes('managePtaHouseholds'));

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [households, setHouseholds] = useState<AdminPtaHouseholdListRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !hasManagePtaHouseholds) return;
    try {
      setHouseholds(await getAdminPtaHouseholds(selectedOrganizationId, { search: search || undefined, status: status || undefined }));
      setLoadError(null);
    } catch {
      setLoadError('Unable to load households. Check your connection and try again.');
    }
  }, [selectedOrganizationId, hasManagePtaHouseholds, search, status]);

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

  if (!hasManagePtaHouseholds) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText type="subtitle" themeColor="textSecondary">
          You don&apos;t have household administration access for this organization.
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
        <ThemedText type="title">Households</ThemedText>
        <Pressable
          style={styles.addButton}
          onPress={() => router.push('/admin-pta-households/new')}
          accessibilityRole="button"
          accessibilityLabel="New household"
        >
          <ThemedText style={styles.addButtonText}>+ New</ThemedText>
        </Pressable>
      </ThemedView>

      <TextInput
        style={styles.input}
        placeholder="Search name, parent, or student"
        value={search}
        onChangeText={setSearch}
        accessibilityLabel="Search households"
        returnKeyType="search"
      />

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

      {households.length === 0 && !loadError ? (
        <ThemedText type="small" themeColor="textSecondary">
          {search || status ? 'No households match your search.' : 'No households yet.'}
        </ThemedText>
      ) : (
        households.map((household) => (
          <Pressable
            key={household.id}
            onPress={() => router.push(`/admin-pta-households/${household.id}`)}
            accessibilityRole="button"
            accessibilityLabel={household.displayName}
          >
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">{household.displayName}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {household.status} · {household.adults.length} adult{household.adults.length === 1 ? '' : 's'} ·{' '}
                {household.students.length} student{household.students.length === 1 ? '' : 's'}
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
  input: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
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
