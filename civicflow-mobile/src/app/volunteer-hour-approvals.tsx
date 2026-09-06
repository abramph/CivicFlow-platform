import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ActionColors, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { approvePtaHourEntry, getPendingPtaHourEntries, rejectPtaHourEntry, type PendingPtaHourEntry } from '@/lib/mobile-api';

/**
 * The pending volunteer-hour queue. Build 27 added Decline alongside
 * Approve — the mobile queue previously had no way to say no, so every
 * decline meant switching to the web. A decline always requires a reason
 * (enforced server-side too): it lands in the entry's notes and the audit
 * event, so families always learn why. "Adjust before approving" stays
 * web-only. Self-approval is still rejected server-side
 * (PTA_SELF_APPROVAL_FORBIDDEN) even though this screen has no way to
 * trigger it deliberately.
 */
export default function VolunteerHourApprovalsScreen() {
  const { selectedOrganization, selectedOrganizationId } = useAuth();
  const canApproveHours = Boolean(selectedOrganization?.pta?.canApproveHours);

  const [entries, setEntries] = useState<PendingPtaHourEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState('');

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

  async function handleDecline(entryId: string) {
    if (!selectedOrganizationId || pendingId) return;
    if (!declineReason.trim()) {
      Alert.alert('Reason required', 'Add a short note explaining the decline — the family will see it.');
      return;
    }
    setPendingId(entryId);
    try {
      await rejectPtaHourEntry(selectedOrganizationId, entryId, declineReason.trim());
      setDecliningId(null);
      setDeclineReason('');
      await load();
    } catch (error) {
      Alert.alert('Unable to decline', error instanceof ApiError ? error.message : 'Please try again.');
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
          const isDeclining = decliningId === entry.id;
          return (
            <ThemedView key={entry.id} type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">{entry.volunteerName}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{entry.opportunityTitle}</ThemedText>
              <ThemedText type="default">{(entry.creditedMinutes / 60).toFixed(1)} hours proposed</ThemedText>

              {isDeclining ? (
                <>
                  <TextInput
                    style={styles.reasonInput}
                    value={declineReason}
                    onChangeText={setDeclineReason}
                    placeholder="Reason (the family will see this)"
                    accessibilityLabel={`Reason for declining ${entry.volunteerName}'s hours`}
                    multiline
                  />
                  <Pressable
                    disabled={isPending}
                    onPress={() => handleDecline(entry.id)}
                    style={[styles.declineButton, isPending && styles.buttonDisabled]}
                    accessibilityRole="button"
                    accessibilityLabel={`Confirm decline for ${entry.volunteerName}`}
                    accessibilityState={{ disabled: isPending, busy: isPending }}
                  >
                    <ThemedText style={styles.buttonText}>{isPending ? 'Declining…' : 'Confirm Decline'}</ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      setDecliningId(null);
                      setDeclineReason('');
                    }}
                    style={styles.cancelLink}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel decline"
                  >
                    <ThemedText type="link">Cancel</ThemedText>
                  </Pressable>
                </>
              ) : (
                <>
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
                  <Pressable
                    disabled={isPending}
                    onPress={() => {
                      setDecliningId(entry.id);
                      setDeclineReason('');
                    }}
                    style={styles.declineLink}
                    accessibilityRole="button"
                    accessibilityLabel={`Decline hours for ${entry.volunteerName}`}
                    accessibilityState={{ disabled: isPending }}
                  >
                    <ThemedText type="link" style={styles.declineLinkText}>Decline…</ThemedText>
                  </Pressable>
                </>
              )}
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
    backgroundColor: ActionColors.primary,
    minHeight: 44,
    justifyContent: 'center',
  },
  declineButton: {
    marginTop: Spacing.two,
    borderRadius: 10,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    backgroundColor: ActionColors.danger,
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
  reasonInput: {
    borderWidth: 1,
    borderColor: ActionColors.border,
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  declineLink: {
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'center',
  },
  declineLinkText: {
    color: ActionColors.danger,
  },
  cancelLink: {
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'center',
  },
});
