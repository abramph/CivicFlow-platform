import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { AuthProvider } from '@/lib/auth-context';
import { Colors } from '@/constants/theme';
import { navigateToDeepLink } from '@/lib/deep-links';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const theme = colorScheme === 'dark' ? Colors.dark : Colors.light;

  useEffect(() => {
    // Tapping a notification (dues reminder, announcement, payment
    // confirmation, etc.) opens its deep link, validated against the
    // allow-list — never trusted blindly, even though it came from our own
    // push payload.
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const deepLink = response.notification.request.content.data?.deepLink;
      if (typeof deepLink === 'string') navigateToDeepLink(deepLink);
    });
    return () => subscription.remove();
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthProvider>
        <Stack
          screenOptions={{
            headerShown: true,
            headerTitle: '',
            headerShadowVisible: false,
            headerTintColor: '#047857',
            headerStyle: { backgroundColor: theme.background },
            headerBackButtonDisplayMode: 'minimal',
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="accept-invite" options={{ headerShown: false }} />
          <Stack.Screen name="payments" options={{ headerShown: false }} />
          <Stack.Screen name="organization/[organizationId]" options={{ headerShown: false }} />
          <Stack.Screen name="volunteer-opportunity/[id]" options={{ headerTitle: 'Volunteer Opportunity' }} />
          <Stack.Screen name="volunteer-checkin" options={{ headerTitle: 'Event-Day Check-In' }} />
          <Stack.Screen name="volunteer-checkin/[opportunityId]" options={{ headerTitle: 'Roster' }} />
          <Stack.Screen name="volunteer-hour-approvals" options={{ headerTitle: 'Hour Approvals' }} />
          <Stack.Screen name="admin-members" options={{ headerTitle: 'Members' }} />
          <Stack.Screen name="admin-members/[memberId]/index" options={{ headerTitle: 'Member' }} />
          <Stack.Screen name="admin-members/new" options={{ headerTitle: 'Add Member' }} />
          <Stack.Screen name="admin-members/[memberId]/edit" options={{ headerTitle: 'Edit Member' }} />
          <Stack.Screen name="admin-members/[memberId]/record-payment" options={{ headerTitle: 'Record Payment' }} />
          <Stack.Screen name="admin-members/[memberId]/add-adjustment" options={{ headerTitle: 'Add Adjustment' }} />
          <Stack.Screen name="admin-events" options={{ headerTitle: 'Events' }} />
          <Stack.Screen name="admin-events/new" options={{ headerTitle: 'Add Event' }} />
          <Stack.Screen name="admin-events/[eventId]/index" options={{ headerTitle: 'Event' }} />
          <Stack.Screen name="admin-events/[eventId]/edit" options={{ headerTitle: 'Edit Event' }} />
          <Stack.Screen name="admin-events/[eventId]/attendance-session" options={{ headerTitle: 'Attendance' }} />
          <Stack.Screen name="admin-campaigns" options={{ headerTitle: 'Campaigns' }} />
          <Stack.Screen name="admin-campaigns/new" options={{ headerTitle: 'New Campaign' }} />
          <Stack.Screen name="admin-campaigns/[campaignId]/index" options={{ headerTitle: 'Campaign' }} />
          <Stack.Screen name="admin-payments" options={{ headerTitle: 'Payments' }} />
          <Stack.Screen name="admin-contributions" options={{ headerTitle: 'Contributions' }} />
          <Stack.Screen name="admin-contributions/new" options={{ headerTitle: 'New Contribution' }} />
          <Stack.Screen name="admin-contributions/[contributionId]/index" options={{ headerTitle: 'Contribution' }} />
          <Stack.Screen name="admin-contributions/[contributionId]/edit" options={{ headerTitle: 'Edit Contribution' }} />
          <Stack.Screen name="admin-payment-reports" options={{ headerTitle: 'Payment Reports' }} />
          <Stack.Screen name="admin-reports" options={{ headerTitle: 'Reports' }} />
          <Stack.Screen name="admin-pta-households" options={{ headerTitle: 'Households' }} />
          <Stack.Screen name="admin-pta-households/new" options={{ headerTitle: 'New Household' }} />
          <Stack.Screen name="admin-pta-households/[householdId]/index" options={{ headerTitle: 'Household' }} />
          <Stack.Screen name="admin-pta-households/[householdId]/edit" options={{ headerTitle: 'Edit Household' }} />
          <Stack.Screen name="admin-hoa-properties" options={{ headerTitle: 'Properties' }} />
          <Stack.Screen name="admin-hoa-properties/new" options={{ headerTitle: 'New Property' }} />
          <Stack.Screen name="admin-hoa-properties/[propertyId]/index" options={{ headerTitle: 'Property' }} />
          <Stack.Screen name="admin-hoa-properties/[propertyId]/edit" options={{ headerTitle: 'Edit Property' }} />
          <Stack.Screen name="admin-hoa-violations" options={{ headerTitle: 'Violations' }} />
          <Stack.Screen name="admin-hoa-violations/new" options={{ headerTitle: 'New Violation' }} />
          <Stack.Screen name="admin-hoa-violations/[violationId]/index" options={{ headerTitle: 'Violation' }} />
          <Stack.Screen name="admin-hoa-architectural-requests" options={{ headerTitle: 'Architectural Requests' }} />
          <Stack.Screen name="admin-hoa-architectural-requests/[requestId]/index" options={{ headerTitle: 'Request' }} />
        </Stack>
      </AuthProvider>
    </ThemeProvider>
  );
}
