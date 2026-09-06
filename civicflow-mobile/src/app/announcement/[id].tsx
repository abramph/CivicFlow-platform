import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { getAnnouncementsForIdentities, markAnnouncementReadForSources, type AnnouncementWithSources } from '@/lib/mobile-api';
import { deriveOrgCapabilities } from '@/lib/org-capabilities';

export default function AnnouncementDetailScreen() {
  const { selectedOrganization, selectedOrganizationId } = useAuth();
  const { hasMemberIdentity, hasParentIdentity } = deriveOrgCapabilities(selectedOrganization);
  const { id } = useLocalSearchParams<{ id: string }>();
  const [announcement, setAnnouncement] = useState<AnnouncementWithSources | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !id) return;
    const all = await getAnnouncementsForIdentities(selectedOrganizationId, { hasMemberIdentity, hasParentIdentity });
    const match = all.find((item) => item.id === id) ?? null;
    setAnnouncement(match);
    if (match && !match.isRead) {
      await markAnnouncementReadForSources(selectedOrganizationId, id, match.sources);
    }
  }, [selectedOrganizationId, id, hasMemberIdentity, hasParentIdentity]);

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
      <ThemedView style={styles.loadingContainer} accessibilityRole="progressbar" accessibilityLabel="Loading announcement">
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (!announcement) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText type="title">Announcement</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" accessibilityRole="alert" accessibilityLiveRegion="assertive">
          This announcement isn&apos;t available.
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ThemedText type="title">{announcement.subject || announcement.title}</ThemedText>
      {announcement.sentAt ? (
        <ThemedText type="small" themeColor="textSecondary">
          {new Date(announcement.sentAt).toLocaleString()}
        </ThemedText>
      ) : null}
      <ThemedText type="default" style={styles.body}>{announcement.body}</ThemedText>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.four,
    gap: Spacing.two,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    marginTop: Spacing.two,
  },
});
