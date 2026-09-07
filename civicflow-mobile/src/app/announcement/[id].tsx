import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import {
  getAnnouncementsForIdentities,
  markAnnouncementReadForSources,
  setAnnouncementArchivedForSources,
  type AnnouncementWithSources,
} from '@/lib/mobile-api';
import { deriveOrgCapabilities } from '@/lib/org-capabilities';

export default function AnnouncementDetailScreen() {
  const { selectedOrganization, selectedOrganizationId } = useAuth();
  const { hasMemberIdentity, hasParentIdentity } = deriveOrgCapabilities(selectedOrganization);
  const { id } = useLocalSearchParams<{ id: string }>();
  const [announcement, setAnnouncement] = useState<AnnouncementWithSources | null>(null);
  const [isArchived, setIsArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [archiving, setArchiving] = useState(false);

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !id) return;
    const identity = { hasMemberIdentity, hasParentIdentity };
    // The item may live in either view — an archived announcement is still
    // openable (e.g. from the Archived list or an old notification tap).
    const inbox = await getAnnouncementsForIdentities(selectedOrganizationId, identity);
    let match = inbox.find((item) => item.id === id) ?? null;
    let archived = false;
    if (!match) {
      const archivedList = await getAnnouncementsForIdentities(selectedOrganizationId, identity, { archived: true });
      match = archivedList.find((item) => item.id === id) ?? null;
      archived = Boolean(match);
    }
    setAnnouncement(match);
    setIsArchived(archived);
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

  async function handleArchiveToggle() {
    if (!selectedOrganizationId || !announcement || archiving) return;
    setArchiving(true);
    try {
      await setAnnouncementArchivedForSources(selectedOrganizationId, announcement.id, announcement.sources, !isArchived);
      router.back();
    } catch (error) {
      Alert.alert(
        isArchived ? 'Unable to restore' : 'Unable to archive',
        error instanceof ApiError ? error.message : 'Please try again.'
      );
    } finally {
      setArchiving(false);
    }
  }

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

      <Pressable
        onPress={handleArchiveToggle}
        disabled={archiving}
        style={styles.archiveAction}
        accessibilityRole="button"
        accessibilityLabel={isArchived ? 'Restore announcement' : 'Archive announcement'}
        accessibilityHint={
          isArchived
            ? 'Moves this announcement back to your inbox.'
            : 'Hides this announcement from your view only. You can restore it from Archived.'
        }
        accessibilityState={{ disabled: archiving }}
      >
        <ThemedText type="link">{archiving ? 'Working…' : isArchived ? 'Restore' : 'Archive'}</ThemedText>
      </Pressable>
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
  archiveAction: {
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'flex-start',
    marginTop: Spacing.three,
  },
});
