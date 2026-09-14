/**
 * Pure, framework-free resolution of what a notification tap should do, given
 * the tap payload and the current auth context. Kept separate from the React
 * hook (use-notification-deep-links.ts) so the multi-organization isolation
 * rules can be unit-tested without a navigator or a mounted component.
 *
 * Fail-closed rules:
 *  - No deep link → ignore.
 *  - Server-authored platform scope (`notificationScope === "platform"`) → only
 *    an APPROVED global route is opened; anything else → unavailable. The
 *    ABSENCE of a scope is NEVER treated as trusted platform scope.
 *  - Otherwise the notification is organization-scoped. A missing, empty or
 *    malformed `organizationId`, or an organization the signed-in user cannot
 *    access (removed membership, cross-tenant, stale id) → NEVER open the
 *    protected resource; surface a neutral "unavailable" destination instead.
 *  - An accessible organization that differs from the selected one → switch org
 *    context first, then navigate, so the target mounts under the correct
 *    tenant and no other organization's content can flash during the transition.
 *
 * The accessible-org list passed in `ctx` MUST be a freshly server-validated
 * one (see use-notification-deep-links.ts) — never a stale session cache.
 */

/** Global routes a platform-scoped notification is allowed to open. Mirrors the
 *  server's PLATFORM_DEEP_LINK_ALLOWLIST (civicflow-portal notifications/send.ts)
 *  and must stay a subset of resolveAllowedDeepLinkPath's allow-list — only
 *  routes accepted end-to-end. /settings/* are intentionally absent (no such
 *  mobile route exists yet). */
export const PLATFORM_DEEP_LINK_ALLOWLIST = ["/inbox"];

export type NotificationTapAction =
  | { type: "ignore" }
  | { type: "navigate"; deepLink: string }
  | { type: "switchThenNavigate"; organizationId: string; deepLink: string }
  | { type: "unavailable" };

export interface NotificationTapContext {
  /** Organization ids the signed-in user CURRENTLY has access to (server-fresh). */
  accessibleOrganizationIds: string[];
  /** The currently-selected organization id, if any. */
  selectedOrganizationId: string | null;
}

export function resolveNotificationTapAction(data: unknown, ctx: NotificationTapContext): NotificationTapAction {
  const payload = (data ?? {}) as Record<string, unknown>;

  const deepLink = typeof payload.deepLink === "string" && payload.deepLink.trim() ? payload.deepLink : null;
  if (!deepLink) return { type: "ignore" };

  // Explicit, server-authored platform scope — global routing, no org required,
  // but restricted to an approved allowlist. Absence of scope is NOT platform.
  if (payload.notificationScope === "platform") {
    return PLATFORM_DEEP_LINK_ALLOWLIST.includes(deepLink) ? { type: "navigate", deepLink } : { type: "unavailable" };
  }

  // Organization-scoped (the default). Fail closed on a missing/blank/malformed
  // organization id — an org-scoped resource is never opened without a verified
  // accessible tenant.
  const rawOrg = payload.organizationId;
  const organizationId = typeof rawOrg === "string" && rawOrg.trim() ? rawOrg.trim() : null;
  if (!organizationId) return { type: "unavailable" };

  if (!ctx.accessibleOrganizationIds.includes(organizationId)) return { type: "unavailable" };

  if (organizationId !== ctx.selectedOrganizationId) {
    return { type: "switchThenNavigate", organizationId, deepLink };
  }
  return { type: "navigate", deepLink };
}
