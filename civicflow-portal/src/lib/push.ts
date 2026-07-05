import { Expo, type ExpoPushMessage } from "expo-server-sdk";
import { prisma } from "@/lib/prisma";
import { validateDeepLink } from "@/lib/deep-links";

const expo = new Expo();

export interface PushNotificationInput {
  title: string;
  body: string;
  deepLink?: string | null;
  data?: Record<string, unknown>;
}

/**
 * Sends a push notification to a set of Expo push tokens, chunked per
 * Expo's batching limits. Prunes tokens that come back DeviceNotRegistered
 * so we stop retrying dead devices.
 */
export async function sendPushToTokens(tokens: string[], notification: PushNotificationInput) {
  const validTokens = tokens.filter((token) => Expo.isExpoPushToken(token));
  if (validTokens.length === 0) return { sent: 0, failed: 0 };

  const deepLink = validateDeepLink(notification.deepLink);
  const messages: ExpoPushMessage[] = validTokens.map((token) => ({
    to: token,
    title: notification.title,
    body: notification.body,
    sound: "default",
    data: { deepLink, ...notification.data },
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
    } catch {
      failed += chunk.length;
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
 */
export async function sendPushToMember(params: {
  organizationId: string;
  memberId: string;
  title: string;
  body: string;
  deepLink?: string | null;
  required?: boolean;
}) {
  const member = await prisma.orgMember.findFirst({
    where: { id: params.memberId, organizationId: params.organizationId },
    select: { userId: true, commsPushEnabled: true, requiredNoticesOnly: true },
  });
  if (!member?.userId) return { sent: 0, failed: 0, skipped: true, reason: "No linked mobile login" };
  if (!params.required && !member.commsPushEnabled) {
    return { sent: 0, failed: 0, skipped: true, reason: "Member has opted out of push notifications" };
  }
  if (!params.required && member.requiredNoticesOnly) {
    return { sent: 0, failed: 0, skipped: true, reason: "Member opted into required notices only" };
  }

  const tokens = await prisma.mobileDeviceToken.findMany({
    where: { userId: member.userId },
    select: { token: true },
  });

  const result = await sendPushToTokens(
    tokens.map((t) => t.token),
    { title: params.title, body: params.body, deepLink: params.deepLink }
  );

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
