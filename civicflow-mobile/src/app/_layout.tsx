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
        </Stack>
      </AuthProvider>
    </ThemeProvider>
  );
}
