import { Redirect } from 'expo-router';
import { ActivityIndicator } from 'react-native';

import { ThemedView } from '@/components/themed-view';
import { useAuth } from '@/lib/auth-context';

export default function Index() {
  const { status, selectedOrganizationId } = useAuth();

  if (status === 'loading') {
    return (
      <ThemedView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }} accessibilityRole="progressbar" accessibilityLabel="Loading">
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (status === 'signedOut') {
    return <Redirect href="/login" />;
  }

  if (!selectedOrganizationId) {
    return <Redirect href="/org-switcher" />;
  }

  return <Redirect href="/dashboard" />;
}
