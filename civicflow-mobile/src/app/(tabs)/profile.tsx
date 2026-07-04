import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';

export default function ProfileScreen() {
  const { user, organizations, selectedOrganization, logout } = useAuth();

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  return (
    <ThemedView style={styles.container}>
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

      <Pressable style={styles.logoutButton} onPress={handleLogout}>
        <ThemedText style={styles.logoutText}>Log Out</ThemedText>
      </Pressable>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
  logoutButton: {
    marginTop: 'auto',
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
