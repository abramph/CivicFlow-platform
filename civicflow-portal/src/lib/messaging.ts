import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/mail";
import { sendOrganizationMemberPush, sendOrganizationTokensPush } from "@/lib/notifications/send";
import { resolveDirectMessageSenderName } from "@/lib/notifications/identity";

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

/**
 * Notifies every other participant of a conversation about a new message.
 * Member recipients: push via the existing sendPushToMember() (which already
 * respects commsPushEnabled/requiredNoticesOnly and prunes stale device
 * tokens), falling back to email only if push wasn't actually delivered
 * (no linked mobile login, opted out, or no registered devices) and the
 * member hasn't also opted out of email. Staff recipients: email only —
 * there's no existing staff-facing push channel in this app to reuse.
 *
 * SMS is deliberately not used here — unlike an occasional campaign blast,
 * texting on every chat message could add real, unbounded per-message SMS
 * cost for a paying org.
 */
export async function notifyNewMessageParticipants(params: {
  conversationId: string;
  organizationId: string;
  senderUserId: string;
  body: string;
}) {
  const participants = await prisma.conversationParticipant.findMany({
    where: { conversationId: params.conversationId, userId: { not: params.senderUserId } },
    include: { user: { select: { email: true } } },
  });

  // Sender identity is resolved server-side from the authenticated sender's
  // tenant-scoped membership — never a caller/session-supplied string (which
  // was the sender's EMAIL). Falls back to a generic label, never an email.
  const resolvedSenderName = await resolveDirectMessageSenderName(params.organizationId, params.senderUserId);
  const senderLabel = resolvedSenderName ?? "A member";

  const preview = truncate(params.body, 140);
  const deepLink = `/messages/${params.conversationId}`;
  const subject = `New message from ${senderLabel}`;
  const emailText = `${senderLabel} sent you a message in Unestra:\n\n${params.body}\n\nOpen Unestra to reply.`;

  for (const participant of participants) {
    if (participant.role === "MEMBER") {
      const member = await prisma.orgMember.findFirst({
        where: { organizationId: params.organizationId, userId: participant.userId },
        select: { id: true, commsEmailEnabled: true },
      });
      if (member) {
        const result = await sendOrganizationMemberPush({
          organizationId: params.organizationId,
          memberId: member.id,
          category: "DIRECT_MESSAGE",
          senderUserId: params.senderUserId,
          body: preview,
          deepLink,
        });
        if (result.sent > 0) continue;
        if (member.commsEmailEnabled && participant.user.email) {
          await sendEmail({ to: participant.user.email, subject, text: emailText }).catch(() => null);
        }
        continue;
      }

      // A pure PTA household parent has no personal OrgMember at all (their
      // household's shared billing OrgMember carries no userId of its own —
      // see push.ts's doc comment on sendPushToMember), so the lookup above
      // always misses for them. Unlike the household case, we already have
      // their own userId directly here — no household indirection needed,
      // just their own registered devices. There's no per-adult push/email
      // preference model for this identity yet (see
      // mobile-pta-parent-parity.md), so this always attempts push.
      const isPtaHouseholdAdult = await prisma.ptaHouseholdAdult.findFirst({
        where: { organizationId: params.organizationId, userId: participant.userId, household: { status: "ACTIVE" } },
        select: { id: true },
      });
      if (isPtaHouseholdAdult) {
        const tokens = await prisma.mobileDeviceToken.findMany({
          where: { userId: participant.userId },
          select: { token: true },
        });
        const result = await sendOrganizationTokensPush({
          organizationId: params.organizationId,
          tokens: tokens.map((t) => t.token),
          category: "DIRECT_MESSAGE",
          senderUserId: params.senderUserId,
          body: preview,
          deepLink,
        });
        if (result.sent > 0) continue;
      }
    }

    if (participant.user.email) {
      await sendEmail({ to: participant.user.email, subject, text: emailText }).catch(() => null);
    }
  }
}
