import { Redirect, Tabs } from 'expo-router';
import { ActivityIndicator } from 'react-native';

import { ThemedView } from '@/components/themed-view';
import { useAuth } from '@/lib/auth-context';
import { useUnreadConversationCount } from '@/lib/unread-count';

export default function TabsLayout() {
  const { status, selectedOrganization, selectedOrganizationId } = useAuth();
  const unreadCount = useUnreadConversationCount(selectedOrganizationId);
  // Hidden entirely — not just disabled — for any org where the caller has
  // no PTA identity at all, per the explicit "never show PTA features for
  // organizations not enrolled in PTA Labs" requirement. A tab that exists
  // but 403s on open is still a worse experience than one that isn't there.
  const hasPtaAccess = Boolean(selectedOrganization?.pta);
  // Mobile Admin program (PR A) — same hide-not-disable pattern, driven by
  // the server-resolved adminCapabilities array (never a role/permission
  // string checked here). Empty array means the caller holds no admin
  // capability for this org at all, regardless of what their role is called.
  const hasAdminAccess = Boolean(selectedOrganization?.capability?.adminCapabilities?.length);

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
      <Tabs.Screen name="dashboard" options={{ title: 'Home', tabBarAccessibilityLabel: 'Home' }} />
      <Tabs.Screen
        name="inbox"
        options={{
          title: 'Inbox',
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
          tabBarAccessibilityLabel: unreadCount > 0 ? `Inbox, ${unreadCount} unread` : 'Inbox',
        }}
      />
      <Tabs.Screen name="announcements" options={{ title: 'Announcements', tabBarAccessibilityLabel: 'Announcements' }} />
      <Tabs.Screen name="dues" options={{ title: 'Payments', tabBarAccessibilityLabel: 'Payments' }} />
      <Tabs.Screen name="events" options={{ title: 'Events', tabBarAccessibilityLabel: 'Events' }} />
      <Tabs.Screen
        name="volunteers"
        options={{ title: 'Volunteer', href: hasPtaAccess ? undefined : null, tabBarAccessibilityLabel: 'Volunteer' }}
      />
      <Tabs.Screen
        name="admin"
        options={{ title: 'Admin', href: hasAdminAccess ? undefined : null, tabBarAccessibilityLabel: 'Admin' }}
      />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarAccessibilityLabel: 'Profile' }} />
    </Tabs>
  );
}
