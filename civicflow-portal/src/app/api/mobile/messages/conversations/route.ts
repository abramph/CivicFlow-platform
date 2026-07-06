import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileMembership } from "@/lib/mobile-auth";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/validation";

/**
 * GET /api/mobile/messages/conversations?organizationId=...
 * Lists the caller's conversations with officers, newest first. No create
 * endpoint here — in this first cut, only staff (officers) can start a new
 * conversation; a member can reply within one they're already part of.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { organizationId: verifiedOrgId, session } = await requireMobileMembership(request, organizationId);

    const participations = await prisma.conversationParticipant.findMany({
      where: { userId: session.userId, organizationId: verifiedOrgId },
      include: {
        conversation: {
          include: {
            participants: {
              where: { userId: { not: session.userId } },
              include: { user: { select: { id: true, displayName: true, email: true } } },
            },
          },
        },
      },
      orderBy: { conversation: { lastMessageAt: "desc" } },
      take: 100,
    });

    const data = participations
      .filter((participation) => participation.conversation)
      .map((participation) => {
        const conversation = participation.conversation;
        const hasUnread = Boolean(
          conversation.lastMessageAt &&
            (!participation.lastReadAt || conversation.lastMessageAt > participation.lastReadAt)
        );
        return {
          id: conversation.id,
          subject: conversation.subject,
          lastMessageAt: conversation.lastMessageAt,
          hasUnread,
          otherParticipants: conversation.participants.map((p) => ({
            userId: p.userId,
            displayName: p.user.displayName ?? p.user.email,
            role: p.role,
          })),
        };
      });

    return Response.json({ ok: true, data });
  });
}
