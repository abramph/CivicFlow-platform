import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { getProfile, updateProfile, type MobileProfile } from '@/lib/mobile-api';

export default function ProfileScreen() {
  const { user, organizations, selectedOrganization, selectedOrganizationId, logout } = useAuth();
  const [profile, setProfile] = useState<MobileProfile | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedOrganizationId) return;
    setProfile(await getProfile(selectedOrganizationId));
  }, [selectedOrganizationId]);

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

      {organizations.length > 1 ? (
        <Pressable style={styles.secondaryButton} onPress={() => router.push('/org-switcher')}>
          <ThemedText type="link">Switch Organization</ThemedText>
        </Pressable>
      ) : null}

      <ThemedText type="smallBold" style={styles.sectionLabel}>Notifications</ThemedText>
      <ThemedView type="backgroundElement" style={styles.card}>
        <ThemedView style={styles.toggleRow}>
          <ThemedText type="default">Push Notifications</ThemedText>
          <Switch
            value={profile?.commsPushEnabled ?? false}
            disabled={!profile || saving === 'commsPushEnabled'}
            onValueChange={(value) => handleToggle('commsPushEnabled', value)}
          />
        </ThemedView>
        <ThemedView style={styles.toggleRow}>
          <ThemedText type="default">Email Updates</ThemedText>
          <Switch
            value={profile?.commsEmailEnabled ?? false}
            disabled={!profile || saving === 'commsEmailEnabled'}
            onValueChange={(value) => handleToggle('commsEmailEnabled', value)}
          />
        </ThemedView>
        <ThemedView style={styles.toggleRow}>
          <ThemedText type="default">Text Messages</ThemedText>
          <Switch
            value={profile?.commsSmsEnabled ?? false}
            disabled={!profile || saving === 'commsSmsEnabled' || Boolean(profile?.smsOptedOutAt)}
            onValueChange={(value) => handleToggle('commsSmsEnabled', value)}
          />
        </ThemedView>
        {profile?.smsOptedOutAt ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.optOutNote}>
            You&apos;ve texted STOP, so text messages are blocked until you text START to re-enable them.
          </ThemedText>
        ) : null}
      </ThemedView>

      <Pressable style={styles.logoutButton} onPress={handleLogout}>
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
