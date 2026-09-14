import "server-only";
import {
  buildNotificationIdentity,
  resolveDirectMessageSenderName,
  PLATFORM_NOTIFICATION_TITLE,
  type NotificationCategory,
} from "@/lib/notifications/identity";
import { sendPushToMember, sendPushToTokens } from "@/lib/push";

/**
 * Organization-branded push senders. Every organization-generated push path
 * calls one of these instead of touching the low-level push.ts functions
 * directly (enforced by notifications-layer-boundary.test.ts): the
 * organization name is resolved server-side (from the tenant-scoped
 * organizationId) and becomes the notification title, with the category as the
 * subtitle — while the installed "Unestra" app icon stays the trusted
 * application identity. The reserved payload fields (deepLink, organizationId,
 * category, notificationScope) are written authoritatively by push.ts and can
 * never be overridden by caller `data`.
 */

interface OrgPushContent {
  organizationId?: string | null;
  category: NotificationCategory;
  body: string;
  deepLink?: string | null;
  /** DIRECT_MESSAGE only — the authenticated sender's user id. The display
   *  name is resolved server-side from the tenant-scoped membership; a
   *  caller-supplied name is never accepted. */
  senderUserId?: string | null;
  data?: Record<string, unknown>;
}

async function buildOrgPush(content: OrgPushContent) {
  const senderName =
    content.category === "DIRECT_MESSAGE" && content.organizationId && content.senderUserId
      ? await resolveDirectMessageSenderName(content.organizationId, content.senderUserId)
      : null;

  const identity = await buildNotificationIdentity({
    category: content.category,
    organizationId: content.organizationId,
    senderName,
  });

  if (!identity.organizationResolved && content.organizationId) {
    // Privacy-safe: identifiers only — never names, bodies, tokens, emails, phones.
    console.warn(
      JSON.stringify({
        event: "notification_org_unresolved",
        organizationId: content.organizationId,
        category: content.category,
      })
    );
  }

  return {
    title: identity.title,
    subtitle: identity.subtitle,
    body: content.body,
    deepLink: content.deepLink,
    organizationId: content.organizationId ?? null,
    category: identity.category,
    // Only non-reserved extra data — deepLink/organizationId/category are
    // written authoritatively by push.ts (buildPushData), never from here.
    data: content.data,
  };
}

/** Member-targeted organization push (respects the member's push opt-out
 *  unless `required`). Tenant isolation + opt-out handling live in
 *  sendPushToMember; identity is resolved here. */
export async function sendOrganizationMemberPush(params: {
  organizationId: string;
  memberId: string;
  category: NotificationCategory;
  body: string;
  deepLink?: string | null;
  senderUserId?: string | null;
  required?: boolean;
}) {
  const push = await buildOrgPush(params);
  return sendPushToMember({
    organizationId: params.organizationId,
    memberId: params.memberId,
    title: push.title,
    subtitle: push.subtitle,
    body: push.body,
    deepLink: push.deepLink,
    category: push.category,
    data: push.data,
    required: params.required,
  });
}

/** Token-targeted organization push — recipients already resolved (org-scoped)
 *  by the caller (bulk campaigns, HOA/union fan-out, PTA household adults). */
export async function sendOrganizationTokensPush(params: {
  organizationId: string;
  tokens: string[];
  category: NotificationCategory;
  body: string;
  deepLink?: string | null;
  senderUserId?: string | null;
  data?: Record<string, unknown>;
}) {
  const push = await buildOrgPush(params);
  return sendPushToTokens(params.tokens, {
    title: push.title,
    subtitle: push.subtitle,
    body: push.body,
    deepLink: push.deepLink,
    organizationId: push.organizationId,
    category: push.category,
    data: push.data,
  });
}

/**
 * The ONE documented platform-level (non-tenant) push sender. Titles as
 * "Unestra", stamps the payload with the server-authored
 * `notificationScope: "platform"` the mobile client requires to route a global
 * notification, and only ever targets an APPROVED global route (see
 * PLATFORM_DEEP_LINK_ALLOWLIST). There is no in-app caller yet; this exists so
 * that if a platform security/billing alert is added, it routes through the
 * canonical layer rather than reaching for push.ts directly. Any deep link
 * outside the allowlist is dropped to null (neutral) rather than trusted.
 */
export const PLATFORM_DEEP_LINK_ALLOWLIST = ["/inbox", "/settings/security", "/settings/billing"] as const;

export async function sendPlatformTokensPush(params: {
  tokens: string[];
  body: string;
  subtitle?: string | null;
  deepLink?: string | null;
  data?: Record<string, unknown>;
}) {
  const approved =
    typeof params.deepLink === "string" && (PLATFORM_DEEP_LINK_ALLOWLIST as readonly string[]).includes(params.deepLink)
      ? params.deepLink
      : null;
  return sendPushToTokens(params.tokens, {
    title: PLATFORM_NOTIFICATION_TITLE,
    subtitle: params.subtitle ?? null,
    body: params.body,
    deepLink: approved,
    notificationScope: "platform",
    data: params.data,
  });
}
