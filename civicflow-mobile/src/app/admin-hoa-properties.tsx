import { Redirect, router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, TextInput } from 'react-native';

import { LoadErrorBanner } from '@/components/load-error-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { getAdminHoaProperties, type AdminHoaPropertyListRow } from '@/lib/mobile-api';

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Archived' },
];

function propertyLabel(property: AdminHoaPropertyListRow) {
  if (property.displayName) return property.displayName;
  return property.unitLabel ? `${property.addressLine1} · ${property.unitLabel}` : property.addressLine1;
}

/**
 * Mobile Admin program (PR E) — HOA property list. Double-gated on
 * manageHoaProperties; the resident sub-screens further check
 * hoa:residents:read/write server-side (manageHoaProperties alone doesn't
 * imply either — see mobile-admin-hoa.ts).
 */
export default function AdminHoaPropertiesScreen() {
  const { selectedOrganization, selectedOrganizationId } = useAuth();
  const hasManageHoaProperties = Boolean(selectedOrganization?.capability?.adminCapabilities?.includes('manageHoaProperties'));

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [properties, setProperties] = useState<AdminHoaPropertyListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !hasManageHoaProperties) return;
    try {
      const result = await getAdminHoaProperties(selectedOrganizationId, { search: search || undefined, status: status || undefined });
      setProperties(result.properties);
      setTotal(result.total);
      setLoadError(null);
    } catch {
      setLoadError('Unable to load properties. Check your connection and try again.');
    }
  }, [selectedOrganizationId, hasManageHoaProperties, search, status]);

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

  if (!hasManageHoaProperties) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText type="subtitle" themeColor="textSecondary">
          You don&apos;t have property administration access for this organization.
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
        <ThemedText type="title">Properties</ThemedText>
        <Pressable
          style={styles.addButton}
          onPress={() => router.push('/admin-hoa-properties/new')}
          accessibilityRole="button"
          accessibilityLabel="New property"
        >
          <ThemedText style={styles.addButtonText}>+ New</ThemedText>
        </Pressable>
      </ThemedView>

      <TextInput
        style={styles.input}
        placeholder="Search address or unit"
        value={search}
        onChangeText={setSearch}
        accessibilityLabel="Search properties"
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

      {properties.length === 0 && !loadError ? (
        <ThemedText type="small" themeColor="textSecondary">
          {search || status ? 'No properties match your search.' : 'No properties yet.'}
        </ThemedText>
      ) : (
        properties.map((property) => (
          <Pressable
            key={property.id}
            onPress={() => router.push(`/admin-hoa-properties/${property.id}`)}
            accessibilityRole="button"
            accessibilityLabel={propertyLabel(property)}
          >
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">{propertyLabel(property)}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {property.status === 'INACTIVE' ? 'Archived · ' : ''}
                {property._count.residents} active resident{property._count.residents === 1 ? '' : 's'}
              </ThemedText>
            </ThemedView>
          </Pressable>
        ))
      )}

      {properties.length > 0 && properties.length < total ? (
        <ThemedText type="small" themeColor="textSecondary">Showing {properties.length} of {total}. Refine your search to narrow results.</ThemedText>
      ) : null}
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
