import * as Notifications from 'expo-notifications';
import { router, useRootNavigationState } from 'expo-router';
import { useEffect, useRef } from 'react';

import { useAuth } from '@/lib/auth-context';
import { navigateToDeepLink } from '@/lib/deep-links';
import { resolveNotificationTapAction } from '@/lib/notification-tap';

/**
 * Notification-tap navigation, gated on the app being ready AND resolved
 * against multi-organization isolation rules.
 *
 * The link is HELD until the root navigator is mounted, auth is `signedIn`,
 * and an organization is selected (so index's redirect chain has finished and
 * the tabs are the base of the stack), then dispatched one frame later so the
 * redirect commit settles first — preventing the "back button dead until
 * restart" corruption a mid-transition push caused.
 *
 * Tenant isolation (resolveNotificationTapAction): a tap now carries the
 * originating `organizationId`. If the signed-in user cannot access it
 * (removed membership, cross-tenant, stale/malformed id), the protected
 * resource is never opened — the user lands on the neutral inbox. If it is a
 * different org than the one selected, the org context is switched FIRST (which
 * re-scopes org-specific screens), then the target is opened one frame later so
 * no other organization's content flashes during the transition. A signed-out
 * tap is held and RE-VALIDATED after login. Payloads without an organizationId
 * (older server build) navigate as before.
 */
export function useNotificationDeepLinks() {
  const { status, selectedOrganizationId, organizations, selectOrganization } = useAuth();
  const rootNavigationState = useRootNavigationState();

  const pendingRef = useRef<unknown>(null);
  const handledIdentifiersRef = useRef<Set<string>>(new Set());

  const ready = Boolean(rootNavigationState?.key) && status === 'signedIn' && Boolean(selectedOrganizationId);
  const readyRef = useRef(ready);
  readyRef.current = ready;

  // The response listener is mounted once; keep the latest auth values in refs
  // so it always resolves against current access (e.g. a membership removed
  // between mint and tap).
  const orgsRef = useRef(organizations);
  orgsRef.current = organizations;
  const selectedOrgRef = useRef(selectedOrganizationId);
  selectedOrgRef.current = selectedOrganizationId;
  const selectOrgRef = useRef(selectOrganization);
  selectOrgRef.current = selectOrganization;

  async function dispatch(data: unknown) {
    const action = resolveNotificationTapAction(data, {
      accessibleOrganizationIds: (orgsRef.current ?? []).map((org) => org.organizationId),
      selectedOrganizationId: selectedOrgRef.current ?? null,
    });

    switch (action.type) {
      case 'ignore':
        return;
      case 'navigate':
        navigateToDeepLink(action.deepLink);
        return;
      case 'switchThenNavigate':
        await selectOrgRef.current(action.organizationId);
        // Let the org switch re-scope screens before the target push commits.
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        navigateToDeepLink(action.deepLink);
        return;
      case 'unavailable':
        // Neutral Unestra screen — never the protected resource.
        router.replace({ pathname: '/inbox', params: { unavailable: '1' } });
        return;
    }
  }

  useEffect(() => {
    const acceptResponse = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const identifier = response.notification.request.identifier;
      if (identifier && handledIdentifiersRef.current.has(identifier)) return;
      if (identifier) handledIdentifiersRef.current.add(identifier);

      const data = response.notification.request.content.data ?? {};
      if (typeof (data as Record<string, unknown>).deepLink !== 'string') return;

      if (readyRef.current) {
        void dispatch(data);
      } else {
        // Hold the RAW payload so it is re-validated against access after login.
        pendingRef.current = data;
      }
    };

    Notifications.getLastNotificationResponseAsync().then(acceptResponse);
    const subscription = Notifications.addNotificationResponseReceivedListener(acceptResponse);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!ready || pendingRef.current == null) return;
    const data = pendingRef.current;
    pendingRef.current = null;
    const frame = requestAnimationFrame(() => void dispatch(data));
    return () => cancelAnimationFrame(frame);
  }, [ready]);
}
