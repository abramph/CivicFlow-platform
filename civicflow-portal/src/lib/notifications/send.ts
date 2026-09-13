import "server-only";
import { buildNotificationIdentity, type NotificationCategory } from "@/lib/notifications/identity";
import { sendPushToMember, sendPushToTokens } from "@/lib/push";

/**
 * Organization-branded push senders. Every push path calls one of these
 * instead of setting a title itself: the organization name is resolved
 * server-side (from the tenant-scoped organizationId) and becomes the
 * notification title, with the category as the subtitle — while the installed
 * "Unestra" app icon remains the trusted application identity. The payload
 * also carries `data.organizationId` and `data.category` so the mobile app can
 * switch org context safely on tap and present the category.
 */

interface OrgPushContent {
  organizationId?: string | null;
  category: NotificationCategory;
  body: string;
  deepLink?: string | null;
  /** DIRECT_MESSAGE only — the caller must already be authorized to surface it. */
  senderName?: string | null;
  data?: Record<string, unknown>;
}

async function buildOrgPush(content: OrgPushContent) {
  const identity = await buildNotificationIdentity({
    category: content.category,
    organizationId: content.organizationId,
    senderName: content.senderName,
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
    data: {
      ...content.data,
      organizationId: content.organizationId ?? null,
      category: identity.category,
    },
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
  senderName?: string | null;
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
  senderName?: string | null;
  data?: Record<string, unknown>;
}) {
  const push = await buildOrgPush(params);
  return sendPushToTokens(params.tokens, {
    title: push.title,
    subtitle: push.subtitle,
    body: push.body,
    deepLink: push.deepLink,
    data: push.data,
  });
}
