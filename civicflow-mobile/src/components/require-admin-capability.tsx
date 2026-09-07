import type { ComponentType } from 'react';

import { UnauthorizedNotice } from '@/components/unauthorized-notice';
import { useAuth } from '@/lib/auth-context';
import { deriveOrgCapabilities } from '@/lib/org-capabilities';

/**
 * Route-level guard for admin create/edit/action screens (Build 27). Every
 * admin LIST screen already renders its own "no access" state, but the
 * write screens under them shipped with no client-side check at all — a
 * deep link landed an unauthorized user on a fully interactive form whose
 * only stop was the server's 403 surfacing as a raw error. Wrapping the
 * whole screen keeps the check outside the screen's own hook order (the
 * screen simply never mounts without the capability), so screens don't
 * each re-implement the early-return-after-hooks dance.
 *
 * The server remains the real gate; capability strings here are the same
 * server-resolved adminCapabilities the tab and list screens key off.
 */
export function requireAdminCapability<P extends object>(
  capability: string,
  noun: string,
  Screen: ComponentType<P>
): ComponentType<P> {
  return function GuardedAdminScreen(props: P) {
    const { selectedOrganization } = useAuth();
    const caps = deriveOrgCapabilities(selectedOrganization);
    if (!caps.adminCapabilities.includes(capability)) {
      return <UnauthorizedNotice message={`You don't have ${noun} access for this organization.`} />;
    }
    return <Screen {...props} />;
  };
}
