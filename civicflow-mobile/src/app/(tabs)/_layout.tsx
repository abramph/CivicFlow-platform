import { Redirect, Tabs } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

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
  // Union mobile UX correction — a Union member opens the app to get help
  // and track a case, not to browse a generic payment-first nav. This is
  // read fresh from selectedOrganization (itself a useMemo off live auth
  // state) on every render, so switching organizations mid-session updates
  // the tab bar immediately with no stale tab from the previous org's
  // vertical. Vertical-only gate, same reasoning as isUnion in
  // dashboard.tsx: caseManagement is unconditionally on for the whole
  // UNION vertical, not a separate per-org toggle.
  const isUnion = selectedOrganization?.capability?.primaryVertical === 'UNION';

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
      <Tabs.Screen
        name="dashboard"
        options={{ title: 'Home', tabBarAccessibilityLabel: 'Home', tabBarIcon: ({ color, focused }) => <TabIcon name="home" color={color} focused={focused} /> }}
      />
      <Tabs.Screen
        name="cases"
        options={{
          title: 'Cases',
          href: isUnion ? undefined : null,
          tabBarAccessibilityLabel: 'Cases',
          tabBarIcon: ({ color, focused }) => <TabIcon name="cases" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="inbox"
        options={{
          title: 'Inbox',
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
          tabBarAccessibilityLabel: unreadCount > 0 ? `Inbox, ${unreadCount} unread` : 'Inbox',
          tabBarIcon: ({ color, focused }) => <TabIcon name="inbox" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="announcements"
        options={{
          title: 'Announcements',
          // Union foregrounds Cases instead — Announcements stays a real,
          // reachable screen (the dashboard's "Recent Announcements"
          // section still links into it), just not primary nav.
          href: isUnion ? null : undefined,
          tabBarAccessibilityLabel: 'Announcements',
          tabBarIcon: ({ color, focused }) => <TabIcon name="announcements" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="dues"
        options={{
          title: 'Payments',
          // Most Union members pay dues via employer payroll checkoff, not
          // member-initiated payment (see dashboard.tsx's isUnion comment) —
          // relocated to Profile → Membership & Dues instead of primary nav.
          href: isUnion ? null : undefined,
          tabBarAccessibilityLabel: 'Payments',
          tabBarIcon: ({ color, focused }) => <TabIcon name="payments" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="events"
        options={{ title: 'Events', tabBarAccessibilityLabel: 'Events', tabBarIcon: ({ color, focused }) => <TabIcon name="events" color={color} focused={focused} /> }}
      />
      <Tabs.Screen
        name="volunteers"
        options={{
          title: 'Volunteer',
          href: hasPtaAccess ? undefined : null,
          tabBarAccessibilityLabel: 'Volunteer',
          tabBarIcon: ({ color, focused }) => <TabIcon name="volunteer" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="admin"
        options={{
          title: 'Admin',
          href: hasAdminAccess ? undefined : null,
          tabBarAccessibilityLabel: 'Admin',
          tabBarIcon: ({ color, focused }) => <TabIcon name="admin" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Profile', tabBarAccessibilityLabel: 'Profile', tabBarIcon: ({ color, focused }) => <TabIcon name="profile" color={color} focused={focused} /> }}
      />
    </Tabs>
  );
}

type TabIconName = 'home' | 'inbox' | 'announcements' | 'payments' | 'events' | 'volunteer' | 'admin' | 'profile' | 'cases';

function TabIcon({ name, color, focused }: { name: TabIconName; color: string; focused: boolean }) {
  return (
    <View
      style={[styles.tabIcon, focused && styles.tabIconFocused, { borderColor: color }]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      {name === 'home' ? <View style={[styles.roof, { borderBottomColor: color }]} /> : null}
      {name === 'inbox' ? <View style={[styles.inboxTray, { borderColor: color }]} /> : null}
      {name === 'announcements' ? <View style={[styles.megaphone, { backgroundColor: color }]} /> : null}
      {name === 'payments' ? <View style={[styles.paymentLine, { backgroundColor: color }]} /> : null}
      {name === 'events' ? <View style={[styles.calendarTop, { backgroundColor: color }]} /> : null}
      {name === 'volunteer' ? <View style={[styles.volunteerDot, { backgroundColor: color }]} /> : null}
      {name === 'admin' ? <View style={[styles.adminLine, { backgroundColor: color }]} /> : null}
      {name === 'profile' ? <View style={[styles.profileDot, { backgroundColor: color }]} /> : null}
      {name === 'cases' ? <View style={[styles.casesFolder, { borderColor: color }]} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tabIcon: {
    width: 23,
    height: 23,
    borderWidth: 2,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIconFocused: {
    borderWidth: 2.5,
  },
  roof: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderBottomWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    position: 'absolute',
    top: -7,
  },
  inboxTray: {
    width: 13,
    height: 7,
    borderWidth: 2,
    borderTopWidth: 0,
    borderRadius: 2,
  },
  megaphone: {
    width: 12,
    height: 8,
    borderRadius: 2,
    transform: [{ skewX: '-12deg' }],
  },
  paymentLine: {
    width: 13,
    height: 3,
    borderRadius: 2,
  },
  calendarTop: {
    width: 15,
    height: 4,
    borderRadius: 2,
    position: 'absolute',
    top: 4,
  },
  volunteerDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  adminLine: {
    width: 13,
    height: 13,
    borderRadius: 3,
    transform: [{ rotate: '45deg' }],
  },
  profileDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    position: 'absolute',
    top: 4,
  },
  casesFolder: {
    width: 15,
    height: 11,
    borderWidth: 2,
    borderRadius: 2,
  },
});
