import { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { getPtaMinutes, type PtaApprovedMinutes } from '@/lib/mobile-api';

export default function MinutesScreen() {
  const { selectedOrganizationId } = useAuth();
  const [minutes, setMinutes] = useState<PtaApprovedMinutes[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!selectedOrganizationId) return;
    setMinutes(await getPtaMinutes(selectedOrganizationId));
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
      <ThemedText type="title">Meeting Minutes</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">Approved minutes only.</ThemedText>
      <FlatList
        data={minutes}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <ThemedView
            type="backgroundElement"
            style={styles.row}
            accessible
            accessibilityLabel={`${item.title}, ${item.fileName}, ${new Date(item.uploadedAt).toLocaleDateString()}`}
          >
            <ThemedText type="smallBold">{item.title}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {item.fileName} · {new Date(item.uploadedAt).toLocaleDateString()}
            </ThemedText>
          </ThemedView>
        )}
        ListEmptyComponent={
          !loading ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              No approved minutes have been posted yet.
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
