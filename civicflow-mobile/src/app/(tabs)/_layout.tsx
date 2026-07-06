import { Redirect, Tabs } from 'expo-router';
import { ActivityIndicator } from 'react-native';

import { ThemedView } from '@/components/themed-view';
import { useAuth } from '@/lib/auth-context';
import { useUnreadConversationCount } from '@/lib/unread-count';

export default function TabsLayout() {
  const { status, selectedOrganizationId } = useAuth();
  const unreadCount = useUnreadConversationCount(selectedOrganizationId);

  if (status === 'loading') {
    return (
      <ThemedView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
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

  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="dashboard" options={{ title: 'Home' }} />
      <Tabs.Screen
        name="inbox"
        options={{ title: 'Inbox', tabBarBadge: unreadCount > 0 ? unreadCount : undefined }}
      />
      <Tabs.Screen name="announcements" options={{ title: 'Announcements' }} />
      <Tabs.Screen name="dues" options={{ title: 'Payments' }} />
      <Tabs.Screen name="events" options={{ title: 'Events' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
