import { Redirect, router } from 'expo-router';
import { FlatList, Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ActionColors, Brand, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';

export default function OrgSwitcherScreen() {
  const { status, organizations, selectedOrganizationId, selectOrganization, logout } = useAuth();

  async function handleSelect(organizationId: string) {
    await selectOrganization(organizationId);
    router.replace('/dashboard');
  }

  if (status === 'signedOut') {
    return <Redirect href="/login" />;
  }

  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title" style={styles.title}>
        Choose an Organization
      </ThemedText>
      <ThemedText type="subtitle" themeColor="textSecondary" style={styles.subtitle}>
        {organizations.length > 1
          ? 'You belong to more than one organization on Unestra.'
          : 'This is the organization your account belongs to on Unestra.'}
      </ThemedText>

      <FlatList
        data={organizations}
        keyExtractor={(item) => item.organizationId}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable
            style={[styles.row, item.organizationId === selectedOrganizationId && styles.rowSelected]}
            onPress={() => handleSelect(item.organizationId)}
            accessibilityRole="button"
            accessibilityLabel={`${item.organizationName}${item.isDelinquent ? ', dues past due' : ''}`}
            accessibilityState={{ selected: item.organizationId === selectedOrganizationId }}
          >
            <ThemedView style={styles.nameRow}>
              <ThemedText type="smallBold">{item.organizationName}</ThemedText>
              {item.capability ? (
                <ThemedText type="small" themeColor="textSecondary" style={styles.verticalTag}>
                  {item.capability.terminology.productLabel}
                </ThemedText>
              ) : null}
            </ThemedView>
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

      <Pressable style={styles.logout} onPress={() => logout()} accessibilityRole="button" accessibilityLabel="Log out">
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
    borderColor: ActionColors.border,
    borderRadius: 12,
    padding: Spacing.three,
    gap: 4,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  verticalTag: {
    textTransform: 'uppercase',
  },
  rowSelected: {
    borderColor: ActionColors.primary,
    backgroundColor: Brand.primaryTintLight,
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
