import { Redirect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet } from 'react-native';

import { LoadErrorBanner } from '@/components/load-error-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { getPtaDocuments, type PtaDocument } from '@/lib/mobile-api';

export default function PtaDocumentsScreen() {
  const { status, selectedOrganization, selectedOrganizationId } = useAuth();
  // The server route requires a household link (requireMobilePtaHouseholdAccess),
  // and the dashboard entry point gates on the same — this mirrors
  // pta-my-family's direct-navigation defense for deep links.
  const hasParentIdentity = Boolean(selectedOrganization?.pta?.householdAdultId);
  const [documents, setDocuments] = useState<PtaDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !hasParentIdentity) return;
    try {
      setDocuments(await getPtaDocuments(selectedOrganizationId));
      setLoadError(null);
    } catch {
      setLoadError('Unable to load documents. Check your connection and try again.');
    }
  }, [selectedOrganizationId, hasParentIdentity]);

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

  if (status === 'signedIn' && selectedOrganization && !hasParentIdentity) {
    return <Redirect href="/dashboard" />;
  }

  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title">Documents</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">Bylaws, budgets, and other PTA documents.</ThemedText>
      <LoadErrorBanner message={loadError} onRetry={load} />
      <FlatList
        data={documents}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <ThemedView
            type="backgroundElement"
            style={styles.row}
            accessible
            accessibilityLabel={`${item.title}, ${item.fileName}, ${new Date(item.uploadedAt).toLocaleDateString()}, not downloadable in this demo`}
          >
            <ThemedText type="smallBold">{item.title}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {item.fileName} · {new Date(item.uploadedAt).toLocaleDateString()}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">Not downloadable in this demo</ThemedText>
          </ThemedView>
        )}
        ListEmptyComponent={
          !loading ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              No documents have been posted yet.
            </ThemedText>
          ) : null
        }
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  list: {
    gap: Spacing.two,
  },
  row: {
    borderRadius: 10,
    padding: Spacing.three,
    gap: 2,
  },
  empty: {
    textAlign: 'center',
    marginTop: Spacing.five,
  },
});
