import { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { getPtaDocuments, type PtaDocument } from '@/lib/mobile-api';

export default function PtaDocumentsScreen() {
  const { selectedOrganizationId } = useAuth();
  const [documents, setDocuments] = useState<PtaDocument[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!selectedOrganizationId) return;
    setDocuments(await getPtaDocuments(selectedOrganizationId));
  }, [selectedOrganizationId]);

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

  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title">Documents</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">Bylaws, budgets, and other PTA documents.</ThemedText>
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
