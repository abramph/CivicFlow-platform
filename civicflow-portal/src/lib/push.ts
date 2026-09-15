import { Expo, type ExpoPushMessage } from "expo-server-sdk";
import { prisma } from "@/lib/prisma";
import { validateDeepLink } from "@/lib/deep-links";
import { resolvePtaHouseholdAdultUserIds } from "@/lib/labs/pta/households";

const expo = new Expo();

export interface PushNotificationInput {
  title: string;
  /** iOS subtitle line under the title (the notification category, e.g.
   *  "Event reminder"). Ignored by Android natively — it is also carried in
   *  `data.category` so both platforms can present it. */
  subtitle?: string | null;
  body: string;
  deepLink?: string | null;
  /** Tenant that generated this notification. Written into the payload as the
   *  authoritative `data.organizationId` the mobile client keys its
   *  tenant-isolation check off. */
  organizationId?: string | null;
  /** Notification category label (see notifications/identity.ts). */
  category?: string | null;
  /** Server-authored routing scope. `"platform"` marks a global (non-tenant)
   *  notification; its ABSENCE means org-scoped (the mobile client fails closed
   *  when an org-scoped payload has no accessible organization). Callers may not
   *  set this via `data` — only through this explicit field. */
  notificationScope?: "platform" | null;
  data?: Record<string, unknown>;
}

/**
 * Payload keys that are security-sensitive routing/identity fields. They are
 * ALWAYS written by this module from validated/explicit values, and are
 * stripped from any caller-supplied `data` first, so a caller (or a compromised
 * upstream) can never smuggle a conflicting value in through `data` — e.g. to
 * override the allow-list-validated deep link, spoof the originating
 * organization, or claim platform scope on an org-scoped notification.
 */
export const RESERVED_PUSH_DATA_KEYS = ["deepLink", "organizationId", "category", "notificationScope"] as const;

/**
 * Assemble the final `data` payload: caller data first (with every reserved key
 * stripped), then the authoritative reserved fields written LAST so they can
 * never be overridden. The deep link is allow-list validated here; a disallowed
 * link becomes `null` (neutral) rather than being trusted.
 */
export function buildPushData(notification: PushNotificationInput): Record<string, unknown> {
  const reserved = new Set<string>(RESERVED_PUSH_DATA_KEYS);
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(notification.data ?? {})) {
    if (!reserved.has(key)) safe[key] = value;
  }
  // Authoritative fields, written last.
  safe.deepLink = validateDeepLink(notification.deepLink);
  if (notification.organizationId != null) safe.organizationId = notification.organizationId;
  if (notification.category != null) safe.category = notification.category;
  if (notification.notificationScope != null) safe.notificationScope = notification.notificationScope;
  return safe;
}

/**
 * Sends a push notification to a set of Expo push tokens, chunked per
 * Expo's batching limits. Prunes tokens that come back DeviceNotRegistered
 * so we stop retrying dead devices.
 */
export async function sendPushToTokens(tokens: string[], notification: PushNotificationInput) {
  const validTokens = tokens.filter((token) => Expo.isExpoPushToken(token));
  if (validTokens.length === 0) return { sent: 0, failed: 0 };

  const data = buildPushData(notification);
  const messages: ExpoPushMessage[] = validTokens.map((token) => ({
    to: token,
    title: notification.title,
    subtitle: notification.subtitle ?? undefined,
    body: notification.body,
    sound: "default",
    data,
  }));

  let sent = 0;
  let failed = 0;
  const staleTokens: string[] = [];

  for (const chunk of expo.chunkPushNotifications(messages)) {
    try {
      const receipts = await expo.sendPushNotificationsAsync(chunk);
      receipts.forEach((receipt, index) => {
        if (receipt.status === "ok") {
          sent += 1;
        } else {
          failed += 1;
          if (receipt.details?.error === "DeviceNotRegistered") {
            staleTokens.push(chunk[index].to as string);
          }
        }
      });
    } catch (error) {
      failed += chunk.length;
      // No PII — chunk size and error message only, never a token or device identifier.
      console.error(
        JSON.stringify({
          event: "push_send_failed",
          chunkSize: chunk.length,
          error: error instanceof Error ? error.message : String(error),
        })
      );
    }
  }

  if (staleTokens.length > 0) {
    await prisma.mobileDeviceToken.deleteMany({ where: { token: { in: staleTokens } } });
  }

  return { sent, failed };
}

/**
 * Sends a push notification to a single member's registered devices and
 * logs it to CommunicationLog alongside email/SMS history. Respects the
 * member's push opt-out unless `required` is set (administrative notices
 * that must always be delivered).
 *
 * A PTA household's billing-identity OrgMember (see households.ts) never
 * carries a personal `userId` of its own — its dues/announcement push would
 * otherwise silently reach no device at all, even though every adult in the
 * household has their own registered device. When `member.userId` is null,
 * this falls back to resolving every linked household adult's userId
 * instead, and sends to all of their devices; the shared
 * commsPushEnabled/requiredNoticesOnly preference (there is no per-adult
 * preference model — see mobile-pta-parent-parity.md) still applies to all
 * of them equally. For a plain conventional member this fallback is a no-op:
 * resolvePtaHouseholdAdultUserIds() only ever returns rows for an OrgMember
 * that is genuinely a PTA household's billing identity.
 */
export async function sendPushToMember(params: {
  organizationId: string;
  memberId: string;
  title: string;
  subtitle?: string | null;
  body: string;
  deepLink?: string | null;
  category?: string | null;
  data?: Record<string, unknown>;
  required?: boolean;
}) {
  const member = await prisma.orgMember.findFirst({
    where: { id: params.memberId, organizationId: params.organizationId },
    select: { userId: true, commsPushEnabled: true, requiredNoticesOnly: true },
  });
  if (!member) return { sent: 0, failed: 0, skipped: true, reason: "Member not found" };

  const userIds = member.userId
    ? [member.userId]
    : await resolvePtaHouseholdAdultUserIds(params.organizationId, params.memberId);
  if (userIds.length === 0) return { sent: 0, failed: 0, skipped: true, reason: "No linked mobile login" };

  if (!params.required && !member.commsPushEnabled) {
    return { sent: 0, failed: 0, skipped: true, reason: "Member has opted out of push notifications" };
  }
  if (!params.required && member.requiredNoticesOnly) {
    return { sent: 0, failed: 0, skipped: true, reason: "Member opted into required notices only" };
  }

  const tokens = await prisma.mobileDeviceToken.findMany({
    where: { userId: { in: userIds } },
    select: { token: true },
  });

  const result = await sendPushToTokens(tokens.map((t) => t.token), {
    title: params.title,
    subtitle: params.subtitle,
    body: params.body,
    deepLink: params.deepLink,
    // The member lookup above is tenant-scoped, so this organizationId is the
    // authoritative originating tenant — written into the payload as such.
    organizationId: params.organizationId,
    category: params.category,
    data: params.data,
  });

  await prisma.communicationLog.create({
    data: {
      organizationId: params.organizationId,
      memberId: params.memberId,
      communicationType: "PUSH",
      direction: "OUTBOUND",
      subject: params.title,
      message: params.body,
      outcome: result.sent > 0 ? "Sent" : tokens.length === 0 ? "No registered devices" : "Failed",
      communicationDate: new Date(),
    },
  });

  return { ...result, skipped: false };
}
