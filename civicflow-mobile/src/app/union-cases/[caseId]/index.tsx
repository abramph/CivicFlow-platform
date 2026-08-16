import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { getUnionCase, type UnionCaseStatus, type UnionCaseSummary } from '@/lib/mobile-api';

const STATUS_LABELS: Record<UnionCaseStatus, string> = {
  NEW: 'New',
  TRIAGE: 'Under review',
  ASSIGNED: 'Assigned',
  ACTIVE: 'In progress',
  PENDING: 'Waiting',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
  WITHDRAWN: 'Withdrawn',
};

/** Read-only case detail -- no comment posting or withdrawal yet, same
 * reduced-mobile-scope reasoning as the list screen it's pushed from. */
export default function UnionCaseDetailScreen() {
  const { selectedOrganizationId } = useAuth();
  const { caseId } = useLocalSearchParams<{ caseId: string }>();

  const [unionCase, setUnionCase] = useState<UnionCaseSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !caseId) return;
    try {
      setUnionCase(await getUnionCase(selectedOrganizationId, caseId));
      setLoadError(null);
    } catch (error) {
      setUnionCase(null);
      setLoadError(
        error instanceof ApiError && error.status === 404
          ? 'This case could not be found.'
          : 'Unable to load this case. Check your connection and try again.'
      );
    }
  }, [selectedOrganizationId, caseId]);

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

  if (loading) {
    return (
      <ThemedView style={styles.loadingContainer} accessibilityRole="progressbar" accessibilityLabel="Loading case">
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (!unionCase) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText type="small" themeColor="textSecondary" accessibilityRole="alert" accessibilityLiveRegion="assertive">
          {loadError ?? 'This case is not available.'}
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <ThemedText type="title" style={styles.title}>
          UC-{unionCase.caseNumber} · {unionCase.title}
        </ThemedText>
        <View style={styles.statusPill}>
          <ThemedText type="small">{STATUS_LABELS[unionCase.status]}</ThemedText>
        </View>
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {unionCase.caseType} · Submitted {new Date(unionCase.createdAt).toLocaleDateString()}
      </ThemedText>

      <ThemedText type="default">{unionCase.description}</ThemedText>

      {unionCase.representationRequested ? (
        <ThemedText type="small" themeColor="textSecondary">Representation requested.</ThemedText>
      ) : null}

      {unionCase.resolutionSummary ? (
        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="smallBold">Resolution</ThemedText>
          <ThemedText type="default">{unionCase.resolutionSummary}</ThemedText>
        </ThemedView>
      ) : null}

      {unionCase.upcomingDates.length > 0 ? (
        <>
          <ThemedText type="smallBold" style={styles.sectionLabel}>Upcoming dates</ThemedText>
          {unionCase.upcomingDates.map((d) => (
            <ThemedView key={d.id} type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">{d.deadlineType}</ThemedText>
              {d.description ? <ThemedText type="small" themeColor="textSecondary">{d.description}</ThemedText> : null}
              <ThemedText type="small" themeColor="textSecondary">{new Date(d.dueAt).toLocaleDateString()}</ThemedText>
            </ThemedView>
          ))}
        </>
      ) : null}

      <ThemedText type="smallBold" style={styles.sectionLabel}>Updates</ThemedText>
      {unionCase.comments.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">No updates yet.</ThemedText>
      ) : (
        unionCase.comments.map((c) => (
          <ThemedView key={c.id} type="backgroundElement" style={styles.card}>
            <ThemedText type="default">{c.body}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{new Date(c.createdAt).toLocaleString()}</ThemedText>
          </ThemedView>
        ))
      )}
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
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  title: {
    flex: 1,
  },
  statusPill: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  sectionLabel: {
    marginTop: Spacing.two,
  },
  card: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: 4,
  },
});
