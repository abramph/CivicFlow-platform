import { Redirect, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet } from 'react-native';

import { LoadErrorBanner } from '@/components/load-error-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useScreenTopPadding } from '@/hooks/use-screen-top-padding';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { getPtaProgression, type PtaProgressionStatus, type PtaProgressionSummary } from '@/lib/mobile-api';

/**
 * "Student Progression" -- a strictly READ-ONLY, family-facing view of each
 * child's current placement and any confirmed next-year placement.
 *
 * There are deliberately no controls here beyond retry: no commit,
 * approve, correct, exclude, retain, withdraw, transfer or rollback
 * action, and no editable field. Every administrative progression
 * operation remains portal-only, behind the portal's own permission
 * checks. This screen calls exactly one read endpoint
 * (/api/mobile/pta/progression), which itself never reads the progression
 * batch/record tables -- so preview calculations, draft mappings,
 * NEEDS_REVIEW state, administrator notes, conflict details, audit actors
 * and batch idempotency keys are unreachable from this surface by
 * construction, not by filtering.
 *
 * Requires no new device permission of any kind (no camera, photo library,
 * location, notification, or tracking).
 */

const UNAVAILABLE_TEXT = 'Next-year placement is not yet available.';
const CONTINUITY_TEXT = 'Your family account and history stay connected each school year.';

/** Family-facing badge wording. Never renders a raw internal status. */
function statusLabel(status: PtaProgressionStatus): string {
  switch (status) {
    case 'CONFIRMED':
      return 'Confirmed';
    case 'COMPLETED':
      return 'Completed';
    case 'CURRENT':
      return 'Current';
    default:
      return 'Not yet available';
  }
}

export default function PtaProgressionScreen() {
  const { status, selectedOrganization, selectedOrganizationId } = useAuth();
  const hasPtaIdentity = Boolean(selectedOrganization?.pta?.householdAdultId);

  const [summary, setSummary] = useState<PtaProgressionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const topPadding = useScreenTopPadding();

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !hasPtaIdentity) return;
    try {
      setSummary(await getPtaProgression(selectedOrganizationId));
      setLoadError(null);
      setUnavailable(false);
    } catch (error) {
      setSummary(null);
      // 403 covers both progression feature flags being off and the caller
      // no longer being an eligible family. Those are deliberately shown
      // with one neutral message and no retry: the server is the authority,
      // and spelling out which gate refused would leak administrative
      // state. Everything else (network, 5xx) stays retryable.
      if (error instanceof ApiError && error.status === 403) {
        setUnavailable(true);
        setLoadError(null);
      } else {
        setUnavailable(false);
        setLoadError('Unable to load student progression. Check your connection and try again.');
      }
    }
  }, [selectedOrganizationId, hasPtaIdentity]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        setLoading(true);
        try {
          await load();
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [load])
  );

  if (status === 'signedOut') {
    return <Redirect href={{ pathname: '/login', params: { redirectTo: '/pta-progression' } }} />;
  }
  // Client-side convenience only -- never the security boundary. The server
  // independently re-authorizes every request via
  // requireMobilePtaHouseholdAccess (bearer auth + PTA vertical + the
  // caller's own household linkage) and the two progression feature flags,
  // so direct navigation by an ineligible account still returns nothing.
  if (status === 'signedIn' && !hasPtaIdentity) {
    return <Redirect href="/dashboard" />;
  }

  const students = summary?.students ?? [];

  return (
    <ScrollView contentContainerStyle={[styles.container, topPadding]}>
      <ThemedText type="title">Student Progression</ThemedText>
      {summary?.nextSchoolYear ? (
        <ThemedText type="small" themeColor="textSecondary">
          Looking ahead to {summary.nextSchoolYear}
        </ThemedText>
      ) : summary?.currentSchoolYear ? (
        <ThemedText type="small" themeColor="textSecondary">
          {summary.currentSchoolYear} school year
        </ThemedText>
      ) : null}

      <LoadErrorBanner message={loadError} onRetry={load} />

      {loading ? (
        <ThemedView style={styles.centered} accessible accessibilityLabel="Loading student progression">
          <ActivityIndicator />
        </ThemedView>
      ) : unavailable ? (
        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="small">Student progression is not available for this organization.</ThemedText>
        </ThemedView>
      ) : loadError ? null : students.length === 0 ? (
        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="small">No students are on file for your family yet.</ThemedText>
        </ThemedView>
      ) : (
        students.map((student) => {
          const hasNext = Boolean(student.nextGrade);
          // Screen readers get one coherent sentence per child instead of
          // several disconnected fragments read in visual order.
          const spoken = [
            student.displayName,
            student.currentGrade ? `currently ${student.currentGrade}` : 'no current placement on file',
            student.currentClassroom ? `in ${student.currentClassroom}` : null,
            hasNext
              ? `next year ${student.nextGrade}${student.nextClassroom ? ` in ${student.nextClassroom}` : ''}`
              : UNAVAILABLE_TEXT,
            statusLabel(student.status),
          ]
            .filter(Boolean)
            .join(', ');

          return (
            <ThemedView
              key={student.studentId}
              type="backgroundElement"
              style={styles.card}
              accessible
              accessibilityLabel={spoken}
            >
              <ThemedText type="smallBold">{student.displayName}</ThemedText>

              {student.currentGrade ? (
                <ThemedText type="default">
                  {hasNext ? `${student.currentGrade} → ${student.nextGrade}` : student.currentGrade}
                </ThemedText>
              ) : (
                <ThemedText type="small" themeColor="textSecondary">
                  No current placement on file.
                </ThemedText>
              )}

              {student.currentClassroom ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Current class: {student.currentClassroom}
                </ThemedText>
              ) : null}

              {hasNext && student.nextClassroom ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Next class: {student.nextClassroom}
                </ThemedText>
              ) : null}

              {!hasNext ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {UNAVAILABLE_TEXT}
                </ThemedText>
              ) : null}

              <ThemedText type="smallBold" style={styles.badge}>
                {statusLabel(student.status)}
              </ThemedText>
            </ThemedView>
          );
        })
      )}

      {!loading && !loadError ? (
        <ThemedText type="small" themeColor="textSecondary">
          {CONTINUITY_TEXT}
        </ThemedText>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  card: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  badge: {
    marginTop: Spacing.one,
  },
});
