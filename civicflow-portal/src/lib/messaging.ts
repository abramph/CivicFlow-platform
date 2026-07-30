import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/mail";
import { sendPushToMember, sendPushToTokens } from "@/lib/push";

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
  senderDisplayName: string;
  body: string;
}) {
  const participants = await prisma.conversationParticipant.findMany({
    where: { conversationId: params.conversationId, userId: { not: params.senderUserId } },
    include: { user: { select: { email: true } } },
  });

  const preview = truncate(params.body, 140);
  const deepLink = `/messages/${params.conversationId}`;
  const subject = `New message from ${params.senderDisplayName}`;
  const emailText = `${params.senderDisplayName} sent you a message in Unestra:\n\n${params.body}\n\nOpen Unestra to reply.`;

  for (const participant of participants) {
    if (participant.role === "MEMBER") {
      const member = await prisma.orgMember.findFirst({
        where: { organizationId: params.organizationId, userId: participant.userId },
        select: { id: true, commsEmailEnabled: true },
      });
      if (member) {
        const result = await sendPushToMember({
          organizationId: params.organizationId,
          memberId: member.id,
          title: subject,
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
        const result = await sendPushToTokens(tokens.map((t) => t.token), { title: subject, body: preview, deepLink });
        if (result.sent > 0) continue;
      }
    }

    if (participant.user.email) {
      await sendEmail({ to: participant.user.email, subject, text: emailText }).catch(() => null);
    }
  }
}
