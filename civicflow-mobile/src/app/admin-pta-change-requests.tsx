import { Redirect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput } from 'react-native';

import { LoadErrorBanner } from '@/components/load-error-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ActionColors, Spacing } from '@/constants/theme';
import { useScreenTopPadding } from '@/hooks/use-screen-top-padding';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import {
  approveAdminPtaChangeRequest,
  getAdminPtaChangeRequests,
  rejectAdminPtaChangeRequest,
  type AdminPtaChangeRequest,
} from '@/lib/mobile-api';

/**
 * Build 27 — the officer review queue for parent-submitted family change
 * requests. Approving APPLIES the change to the real household/student/
 * enrollment records server-side (see family-change-requests.ts in the
 * portal); a CAS claim there makes double-decisions impossible, so two
 * officers working the queue at once get a clean "already reviewed" rather
 * than a double-apply. Oldest first — the queue is worked in submission
 * order.
 */

function describeRequest(request: AdminPtaChangeRequest): string {
  const p = request.payload as Record<string, string | undefined>;
  switch (request.type) {
    case 'HOUSEHOLD_DISPLAY_NAME':
      return `Rename family to “${p.displayName ?? '?'}”`;
    case 'ADD_STUDENT':
      return `Add student “${p.displayName ?? '?'}”`;
    case 'RENAME_STUDENT':
      return `Correct a student's name to “${p.displayName ?? '?'}”`;
    case 'STUDENT_PLACEMENT':
      return "Change a student's class placement";
    case 'REMOVE_STUDENT':
      return 'Remove a student from the household';
  }
}

export default function AdminPtaChangeRequestsScreen() {
  const { selectedOrganization, selectedOrganizationId } = useAuth();
  const hasManagePtaHouseholds = Boolean(selectedOrganization?.capability?.adminCapabilities?.includes('managePtaHouseholds'));
  const topPadding = useScreenTopPadding();

  const [requests, setRequests] = useState<AdminPtaChangeRequest[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNotes, setRejectNotes] = useState('');

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !hasManagePtaHouseholds) return;
    try {
      setRequests(await getAdminPtaChangeRequests(selectedOrganizationId, 'SUBMITTED'));
      setLoadError(null);
    } catch {
      setLoadError('Unable to load change requests. Check your connection and try again.');
    }
  }, [selectedOrganizationId, hasManagePtaHouseholds]);

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

  async function handleApprove(request: AdminPtaChangeRequest) {
    if (!selectedOrganizationId || pendingId) return;
    setPendingId(request.id);
    try {
      await approveAdminPtaChangeRequest(request.id, selectedOrganizationId);
      await load();
    } catch (error) {
      Alert.alert('Unable to approve', error instanceof ApiError ? error.message : 'Please try again.');
      await load();
    } finally {
      setPendingId(null);
    }
  }

  async function handleReject(request: AdminPtaChangeRequest) {
    if (!selectedOrganizationId || pendingId) return;
    setPendingId(request.id);
    try {
      await rejectAdminPtaChangeRequest(request.id, selectedOrganizationId, rejectNotes.trim() || null);
      setRejectingId(null);
      setRejectNotes('');
      await load();
    } catch (error) {
      Alert.alert('Unable to reject', error instanceof ApiError ? error.message : 'Please try again.');
      await load();
    } finally {
      setPendingId(null);
    }
  }

  if (selectedOrganization && !hasManagePtaHouseholds) {
    return (
      <ThemedView style={[styles.container, topPadding]}>
        <ThemedText type="subtitle" themeColor="textSecondary">
          You don&apos;t have household administration access for this organization.
        </ThemedText>
      </ThemedView>
    );
  }
  if (!selectedOrganizationId) {
    return <Redirect href="/org-switcher" />;
  }

  return (
    <ScrollView
      contentContainerStyle={[styles.container, topPadding]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
    >
      <ThemedText type="title">Family Change Requests</ThemedText>
      <LoadErrorBanner message={loadError} onRetry={load} />

      {requests.length === 0 && !loadError ? (
        <ThemedText type="small" themeColor="textSecondary">Nothing waiting for review.</ThemedText>
      ) : (
        requests.map((request) => {
          const isPending = pendingId === request.id;
          const isRejecting = rejectingId === request.id;
          return (
            <ThemedView key={request.id} type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">{request.householdName}</ThemedText>
              <ThemedText type="default">{describeRequest(request)}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Submitted {new Date(request.createdAt).toLocaleDateString()}
              </ThemedText>

              {isRejecting ? (
                <>
                  <TextInput
                    style={styles.notesInput}
                    value={rejectNotes}
                    onChangeText={setRejectNotes}
                    placeholder="Note for the family (optional)"
                    accessibilityLabel={`Rejection note for ${request.householdName}`}
                    multiline
                  />
                  <Pressable
                    disabled={isPending}
                    onPress={() => handleReject(request)}
                    style={[styles.rejectButton, isPending && styles.buttonDisabled]}
                    accessibilityRole="button"
                    accessibilityLabel={`Confirm rejection for ${request.householdName}`}
                    accessibilityState={{ disabled: isPending, busy: isPending }}
                  >
                    <ThemedText style={styles.buttonText}>{isPending ? 'Rejecting…' : 'Confirm Reject'}</ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      setRejectingId(null);
                      setRejectNotes('');
                    }}
                    style={styles.centerLink}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel rejection"
                  >
                    <ThemedText type="link">Cancel</ThemedText>
                  </Pressable>
                </>
              ) : (
                <>
                  <Pressable
                    disabled={isPending}
                    onPress={() => handleApprove(request)}
                    style={[styles.approveButton, isPending && styles.buttonDisabled]}
                    accessibilityRole="button"
                    accessibilityLabel={`Approve and apply: ${describeRequest(request)} for ${request.householdName}`}
                    accessibilityState={{ disabled: isPending, busy: isPending }}
                  >
                    <ThemedText style={styles.buttonText}>{isPending ? 'Applying…' : 'Approve & Apply'}</ThemedText>
                  </Pressable>
                  <Pressable
                    disabled={isPending}
                    onPress={() => {
                      setRejectingId(request.id);
                      setRejectNotes('');
                    }}
                    style={styles.centerLink}
                    accessibilityRole="button"
                    accessibilityLabel={`Reject: ${describeRequest(request)} for ${request.householdName}`}
                    accessibilityState={{ disabled: isPending }}
                  >
                    <ThemedText type="link" style={styles.rejectLinkText}>Reject…</ThemedText>
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
    padding: Spacing.four,
    gap: Spacing.three,
  },
  card: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  approveButton: {
    borderRadius: 10,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    backgroundColor: ActionColors.primary,
    minHeight: 44,
    justifyContent: 'center',
  },
  rejectButton: {
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
  notesInput: {
    borderWidth: 1,
    borderColor: ActionColors.border,
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  centerLink: {
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'center',
  },
  rejectLinkText: {
    color: ActionColors.danger,
  },
});
