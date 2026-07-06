import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/mail";
import { sendPushToMember } from "@/lib/push";

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
  const emailText = `${params.senderDisplayName} sent you a message in CivicFlow:\n\n${params.body}\n\nOpen CivicFlow to reply.`;

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
    }

    if (participant.user.email) {
      await sendEmail({ to: participant.user.email, subject, text: emailText }).catch(() => null);
    }
  }
}
