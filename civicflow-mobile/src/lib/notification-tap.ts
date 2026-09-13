/**
 * Pure, framework-free resolution of what a notification tap should do, given
 * the tap payload and the current auth context. Kept separate from the React
 * hook (use-notification-deep-links.ts) so the multi-organization isolation
 * rules can be unit-tested without a navigator or a mounted component.
 *
 * Fail-closed rules:
 *  - No deep link → ignore.
 *  - No organizationId in the payload (older server build) → navigate as before
 *    (the deep link is still allow-list validated at navigation time).
 *  - organizationId the signed-in user cannot access (removed membership,
 *    cross-tenant, stale/malformed id) → NEVER open the protected resource;
 *    surface a neutral "unavailable" destination instead.
 *  - organizationId differs from the selected org → switch org context first,
 *    then navigate, so the target mounts under the correct tenant and no other
 *    organization's cached content can flash during the transition.
 */

export type NotificationTapAction =
  | { type: "ignore" }
  | { type: "navigate"; deepLink: string }
  | { type: "switchThenNavigate"; organizationId: string; deepLink: string }
  | { type: "unavailable" };

export interface NotificationTapContext {
  /** Organization ids the signed-in user currently has access to. */
  accessibleOrganizationIds: string[];
  /** The currently-selected organization id, if any. */
  selectedOrganizationId: string | null;
}

export function resolveNotificationTapAction(data: unknown, ctx: NotificationTapContext): NotificationTapAction {
  const payload = (data ?? {}) as Record<string, unknown>;

  const deepLink = typeof payload.deepLink === "string" ? payload.deepLink : null;
  if (!deepLink) return { type: "ignore" };

  const rawOrg = payload.organizationId;
  const organizationId = typeof rawOrg === "string" && rawOrg.trim() ? rawOrg.trim() : null;

  // Backward compatibility: a push minted before this change carries no org id.
  if (!organizationId) return { type: "navigate", deepLink };

  // Fail closed on any org the user cannot access.
  if (!ctx.accessibleOrganizationIds.includes(organizationId)) return { type: "unavailable" };

  if (organizationId !== ctx.selectedOrganizationId) {
    return { type: "switchThenNavigate", organizationId, deepLink };
  }
  return { type: "navigate", deepLink };
}
