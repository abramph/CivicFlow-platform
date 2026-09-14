import * as Notifications from 'expo-notifications';
import { router, useRootNavigationState } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { useAuth } from '@/lib/auth-context';
import { navigateToDeepLink } from '@/lib/deep-links';
import { resolveNotificationTapAction } from '@/lib/notification-tap';

/** How long to wait for a requested org switch to actually commit before
 *  failing closed to the neutral inbox. */
const ORG_SWITCH_COMMIT_TIMEOUT_MS = 8000;

interface PendingSwitch {
  organizationId: string;
  deepLink: string;
}

/**
 * Notification-tap navigation with LIVE, fail-closed multi-organization
 * isolation.
 *
 * On tap of an organization-scoped notification the app does NOT trust its
 * cached org list: it re-fetches the caller's current access from the server
 * (refreshOrganizations), fails closed to the neutral inbox if that fetch
 * fails, and only proceeds if the payload's organization is still accessible.
 * A tap for a different accessible org switches context and then navigates via
 * an ACKNOWLEDGED transition — it waits until selectedOrganizationId actually
 * equals the target (re-checking access at that point) rather than assuming the
 * switch committed after an animation frame; if the switch never commits it
 * fails closed. A tap the user can no longer access, a missing/stale org id, or
 * a refresh failure opens the neutral inbox, never the protected resource. A
 * signed-out tap is held and re-validated after login. Platform-scoped
 * notifications route only to approved global routes.
 *
 * The link is still HELD until the root navigator is mounted, auth is
 * `signedIn`, and an org is selected, so index's redirect chain has finished
 * before anything navigates (the dead-back-arrow fix).
 */
export function useNotificationDeepLinks() {
  const { status, selectedOrganizationId, organizations, selectOrganization, refreshOrganizations } = useAuth();
  const rootNavigationState = useRootNavigationState();

  const heldPayloadRef = useRef<unknown>(null);
  const handledIdentifiersRef = useRef<Set<string>>(new Set());
  const [pendingSwitch, setPendingSwitch] = useState<PendingSwitch | null>(null);
  const pendingSwitchRef = useRef<PendingSwitch | null>(null);

  const ready = Boolean(rootNavigationState?.key) && status === 'signedIn' && Boolean(selectedOrganizationId);
  const readyRef = useRef(ready);
  readyRef.current = ready;

  // Listener is mounted once; keep the latest auth values/functions in refs so
  // it always resolves against current access and calls the live functions.
  const selectedOrgRef = useRef(selectedOrganizationId);
  selectedOrgRef.current = selectedOrganizationId;
  const selectOrgRef = useRef(selectOrganization);
  selectOrgRef.current = selectOrganization;
  const refreshOrgsRef = useRef(refreshOrganizations);
  refreshOrgsRef.current = refreshOrganizations;

  function goNeutralInbox() {
    router.replace({ pathname: '/inbox', params: { unavailable: '1' } });
  }

  async function dispatch(data: unknown) {
    const payload = (data ?? {}) as Record<string, unknown>;
    if (typeof payload.deepLink !== 'string') return;

    // Platform-scoped: no org, no server refresh — the resolver only allows an
    // approved global route.
    if (payload.notificationScope === 'platform') {
      const action = resolveNotificationTapAction(data, {
        accessibleOrganizationIds: [],
        selectedOrganizationId: selectedOrgRef.current ?? null,
      });
      if (action.type === 'navigate') navigateToDeepLink(action.deepLink);
      else if (action.type === 'unavailable') goNeutralInbox();
      return;
    }

    // Organization-scoped: LIVE-revalidate access from the server; fail closed.
    let accessibleOrganizationIds: string[];
    try {
      const freshOrgs = await refreshOrgsRef.current();
      accessibleOrganizationIds = freshOrgs.map((org) => org.organizationId);
    } catch {
      goNeutralInbox();
      return;
    }

    const action = resolveNotificationTapAction(data, {
      accessibleOrganizationIds,
      selectedOrganizationId: selectedOrgRef.current ?? null,
    });

    switch (action.type) {
      case 'ignore':
        return;
      case 'navigate':
        navigateToDeepLink(action.deepLink);
        return;
      case 'unavailable':
        goNeutralInbox();
        return;
      case 'switchThenNavigate': {
        // Begin an acknowledged switch: request the org change and wait for it
        // to actually commit (handled by the effect below), then navigate.
        const target: PendingSwitch = { organizationId: action.organizationId, deepLink: action.deepLink };
        pendingSwitchRef.current = target;
        setPendingSwitch(target);
        await selectOrgRef.current(action.organizationId);
        return;
      }
    }
  }

  // Acknowledged org-switch transition: navigate ONLY once the selected org
  // actually equals the requested target (re-checking access at that moment),
  // never merely because time elapsed. Fails closed on timeout.
  useEffect(() => {
    if (!pendingSwitch) return;

    if (selectedOrganizationId === pendingSwitch.organizationId) {
      const stillAccessible = organizations.some((org) => org.organizationId === pendingSwitch.organizationId);
      pendingSwitchRef.current = null;
      setPendingSwitch(null);
      if (stillAccessible) navigateToDeepLink(pendingSwitch.deepLink);
      else goNeutralInbox();
      return;
    }

    const timer = setTimeout(() => {
      if (pendingSwitchRef.current) {
        pendingSwitchRef.current = null;
        setPendingSwitch(null);
        goNeutralInbox();
      }
    }, ORG_SWITCH_COMMIT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [pendingSwitch, selectedOrganizationId, organizations]);

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
        heldPayloadRef.current = data;
      }
    };

    Notifications.getLastNotificationResponseAsync().then(acceptResponse);
    const subscription = Notifications.addNotificationResponseReceivedListener(acceptResponse);
    return () => subscription.remove();
    // Listener mounted once; dispatch reads live values through refs, so it is
    // intentionally excluded from deps (re-subscribing every render is wrong).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready || heldPayloadRef.current == null) return;
    const data = heldPayloadRef.current;
    heldPayloadRef.current = null;
    void dispatch(data);
    // Fire only on the ready transition; dispatch is ref-backed (see above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
}
