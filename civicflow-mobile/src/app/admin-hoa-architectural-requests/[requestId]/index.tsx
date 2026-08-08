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
  addAdminHoaArchitecturalRequestComment,
  getAdminHoaArchitecturalRequest,
  type AdminHoaArchitecturalRequestDetail,
  type HoaArchitecturalRequestStatus,
} from '@/lib/mobile-api';

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

function propertyLabel(property: AdminHoaArchitecturalRequestDetail['property']) {
  if (property.displayName) return property.displayName;
  return property.unitLabel ? `${property.addressLine1} · ${property.unitLabel}` : property.addressLine1;
}

/**
 * Mobile Admin program (PR E) — HOA architectural request detail. READ +
 * COMMENT ONLY, by design (see docs/hoa-mobile-strategy.md) — there is no
 * approve/deny/conditionally-approve control anywhere on this screen, and
 * no client function exists to call one (see mobile-api.ts). If a comment
 * post 403s, it means the caller holds READ but not REVIEW — a normal,
 * expected state (see the two-gate doc comment on that section of
 * mobile-api.ts), not a bug.
 */
export default function AdminHoaArchitecturalRequestDetailScreen() {
  const { selectedOrganization, selectedOrganizationId } = useAuth();
  const hasManageHoaArchitecturalRequests = Boolean(selectedOrganization?.capability?.adminCapabilities?.includes('manageHoaArchitecturalRequests'));
  const { requestId } = useLocalSearchParams<{ requestId: string }>();

  const [request, setRequest] = useState<AdminHoaArchitecturalRequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const [posting, setPosting] = useState(false);

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !requestId || !hasManageHoaArchitecturalRequests) return;
    try {
      setRequest(await getAdminHoaArchitecturalRequest(selectedOrganizationId, requestId));
      setLoadError(null);
    } catch (error) {
      setRequest(null);
      setLoadError(error instanceof ApiError && error.status === 404 ? 'This request could not be found.' : 'Unable to load this request. Check your connection and try again.');
    }
  }, [selectedOrganizationId, requestId, hasManageHoaArchitecturalRequests]);

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

  async function handleAddComment() {
    if (!selectedOrganizationId || !requestId || !commentBody.trim() || posting) return;
    setPosting(true);
    try {
      await addAdminHoaArchitecturalRequestComment(requestId, selectedOrganizationId, commentBody.trim(), true);
      setCommentBody('');
      await load();
    } catch (error) {
      Alert.alert('Unable to add comment', error instanceof ApiError ? error.message : 'Please try again.');
    } finally {
      setPosting(false);
    }
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

  if (loading) {
    return (
      <ThemedView style={styles.loadingContainer} accessibilityRole="progressbar" accessibilityLabel="Loading request">
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (!request) {
    return (
      <ThemedView style={styles.container}>
        <LoadErrorBanner message={loadError ?? 'This request could not be found.'} onRetry={load} />
      </ThemedView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ThemedText type="title">AR-{request.requestNumber} · {request.title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {propertyLabel(request.property)} · {request.category} · {STATUS_LABELS[request.status]}
      </ThemedText>

      <ThemedView type="backgroundElement" style={styles.card}>
        <ThemedText type="small">{request.projectDescription}</ThemedText>
        {request.proposedStartDate ? (
          <ThemedText type="small" themeColor="textSecondary">
            Proposed: {new Date(request.proposedStartDate).toLocaleDateString()}
            {request.proposedCompletionDate ? ` – ${new Date(request.proposedCompletionDate).toLocaleDateString()}` : ''}
          </ThemedText>
        ) : null}
        {request.decisionSummary ? <ThemedText type="small" themeColor="textSecondary">Decision: {request.decisionSummary}</ThemedText> : null}
        {request.conditions ? <ThemedText type="small" themeColor="textSecondary">Conditions: {request.conditions}</ThemedText> : null}
      </ThemedView>

      <ThemedView style={styles.section}>
        <ThemedText type="subtitle">Comments</ThemedText>
        {request.comments.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">No comments yet.</ThemedText>
        ) : (
          request.comments.map((comment) => (
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
          style={[styles.button, (!commentBody.trim() || posting) && styles.buttonDisabled]}
          onPress={handleAddComment}
          disabled={!commentBody.trim() || posting}
          accessibilityRole="button"
          accessibilityLabel="Post comment"
          accessibilityState={{ disabled: !commentBody.trim() || posting, busy: posting }}
        >
          {posting ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.buttonText}>Post Comment</ThemedText>}
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
  button: {
    backgroundColor: '#047857',
    borderRadius: 10,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
});
