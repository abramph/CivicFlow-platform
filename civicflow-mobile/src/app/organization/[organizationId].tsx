import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator } from 'react-native';

import { ThemedView } from '@/components/themed-view';
import { useAuth } from '@/lib/auth-context';

/**
 * Deep link target for unestra://organization/:organizationId — switches
 * the active organization (if the caller actually belongs to it) and lands
 * on the dashboard.
 */
export default function OrganizationDeepLinkScreen() {
  const { status, organizations, selectOrganization } = useAuth();
  const { organizationId } = useLocalSearchParams<{ organizationId: string }>();
  const [handled, setHandled] = useState(false);

  useEffect(() => {
    if (status !== 'signedIn' || handled) return;
    (async () => {
      if (organizationId && organizations.some((org) => org.organizationId === organizationId)) {
        await selectOrganization(organizationId);
      }
      setHandled(true);
      router.replace('/dashboard');
    })();
  }, [status, organizationId, organizations, selectOrganization, handled]);

  if (status === 'signedOut') {
    return (
      <Redirect
        href={{ pathname: '/login', params: { redirectTo: `/organization/${organizationId ?? ''}` } }}
      />
    );
  }

  return (
    <ThemedView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator />
    </ThemedView>
  );
}
