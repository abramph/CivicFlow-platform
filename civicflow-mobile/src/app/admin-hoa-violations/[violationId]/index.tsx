import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { LoadErrorBanner } from '@/components/load-error-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import {
  addAdminHoaViolationComment,
  getAdminHoaViolation,
  issueAdminHoaViolation,
  transitionAdminHoaViolation,
  type AdminHoaViolationDetail,
  type AdminHoaViolationTransitionTarget,
  type HoaViolationStatus,
} from '@/lib/mobile-api';

const STATUS_LABELS: Record<HoaViolationStatus, string> = {
  DRAFT: 'Draft',
  ISSUED: 'Issued',
  ACKNOWLEDGED: 'Acknowledged',
  IN_REVIEW: 'In Review',
  CURED: 'Cured',
  RESOLVED: 'Resolved',
  DISMISSED: 'Dismissed',
};

/** Mirrors violations.ts's TRANSITIONS map for UI purposes only -- the server independently enforces both the state machine and the review-vs-resolve permission gate on every transition. */
const NEXT_STATUSES: Record<HoaViolationStatus, AdminHoaViolationTransitionTarget[]> = {
  DRAFT: ['DISMISSED'],
  ISSUED: ['ACKNOWLEDGED', 'IN_REVIEW', 'CURED', 'DISMISSED'],
  ACKNOWLEDGED: ['IN_REVIEW', 'CURED', 'DISMISSED'],
  IN_REVIEW: ['CURED', 'RESOLVED', 'DISMISSED'],
  CURED: [],
  RESOLVED: [],
  DISMISSED: [],
};

const TERMINAL_STATUSES: HoaViolationStatus[] = ['CURED', 'RESOLVED', 'DISMISSED'];

function propertyLabel(property: AdminHoaViolationDetail['property']) {
  if (property.displayName) return property.displayName;
  return property.unitLabel ? `${property.addressLine1} · ${property.unitLabel}` : property.addressLine1;
}

/**
 * Mobile Admin program (PR E) — HOA violation detail. Re-fetches by
 * (violationId, organizationId) on every mount. The status-change chips
 * mirror the server's state machine for a sensible UI, but the server is
 * the sole authority -- a stale/incorrect client render just produces a
 * 400/403, never a security gap.
 */
export default function AdminHoaViolationDetailScreen() {
  const { selectedOrganization, selectedOrganizationId } = useAuth();
  const hasManageHoaViolations = Boolean(selectedOrganization?.capability?.adminCapabilities?.includes('manageHoaViolations'));
  const { violationId } = useLocalSearchParams<{ violationId: string }>();

  const [violation, setViolation] = useState<AdminHoaViolationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);

  const [showIssueForm, setShowIssueForm] = useState(false);
  const [noticeBody, setNoticeBody] = useState('');

  const [targetStatus, setTargetStatus] = useState<AdminHoaViolationTransitionTarget | null>(null);
  const [transitionNotes, setTransitionNotes] = useState('');

  const [commentBody, setCommentBody] = useState('');

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !violationId || !hasManageHoaViolations) return;
    try {
      setViolation(await getAdminHoaViolation(selectedOrganizationId, violationId));
      setLoadError(null);
    } catch (error) {
      setViolation(null);
      setLoadError(error instanceof ApiError && error.status === 404 ? 'This violation could not be found.' : 'Unable to load this violation. Check your connection and try again.');
    }
  }, [selectedOrganizationId, violationId, hasManageHoaViolations]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await load();
      } finally {
        setLoading(false);
      }
    })();
  }, [load]);

  async function handleIssue() {
    if (!selectedOrganizationId || !violationId || !noticeBody.trim() || actionPending) return;
    setActionPending(true);
    try {
      await issueAdminHoaViolation(violationId, selectedOrganizationId, noticeBody.trim());
      setShowIssueForm(false);
      setNoticeBody('');
      await load();
    } catch (error) {
      Alert.alert('Unable to issue violation', error instanceof ApiError ? error.message : 'Please try again.');
    } finally {
      setActionPending(false);
    }
  }

  function confirmTransition() {
    if (!targetStatus) return;
    Alert.alert(`Move to ${STATUS_LABELS[targetStatus]}?`, TERMINAL_STATUSES.includes(targetStatus) ? 'This closes the violation record.' : undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', onPress: handleTransition },
    ]);
  }

  async function handleTransition() {
    if (!selectedOrganizationId || !violationId || !targetStatus || actionPending) return;
    setActionPending(true);
    try {
      await transitionAdminHoaViolation(violationId, selectedOrganizationId, targetStatus, {
        notes: transitionNotes.trim() || undefined,
        resolutionNotes: TERMINAL_STATUSES.includes(targetStatus) ? transitionNotes.trim() || undefined : undefined,
      });
      setTargetStatus(null);
      setTransitionNotes('');
      await load();
    } catch (error) {
      Alert.alert('Unable to update status', error instanceof ApiError ? error.message : 'Please try again.');
    } finally {
      setActionPending(false);
    }
  }

  async function handleAddComment() {
    if (!selectedOrganizationId || !violationId || !commentBody.trim() || actionPending) return;
    setActionPending(true);
    try {
      await addAdminHoaViolationComment(violationId, selectedOrganizationId, commentBody.trim(), true);
      setCommentBody('');
      await load();
    } catch (error) {
      Alert.alert('Unable to add comment', error instanceof ApiError ? error.message : 'Please try again.');
    } finally {
      setActionPending(false);
    }
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

  if (loading) {
    return (
      <ThemedView style={styles.loadingContainer} accessibilityRole="progressbar" accessibilityLabel="Loading violation">
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (!violation) {
    return (
      <ThemedView style={styles.container}>
        <LoadErrorBanner message={loadError ?? 'This violation could not be found.'} onRetry={load} />
      </ThemedView>
    );
  }

  const nextStatuses = NEXT_STATUSES[violation.status];

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ThemedText type="title">{violation.violationType}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {propertyLabel(violation.property)} · {STATUS_LABELS[violation.status]}
      </ThemedText>

      <ThemedView type="backgroundElement" style={styles.card}>
        <ThemedText type="small">{violation.description}</ThemedText>
        {violation.cureByDate ? (
          <ThemedText type="small" themeColor="textSecondary">Cure by {new Date(violation.cureByDate).toLocaleDateString()}</ThemedText>
        ) : null}
        {violation.resolutionNotes ? (
          <ThemedText type="small" themeColor="textSecondary">Resolution: {violation.resolutionNotes}</ThemedText>
        ) : null}
      </ThemedView>

      {violation.status === 'DRAFT' ? (
        <ThemedView style={styles.section}>
          {!showIssueForm ? (
            <Pressable style={styles.button} onPress={() => setShowIssueForm(true)} accessibilityRole="button" accessibilityLabel="Issue violation">
              <ThemedText style={styles.buttonText}>Issue Violation</ThemedText>
            </Pressable>
          ) : (
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">Issue this violation</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">This sends the resident their first notice.</ThemedText>
              <TextInput style={[styles.input, styles.multiline]} placeholder="Notice text" value={noticeBody} onChangeText={setNoticeBody} accessibilityLabel="Notice text" multiline />
              <ThemedView style={styles.actionRow}>
                <Pressable onPress={() => setShowIssueForm(false)} accessibilityRole="button" accessibilityLabel="Cancel">
                  <ThemedText type="link">Cancel</ThemedText>
                </Pressable>
                <Pressable
                  style={[styles.smallButton, (!noticeBody.trim() || actionPending) && styles.buttonDisabled]}
                  onPress={handleIssue}
                  disabled={!noticeBody.trim() || actionPending}
                  accessibilityRole="button"
                  accessibilityLabel="Confirm issue"
                  accessibilityState={{ disabled: !noticeBody.trim() || actionPending, busy: actionPending }}
                >
                  {actionPending ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.buttonText}>Confirm Issue</ThemedText>}
                </Pressable>
              </ThemedView>
            </ThemedView>
          )}
        </ThemedView>
      ) : null}

      {nextStatuses.length > 0 ? (
        <ThemedView style={styles.section}>
          <ThemedText type="subtitle">Change Status</ThemedText>
          <ThemedView style={styles.chipRow} accessibilityRole="radiogroup" accessibilityLabel="Next status">
            {nextStatuses.map((next) => (
              <Pressable
                key={next}
                style={[styles.chip, targetStatus === next && styles.chipSelected]}
                onPress={() => setTargetStatus(next === targetStatus ? null : next)}
                accessibilityRole="radio"
                accessibilityLabel={STATUS_LABELS[next]}
                accessibilityState={{ selected: targetStatus === next }}
              >
                <ThemedText type="small" style={targetStatus === next ? styles.chipTextSelected : undefined}>{STATUS_LABELS[next]}</ThemedText>
              </Pressable>
            ))}
          </ThemedView>
          {targetStatus ? (
            <>
              <TextInput
                style={[styles.input, styles.multiline]}
                placeholder={TERMINAL_STATUSES.includes(targetStatus) ? 'Resolution notes (optional)' : 'Notes (optional)'}
                value={transitionNotes}
                onChangeText={setTransitionNotes}
                accessibilityLabel="Transition notes, optional"
                multiline
              />
              <Pressable
                style={[styles.button, actionPending && styles.buttonDisabled]}
                onPress={confirmTransition}
                disabled={actionPending}
                accessibilityRole="button"
                accessibilityLabel={`Confirm move to ${STATUS_LABELS[targetStatus]}`}
                accessibilityState={{ disabled: actionPending, busy: actionPending }}
              >
                {actionPending ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.buttonText}>Confirm</ThemedText>}
              </Pressable>
            </>
          ) : null}
        </ThemedView>
      ) : null}

      {violation.notices.length > 0 ? (
        <ThemedView style={styles.section}>
          <ThemedText type="subtitle">Notices</ThemedText>
          {violation.notices.map((notice) => (
            <ThemedView key={notice.id} type="backgroundElement" style={styles.card}>
              <ThemedText type="small">{notice.noticeType} · {new Date(notice.sentAt).toLocaleDateString()}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{notice.body}</ThemedText>
            </ThemedView>
          ))}
        </ThemedView>
      ) : null}

      <ThemedView style={styles.section}>
        <ThemedText type="subtitle">Comments</ThemedText>
        {violation.comments.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">No comments yet.</ThemedText>
        ) : (
          violation.comments.map((comment) => (
            <ThemedView key={comment.id} type="backgroundElement" style={styles.card}>
              <ThemedText type="small">{comment.body}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {new Date(comment.createdAt).toLocaleDateString()} · {comment.isPrivate ? 'Private' : 'Resident-visible'}
              </ThemedText>
            </ThemedView>
          ))
        )}
        <TextInput style={[styles.input, styles.multiline]} placeholder="Add a comment" value={commentBody} onChangeText={setCommentBody} accessibilityLabel="Add a comment" multiline />
        <Pressable
          style={[styles.smallButton, (!commentBody.trim() || actionPending) && styles.buttonDisabled]}
          onPress={handleAddComment}
          disabled={!commentBody.trim() || actionPending}
          accessibilityRole="button"
          accessibilityLabel="Post comment"
          accessibilityState={{ disabled: !commentBody.trim() || actionPending, busy: actionPending }}
        >
          {actionPending ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.buttonText}>Post Comment</ThemedText>}
        </Pressable>
      </ThemedView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: 4,
  },
  section: {
    gap: Spacing.two,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    backgroundColor: 'transparent',
  },
  chip: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  chipSelected: {
    backgroundColor: '#047857',
    borderColor: '#047857',
  },
  chipTextSelected: {
    color: '#fff',
  },
  input: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  multiline: {
    minHeight: 60,
    textAlignVertical: 'top',
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  button: {
    backgroundColor: '#047857',
    borderRadius: 10,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  smallButton: {
    backgroundColor: '#047857',
    borderRadius: 8,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
});
