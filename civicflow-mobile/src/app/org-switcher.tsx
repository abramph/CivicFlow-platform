import { router } from 'expo-router';
import { FlatList, Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';

export default function OrgSwitcherScreen() {
  const { organizations, selectedOrganizationId, selectOrganization, logout } = useAuth();

  async function handleSelect(organizationId: string) {
    await selectOrganization(organizationId);
    router.replace('/dashboard');
  }

  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title" style={styles.title}>
        Choose an Organization
      </ThemedText>
      <ThemedText type="subtitle" themeColor="textSecondary" style={styles.subtitle}>
        You belong to more than one organization on Unestra.
      </ThemedText>

      <FlatList
        data={organizations}
        keyExtractor={(item) => item.organizationId}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable
            style={[styles.row, item.organizationId === selectedOrganizationId && styles.rowSelected]}
            onPress={() => handleSelect(item.organizationId)}
          >
            <ThemedText type="smallBold">{item.organizationName}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {item.firstName} {item.lastName}
              {item.isDelinquent ? ' · Dues past due' : ''}
            </ThemedText>
          </Pressable>
        )}
        ListEmptyComponent={
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            No active memberships found for your account.
          </ThemedText>
        }
      />

      <Pressable style={styles.logout} onPress={() => logout()}>
        <ThemedText type="link" themeColor="textSecondary">
          Log out
        </ThemedText>
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
  title: {
    marginTop: Spacing.five,
  },
  subtitle: {
    marginBottom: Spacing.three,
  },
  list: {
    gap: Spacing.two,
  },
  row: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 12,
    padding: Spacing.three,
    gap: 4,
  },
  rowSelected: {
    borderColor: '#047857',
    backgroundColor: '#ECFDF5',
  },
  empty: {
    textAlign: 'center',
    marginTop: Spacing.five,
  },
  logout: {
    alignSelf: 'center',
    marginTop: Spacing.three,
  },
});
