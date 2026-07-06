import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("messages:read", "throw");
    const { id } = await params;

    const conversation = await prisma.conversation.findFirst({
      where: { id, organizationId, participants: { some: { userId: session.userId } } },
      include: {
        participants: {
          include: { user: { select: { id: true, displayName: true, email: true } } },
        },
      },
    });
    if (!conversation) {
      return Response.json({ ok: false, error: "Conversation not found" }, { status: 404 });
    }

    const messages = await prisma.message.findMany({
      where: { conversationId: id },
      include: { sender: { select: { id: true, displayName: true, email: true } } },
      orderBy: { createdAt: "asc" },
      take: 200,
    });

    await prisma.conversationParticipant.updateMany({
      where: { conversationId: id, userId: session.userId },
      data: { lastReadAt: new Date() },
    });

    return Response.json({
      ok: true,
      data: {
        id: conversation.id,
        subject: conversation.subject,
        participants: conversation.participants.map((p) => ({
          userId: p.userId,
          displayName: p.user.displayName ?? p.user.email,
          role: p.role,
        })),
        messages: messages.map((m) => ({
          id: m.id,
          body: m.body,
          senderUserId: m.senderUserId,
          senderDisplayName: m.sender.displayName ?? m.sender.email,
          createdAt: m.createdAt,
        })),
      },
    });
  });
}
