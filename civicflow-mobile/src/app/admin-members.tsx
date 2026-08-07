import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, TextInput } from 'react-native';

import { LoadErrorBanner } from '@/components/load-error-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { getAdminMembers, type AdminMemberListRow } from '@/lib/mobile-api';

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'deactivated', label: 'Deactivated' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'terminated', label: 'Terminated' },
];

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/**
 * Mobile Admin program (PR B) — member list. Double-gated like every other
 * admin screen: the Admin tab already hides "Manage Members" for a caller
 * without manageMembers, and this screen independently re-checks the same
 * server-resolved adminCapabilities array so a direct/deep-link navigation
 * can't bypass the gate. Search/status-filter semantics mirror the web
 * /members page (src/lib/member-filters.ts on the server) exactly.
 */
export default function AdminMembersScreen() {
  const { selectedOrganization, selectedOrganizationId } = useAuth();
  const hasManageMembers = Boolean(selectedOrganization?.capability?.adminCapabilities?.includes('manageMembers'));
  const params = useLocalSearchParams<{ membershipStatus?: string; delinquency?: string }>();

  const [search, setSearch] = useState('');
  const [membershipStatus, setMembershipStatus] = useState(params.membershipStatus ?? '');
  const [delinquencyOnly] = useState(params.delinquency === 'delinquent');
  const [members, setMembers] = useState<AdminMemberListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(
    async (nextPage: number, append: boolean) => {
      if (!selectedOrganizationId || !hasManageMembers) return;
      try {
        const result = await getAdminMembers(selectedOrganizationId, {
          search: search || undefined,
          membershipStatus: membershipStatus || undefined,
          delinquency: delinquencyOnly ? 'delinquent' : undefined,
          page: nextPage,
        });
        setMembers((prev) => (append ? [...prev, ...result.members] : result.members));
        setTotal(result.total);
        setHasMore(result.hasMore);
        setPage(result.page);
        setLoadError(null);
      } catch {
        setLoadError('Unable to load members. Check your connection and try again.');
      }
    },
    [selectedOrganizationId, hasManageMembers, search, membershipStatus, delinquencyOnly]
  );

  useEffect(() => {
    (async () => {
      await load(1, false);
    })();
  }, [load]);

  async function handleRefresh() {
    setRefreshing(true);
    await load(1, false);
    setRefreshing(false);
  }

  async function handleLoadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    await load(page + 1, true);
    setLoadingMore(false);
  }

  if (!selectedOrganizationId) {
    return <Redirect href="/org-switcher" />;
  }

  if (!hasManageMembers) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText type="subtitle" themeColor="textSecondary">
          You don&apos;t have member administration access for this organization.
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
        <ThemedText type="title">Members</ThemedText>
        <Pressable
          style={styles.addButton}
          onPress={() => router.push('/admin-members/new')}
          accessibilityRole="button"
          accessibilityLabel="Add member"
        >
          <ThemedText style={styles.addButtonText}>+ Add</ThemedText>
        </Pressable>
      </ThemedView>

      <TextInput
        style={styles.input}
        placeholder="Search name, email, or phone"
        value={search}
        onChangeText={setSearch}
        accessibilityLabel="Search members"
        returnKeyType="search"
      />

      <ThemedView style={styles.filterRow} accessibilityRole="radiogroup" accessibilityLabel="Membership status filter">
        {STATUS_FILTERS.map((filter) => (
          <Pressable
            key={filter.value}
            style={[styles.filterChip, filter.value === membershipStatus && styles.filterChipSelected]}
            onPress={() => setMembershipStatus(filter.value)}
            accessibilityRole="radio"
            accessibilityLabel={filter.label}
            accessibilityState={{ selected: filter.value === membershipStatus }}
          >
            <ThemedText type="small" style={filter.value === membershipStatus ? styles.filterChipTextSelected : undefined}>
              {filter.label}
            </ThemedText>
          </Pressable>
        ))}
      </ThemedView>

      <LoadErrorBanner message={loadError} onRetry={() => load(1, false)} />

      {members.length === 0 && !loadError ? (
        <ThemedText type="small" themeColor="textSecondary">
          {search || membershipStatus ? 'No members match your search.' : 'No members yet.'}
        </ThemedText>
      ) : (
        members.map((member) => (
          <Pressable
            key={member.id}
            onPress={() => router.push(`/admin-members/${member.id}`)}
            accessibilityRole="button"
            accessibilityLabel={`${member.preferredName ?? member.firstName} ${member.lastName}`}
          >
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">
                {member.preferredName ?? member.firstName} {member.lastName}
              </ThemedText>
              <ThemedView style={styles.cardMetaRow}>
                <ThemedText type="small" themeColor="textSecondary">
                  {statusLabel(member.membershipStatus)}
                </ThemedText>
                {member.isDelinquent ? (
                  <ThemedText type="small" style={styles.delinquentTag}>
                    Delinquent
                  </ThemedText>
                ) : null}
              </ThemedView>
              {member.email ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {member.email}
                </ThemedText>
              ) : null}
            </ThemedView>
          </Pressable>
        ))
      )}

      {hasMore ? (
        <Pressable
          style={[styles.loadMoreButton, loadingMore && styles.buttonDisabled]}
          onPress={handleLoadMore}
          disabled={loadingMore}
          accessibilityRole="button"
          accessibilityLabel="Load more members"
          accessibilityState={{ disabled: loadingMore, busy: loadingMore }}
        >
          <ThemedText type="link">{loadingMore ? 'Loading…' : `Load more (${members.length} of ${total})`}</ThemedText>
        </Pressable>
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
  cardMetaRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    backgroundColor: 'transparent',
  },
  delinquentTag: {
    color: '#B42318',
    fontWeight: '600',
  },
  loadMoreButton: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    minHeight: 44,
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
