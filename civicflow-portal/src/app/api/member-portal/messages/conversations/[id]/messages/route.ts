import { withApiErrorHandling } from "@/lib/api-route";
import { requireMemberWebSession } from "@/lib/member-web-session";
import { notifyNewMessageParticipants } from "@/lib/messaging";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  organizationId: z.string().min(1),
  body: z.string().trim().min(1).max(10000),
});

/**
 * POST /api/member-portal/messages/conversations/[id]/messages — the member
 * web portal's reply endpoint, mirroring /api/mobile/messages/conversations/[id]/messages
 * but authenticated via the member's NextAuth web session instead of a mobile
 * bearer token.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "member-portal-messages-send",
      request,
      limit: 60,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const input = await parseJsonBody(request, bodySchema);
    const { organizationId, userId } = await requireMemberWebSession(input.organizationId);
    const { id } = await params;

    const conversation = await prisma.conversation.findFirst({
      where: { id, organizationId, participants: { some: { userId } } },
    });
    if (!conversation) {
      return Response.json({ ok: false, error: "Conversation not found" }, { status: 404 });
    }

    const sender = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, displayName: true } });

    const body = input.body.trim();
    const message = await prisma.message.create({
      data: { conversationId: id, organizationId, senderUserId: userId, body },
    });
    await prisma.conversation.update({ where: { id }, data: { lastMessageAt: message.createdAt } });
    await prisma.conversationParticipant.updateMany({
      where: { conversationId: id, userId },
      data: { lastReadAt: message.createdAt },
    });

    await notifyNewMessageParticipants({
      conversationId: id,
      organizationId,
      senderUserId: userId,
      senderDisplayName: sender?.displayName ?? sender?.email ?? "A member",
      body,
    }).catch(() => null);

    return Response.json({ ok: true, data: { id: message.id, createdAt: message.createdAt } }, { status: 201 });
  });
}
