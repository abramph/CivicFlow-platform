import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileMembership } from "@/lib/mobile-auth";
import { notifyNewMessageParticipants } from "@/lib/messaging";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";

const sendMessageSchema = z.object({
  organizationId: z.string().min(1),
  body: z.string().trim().min(1).max(10000),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:mobile:messages:send",
      request,
      limit: 60,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const input = await parseJsonBody(request, sendMessageSchema);
    const { organizationId: verifiedOrgId, session } = await requireMobileMembership(request, input.organizationId);
    const { id } = await params;

    const conversation = await prisma.conversation.findFirst({
      where: { id, organizationId: verifiedOrgId, participants: { some: { userId: session.userId } } },
    });
    if (!conversation) {
      return Response.json({ ok: false, error: "Conversation not found" }, { status: 404 });
    }

    const body = input.body.trim();
    const message = await prisma.message.create({
      data: { conversationId: id, organizationId: verifiedOrgId, senderUserId: session.userId, body },
    });
    await prisma.conversation.update({ where: { id }, data: { lastMessageAt: message.createdAt } });
    await prisma.conversationParticipant.updateMany({
      where: { conversationId: id, userId: session.userId },
      data: { lastReadAt: message.createdAt },
    });

    await notifyNewMessageParticipants({
      conversationId: id,
      organizationId: verifiedOrgId,
      senderUserId: session.userId,
      senderDisplayName: session.email,
      body,
    }).catch(() => null);

    return Response.json({ ok: true, data: { id: message.id, createdAt: message.createdAt } }, { status: 201 });
  });
}
