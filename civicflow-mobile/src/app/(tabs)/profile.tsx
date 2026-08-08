import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { getProfile, updateProfile, type MobileProfile } from '@/lib/mobile-api';

export default function ProfileScreen() {
  const { user, selectedOrganization, selectedOrganizationId, logout } = useAuth();
  const hasMemberIdentity = Boolean(selectedOrganization?.memberId);
  const [profile, setProfile] = useState<MobileProfile | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  // Comms preferences (commsPushEnabled/commsEmailEnabled/commsSmsEnabled) live
  // on the conventional OrgMember record. A PTA household's OrgMember is a
  // shared billing identity (see mobile-auth.ts), never a per-adult one, so
  // there's no existing per-adult comms-preference model to bridge onto —
  // this section is hidden rather than editing a shared household record or
  // fabricating new schema. Name/email/organization above still render
  // correctly for a PTA parent from the org-discovery response alone.
  const load = useCallback(async () => {
    if (!selectedOrganizationId || !hasMemberIdentity) return;
    setProfile(await getProfile(selectedOrganizationId));
  }, [selectedOrganizationId, hasMemberIdentity]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  async function handleToggle(field: 'commsPushEnabled' | 'commsEmailEnabled' | 'commsSmsEnabled', value: boolean) {
    if (!selectedOrganizationId || !profile) return;
    setSaving(field);
    const previous = profile[field];
    setProfile({ ...profile, [field]: value });
    try {
      const updated = await updateProfile(selectedOrganizationId, { [field]: value });
      setProfile((current) => (current ? { ...current, ...updated } : current));
    } catch {
      setProfile((current) => (current ? { ...current, [field]: previous } : current));
    } finally {
      setSaving(null);
    }
  }

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ThemedText type="title">Profile</ThemedText>

      <ThemedView type="backgroundElement" style={styles.card}>
        <ThemedText type="small" themeColor="textSecondary">Name</ThemedText>
        <ThemedText type="smallBold">
          {selectedOrganization ? `${selectedOrganization.firstName} ${selectedOrganization.lastName}` : user?.displayName ?? '—'}
        </ThemedText>

        <ThemedText type="small" themeColor="textSecondary" style={styles.spacedTop}>Email</ThemedText>
        <ThemedText type="smallBold">{user?.email ?? '—'}</ThemedText>

        <ThemedText type="small" themeColor="textSecondary" style={styles.spacedTop}>Organization</ThemedText>
        <ThemedText type="smallBold">{selectedOrganization?.organizationName ?? '—'}</ThemedText>
      </ThemedView>

      {/* Always visible, even with exactly one organization -- see GitHub #71:
          gating this on organizations.length > 1 left no discoverable way to
          reach /org-switcher for the common single-org case (only reachable
          before via an automatic Redirect, e.g. when selectedOrganizationId
          is null). A single-org account still benefits from confirming which
          org it's in and from a working path if a second org gets added
          later without a re-login. */}
      <Pressable style={styles.secondaryButton} onPress={() => router.push('/org-switcher')} accessibilityRole="button" accessibilityLabel="Switch organization">
        <ThemedText type="link">Switch Organization</ThemedText>
      </Pressable>

      {hasMemberIdentity ? (
        <Pressable style={styles.secondaryButton} onPress={() => router.push('/attendance-history')} accessibilityRole="button" accessibilityLabel="Attendance history">
          <ThemedText type="link">Attendance History</ThemedText>
        </Pressable>
      ) : null}

      {hasMemberIdentity ? (
        <>
          <ThemedText type="smallBold" style={styles.sectionLabel}>Notifications</ThemedText>
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedView style={styles.toggleRow}>
              <ThemedText type="default">Push Notifications</ThemedText>
              <Switch
                value={profile?.commsPushEnabled ?? false}
                disabled={!profile || saving === 'commsPushEnabled'}
                onValueChange={(value) => handleToggle('commsPushEnabled', value)}
                accessibilityLabel="Push notifications"
              />
            </ThemedView>
            <ThemedView style={styles.toggleRow}>
              <ThemedText type="default">Email Updates</ThemedText>
              <Switch
                value={profile?.commsEmailEnabled ?? false}
                disabled={!profile || saving === 'commsEmailEnabled'}
                onValueChange={(value) => handleToggle('commsEmailEnabled', value)}
                accessibilityLabel="Email updates"
              />
            </ThemedView>
            <ThemedView style={styles.toggleRow}>
              <ThemedText type="default">Text Messages</ThemedText>
              <Switch
                value={profile?.commsSmsEnabled ?? false}
                disabled={!profile || saving === 'commsSmsEnabled' || Boolean(profile?.smsOptedOutAt)}
                onValueChange={(value) => handleToggle('commsSmsEnabled', value)}
                accessibilityLabel="Text messages"
                accessibilityHint={profile?.smsOptedOutAt ? "Blocked because you've texted STOP" : undefined}
              />
            </ThemedView>
            {profile?.smsOptedOutAt ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.optOutNote}>
                You&apos;ve texted STOP, so text messages are blocked until you text START to re-enable them.
              </ThemedText>
            ) : null}
          </ThemedView>
        </>
      ) : null}

      <Pressable style={styles.logoutButton} onPress={handleLogout} accessibilityRole="button" accessibilityLabel="Log out">
        <ThemedText style={styles.logoutText}>Log Out</ThemedText>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  card: {
    borderRadius: 12,
    padding: Spacing.three,
  },
  spacedTop: {
    marginTop: Spacing.two,
  },
  secondaryButton: {
    alignSelf: 'flex-start',
  },
  sectionLabel: {
    marginTop: Spacing.two,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
    paddingVertical: Spacing.one,
  },
  optOutNote: {
    marginTop: Spacing.two,
  },
  logoutButton: {
    marginTop: Spacing.three,
    backgroundColor: '#B42318',
    borderRadius: 10,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  logoutText: {
    color: '#fff',
    fontWeight: '600',
  },
});
