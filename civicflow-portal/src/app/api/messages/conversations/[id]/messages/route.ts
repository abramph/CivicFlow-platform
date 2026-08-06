import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { notifyNewMessageParticipants } from "@/lib/messaging";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";
import { relayReplyOverWhatsApp } from "@/lib/whatsapp/inbox-bridge";

const sendMessageSchema = z.object({
  body: z.string().trim().min(1).max(10000),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:messages:send",
      request,
      limit: 60,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session, organizationId } = await requirePermission("messages:write", "throw");
    const { id } = await params;
    const input = await parseJsonBody(request, sendMessageSchema);

    const conversation = await prisma.conversation.findFirst({
      where: { id, organizationId, participants: { some: { userId: session.userId } } },
    });
    if (!conversation) {
      return Response.json({ ok: false, error: "Conversation not found" }, { status: 404 });
    }

    const body = input.body.trim();
    const message = await prisma.message.create({
      data: { conversationId: id, organizationId, senderUserId: session.userId, body },
    });
    await prisma.conversation.update({ where: { id }, data: { lastMessageAt: message.createdAt } });
    await prisma.conversationParticipant.updateMany({
      where: { conversationId: id, userId: session.userId },
      data: { lastReadAt: message.createdAt },
    });

    await notifyNewMessageParticipants({
      conversationId: id,
      organizationId,
      senderUserId: session.userId,
      senderDisplayName: session.userEmail,
      body,
    }).catch(() => null);

    const whatsapp = await relayReplyOverWhatsApp({
      conversationId: id,
      organizationId,
      senderUserId: session.userId,
      body,
      channel: conversation.channel,
      lastInboundAt: conversation.lastInboundAt,
    }).catch(() => ({ sent: false, windowOpen: false }));

    return Response.json(
      {
        ok: true,
        data: { id: message.id, createdAt: message.createdAt, whatsappSent: whatsapp.sent, whatsappWindowOpen: whatsapp.windowOpen },
      },
      { status: 201 }
    );
  });
}
