import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { approvePtaHourEntry, getPendingPtaHourEntries, type PendingPtaHourEntry } from '@/lib/mobile-api';

/**
 * A simple approve-as-proposed queue — deliberately no "adjust before
 * approving" or "reject" affordance here (those stay on the web's fuller
 * hour-approval screen). Self-approval is still rejected server-side
 * (PTA_SELF_APPROVAL_FORBIDDEN) even though this screen has no way to
 * trigger it deliberately, since the pending list itself never includes the
 * caller's own entries in practice — but the guard exists regardless.
 */
export default function VolunteerHourApprovalsScreen() {
  const { selectedOrganization, selectedOrganizationId } = useAuth();
  const canApproveHours = Boolean(selectedOrganization?.pta?.canApproveHours);

  const [entries, setEntries] = useState<PendingPtaHourEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !canApproveHours) return;
    setEntries(await getPendingPtaHourEntries(selectedOrganizationId));
  }, [selectedOrganizationId, canApproveHours]);

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

  async function handleApprove(entryId: string) {
    if (!selectedOrganizationId || pendingId) return;
    setPendingId(entryId);
    try {
      await approvePtaHourEntry(selectedOrganizationId, entryId);
      await load();
    } catch (error) {
      Alert.alert('Unable to approve', error instanceof ApiError ? error.message : 'Please try again.');
    } finally {
      setPendingId(null);
    }
  }

  if (!canApproveHours) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText type="subtitle" themeColor="textSecondary">
          You don&apos;t have hour-approval access for this organization.
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
    >
      <ThemedText type="title">Hour Approvals</ThemedText>
      {entries.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">Nothing pending.</ThemedText>
      ) : (
        entries.map((entry) => {
          const isPending = pendingId === entry.id;
          return (
            <ThemedView key={entry.id} type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">{entry.volunteerName}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{entry.opportunityTitle}</ThemedText>
              <ThemedText type="default">{(entry.creditedMinutes / 60).toFixed(1)} hours proposed</ThemedText>
              <Pressable
                disabled={isPending}
                onPress={() => handleApprove(entry.id)}
                style={[styles.button, isPending && styles.buttonDisabled]}
                accessibilityRole="button"
                accessibilityLabel={`Approve ${(entry.creditedMinutes / 60).toFixed(1)} hours for ${entry.volunteerName}, ${entry.opportunityTitle}`}
                accessibilityState={{ disabled: isPending, busy: isPending }}
              >
                <ThemedText style={styles.buttonText}>{isPending ? 'Approving…' : 'Approve'}</ThemedText>
              </Pressable>
            </ThemedView>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  card: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: 4,
  },
  button: {
    marginTop: Spacing.two,
    borderRadius: 10,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    backgroundColor: '#047857',
    minHeight: 44,
    justifyContent: 'center',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
