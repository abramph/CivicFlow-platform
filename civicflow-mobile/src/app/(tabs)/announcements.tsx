import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet } from 'react-native';

import { LoadErrorBanner } from '@/components/load-error-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ActionColors, Elevation, Spacing } from '@/constants/theme';
import { useScreenTopPadding } from '@/hooks/use-screen-top-padding';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import {
  getAnnouncementsForIdentities,
  setAnnouncementArchivedForSources,
  type AnnouncementWithSources,
} from '@/lib/mobile-api';
import { deriveOrgCapabilities } from '@/lib/org-capabilities';

/**
 * The announcements list, with the Build 27 personal lifecycle: each row can
 * be archived out of the caller's own view (and restored from the Archived
 * view) — a personal inbox action that never deletes the announcement and
 * never affects any other recipient. Withdrawn announcements never appear
 * in either view (enforced server-side).
 */
export default function AnnouncementsScreen() {
  const { selectedOrganization, selectedOrganizationId } = useAuth();
  const { hasMemberIdentity, hasParentIdentity, adminCapabilities } = deriveOrgCapabilities(selectedOrganization);
  const hasRecipientIdentity = hasMemberIdentity || hasParentIdentity;
  // Management is a separate surface (Admin → Campaigns, campaign-query
  // backed) that never depends on recipient identity — an admin with no
  // member/family record still fully manages announcements. This tab only
  // links there; it never renders management state itself.
  const canManageAnnouncements = adminCapabilities.includes('manageCommunications');
  const [announcements, setAnnouncements] = useState<AnnouncementWithSources[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedOrganizationId || !hasRecipientIdentity) return;
    try {
      setAnnouncements(
        await getAnnouncementsForIdentities(selectedOrganizationId, { hasMemberIdentity, hasParentIdentity }, { archived: showArchived })
      );
      setLoadError(null);
    } catch {
      setLoadError('Unable to load announcements. Check your connection and try again.');
    }
  }, [selectedOrganizationId, hasRecipientIdentity, hasMemberIdentity, hasParentIdentity, showArchived]);

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

  async function handleArchiveToggle(item: AnnouncementWithSources) {
    if (!selectedOrganizationId || pendingId) return;
    setPendingId(item.id);
    try {
      await setAnnouncementArchivedForSources(selectedOrganizationId, item.id, item.sources, !showArchived);
      await load();
    } catch (error) {
      Alert.alert(
        showArchived ? 'Unable to restore' : 'Unable to archive',
        error instanceof ApiError ? error.message : 'Please try again.'
      );
    } finally {
      setPendingId(null);
    }
  }

  const topPadding = useScreenTopPadding();

  return (
    <ThemedView style={[styles.container, topPadding]}>
      <ThemedView style={styles.headerRow}>
        <ThemedText type="title">{showArchived ? 'Archived' : 'Announcements'}</ThemedText>
        <ThemedView style={styles.headerActions}>
          {canManageAnnouncements ? (
            <Pressable
              onPress={() => router.push('/admin-campaigns' as never)}
              style={styles.toggle}
              accessibilityRole="button"
              accessibilityLabel="Manage announcements"
              accessibilityHint="Opens announcement management, where administrators compose, send, and withdraw announcements."
            >
              <ThemedText type="link">Manage</ThemedText>
            </Pressable>
          ) : null}
          {hasRecipientIdentity ? (
            <Pressable
              onPress={() => setShowArchived((v) => !v)}
              style={styles.toggle}
              accessibilityRole="button"
              accessibilityLabel={showArchived ? 'Show announcements' : 'Show archived announcements'}
            >
              <ThemedText type="link">{showArchived ? 'Back to inbox' : 'Archived'}</ThemedText>
            </Pressable>
          ) : null}
        </ThemedView>
      </ThemedView>
      <LoadErrorBanner message={loadError} onRetry={load} />
      <FlatList
        data={announcements}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.navigate(`/announcement/${item.id}`)}
            accessibilityRole="button"
            accessibilityLabel={`${item.isRead ? '' : 'Unread, '}${item.subject || item.title}${item.sentAt ? `, ${new Date(item.sentAt).toLocaleDateString()}` : ''}`}
          >
            <ThemedView type="backgroundElement" style={[styles.row, !item.isRead && !showArchived ? styles.rowUnread : null]}>
              <ThemedView style={styles.rowHeader}>
                <ThemedText type={item.isRead ? 'small' : 'smallBold'}>{item.subject || item.title}</ThemedText>
                {!item.isRead ? <ThemedView style={styles.unreadDot} accessibilityElementsHidden importantForAccessibility="no" /> : null}
              </ThemedView>
              {item.sentAt ? (
                <ThemedText type="small" themeColor="textSecondary">{new Date(item.sentAt).toLocaleDateString()}</ThemedText>
              ) : null}
              <ThemedText type="default" numberOfLines={2} style={styles.body}>{item.body}</ThemedText>
              <Pressable
                onPress={() => handleArchiveToggle(item)}
                disabled={pendingId === item.id}
                style={styles.archiveAction}
                accessibilityRole="button"
                accessibilityLabel={`${showArchived ? 'Restore' : 'Archive'} ${item.subject || item.title}`}
                accessibilityHint={showArchived ? 'Moves this announcement back to your inbox.' : 'Hides this announcement from your view only. You can restore it from Archived.'}
                accessibilityState={{ disabled: pendingId === item.id }}
              >
                <ThemedText type="link">{pendingId === item.id ? 'Working…' : showArchived ? 'Restore' : 'Archive'}</ThemedText>
              </Pressable>
            </ThemedView>
          </Pressable>
        )}
        ListEmptyComponent={
          <ThemedView style={styles.emptyWrap}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              {!hasRecipientIdentity
                ? 'Announcements are sent to members and families. Your login has no member or family record in this organization, so there is nothing to show here.'
                : showArchived
                  ? 'Nothing archived.'
                  : 'No announcements yet.'}
            </ThemedText>
            {/* The truthful recipient message above stays exactly as-is; an
                administrator additionally gets the path to the management
                surface, which does not depend on recipient identity. */}
            {!hasRecipientIdentity && canManageAnnouncements ? (
              <Pressable
                onPress={() => router.push('/admin-campaigns' as never)}
                style={styles.emptyManage}
                accessibilityRole="button"
                accessibilityLabel="Manage announcements"
                accessibilityHint="Opens announcement management, where administrators compose, send, and withdraw announcements."
              >
                <ThemedText type="link">Manage Announcements</ThemedText>
              </Pressable>
            ) : null}
          </ThemedView>
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    backgroundColor: 'transparent',
  },
  toggle: {
    minHeight: 44,
    justifyContent: 'center',
  },
  emptyWrap: {
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  emptyManage: {
    minHeight: 44,
    justifyContent: 'center',
    marginTop: Spacing.three,
  },
  list: {
    gap: Spacing.two,
  },
  row: {
    borderRadius: 10,
    padding: Spacing.three,
    gap: 4,
    ...(Elevation.card as object),
  },
  // Unread rows get the parent-accent left rail in addition to the bold
  // subject and dot — color is never the only unread signal.
  rowUnread: {
    borderLeftWidth: 3,
    borderLeftColor: ActionColors.primary,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: ActionColors.primary,
  },
  body: {
    marginTop: 4,
  },
  archiveAction: {
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  empty: {
    textAlign: 'center',
    marginTop: Spacing.five,
  },
});
