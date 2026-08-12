import * as Notifications from 'expo-notifications';
import { useRootNavigationState } from 'expo-router';
import { useEffect, useRef } from 'react';

import { useAuth } from '@/lib/auth-context';
import { navigateToDeepLink } from '@/lib/deep-links';

/**
 * Notification-tap deep links, gated on the app actually being ready to
 * navigate.
 *
 * The previous implementation pushed the deep link the moment the tap event
 * arrived. On a cold start that raced the auth flow: the detail screen was
 * pushed on top of the still-loading `index` screen, whose `<Redirect>` then
 * fired a replace across the in-flight transition — leaving the navigation
 * stack in a corrupted state where the header back arrow rendered but no
 * longer popped anything (the "back button dead until app restart" bug,
 * reported on event/announcement screens — exactly the push-notification
 * destinations).
 *
 * Now the link is HELD until three things are all true — the root navigator
 * has a state key (mounted), auth is `signedIn`, and an organization is
 * selected (i.e. index's redirect chain has finished and the tabs are the
 * base of the stack) — and only then pushed, one frame later so the redirect
 * commit settles first. A tap that arrives while signed out is held: the
 * user goes through login normally and lands on the notification's target
 * right after the dashboard mounts.
 *
 * Cold-start taps are ALSO picked up via getLastNotificationResponseAsync(),
 * which the listener-only implementation missed entirely, and de-duplicated
 * by notification identifier so a response is never navigated twice.
 */
export function useNotificationDeepLinks() {
  const { status, selectedOrganizationId } = useAuth();
  const rootNavigationState = useRootNavigationState();

  const pendingRef = useRef<string | null>(null);
  const handledIdentifiersRef = useRef<Set<string>>(new Set());

  const ready = Boolean(rootNavigationState?.key) && status === 'signedIn' && Boolean(selectedOrganizationId);
  const readyRef = useRef(ready);
  readyRef.current = ready;

  useEffect(() => {
    const acceptResponse = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const identifier = response.notification.request.identifier;
      if (identifier && handledIdentifiersRef.current.has(identifier)) return;
      if (identifier) handledIdentifiersRef.current.add(identifier);

      const deepLink = response.notification.request.content.data?.deepLink;
      if (typeof deepLink !== 'string') return;

      if (readyRef.current) {
        navigateToDeepLink(deepLink);
      } else {
        pendingRef.current = deepLink;
      }
    };

    // Cold start: the tap that launched the app is delivered as the "last"
    // response, not through the listener.
    Notifications.getLastNotificationResponseAsync().then(acceptResponse);

    const subscription = Notifications.addNotificationResponseReceivedListener(acceptResponse);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!ready || !pendingRef.current) return;
    const deepLink = pendingRef.current;
    pendingRef.current = null;
    // One frame so the index→tabs redirect that just made us "ready" commits
    // before the detail push starts — never two navigations in one commit.
    const frame = requestAnimationFrame(() => navigateToDeepLink(deepLink));
    return () => cancelAnimationFrame(frame);
  }, [ready]);
}
