import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { notifyNewMessageParticipants } from "@/lib/messaging";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z, ValidationError } from "@/lib/validation";

const createConversationSchema = z.object({
  memberId: z.string().min(1),
  subject: z.union([z.string().trim().max(200), z.literal(""), z.null()]).optional(),
  body: z.string().trim().min(1).max(10000),
});

export async function GET() {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("messages:read", "throw");

    const participations = await prisma.conversationParticipant.findMany({
      where: { userId: session.userId, organizationId },
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
          channel: conversation.channel,
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

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:messages:create",
      request,
      limit: 20,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session, organizationId } = await requirePermission("messages:write", "throw");
    const input = await parseJsonBody(request, createConversationSchema);

    const member = await prisma.orgMember.findFirst({
      where: { id: input.memberId, organizationId },
      select: { id: true, userId: true, firstName: true, lastName: true },
    });
    if (!member) {
      throw new ValidationError("Member not found.");
    }
    if (!member.userId) {
      throw new ValidationError("This member doesn't have app access yet — send them an invite before messaging them in-app.");
    }
    if (member.userId === session.userId) {
      // A staff account can also be the OrgMember it's messaging (e.g. an
      // owner who is also a member of their own org) — ConversationParticipant
      // has a unique (conversationId, userId) constraint, so this would
      // otherwise crash trying to insert the same user as both participants.
      throw new ValidationError("You can't start a conversation with yourself.");
    }

    const subject = input.subject?.trim() || null;

    const conversation = await prisma.$transaction(async (tx) => {
      const created = await tx.conversation.create({
        data: {
          organizationId,
          subject,
          createdByUserId: session.userId,
          lastMessageAt: new Date(),
        },
      });
      await tx.conversationParticipant.createMany({
        data: [
          { conversationId: created.id, organizationId, userId: session.userId, role: "STAFF" },
          { conversationId: created.id, organizationId, userId: member.userId as string, role: "MEMBER" },
        ],
      });
      await tx.message.create({
        data: {
          conversationId: created.id,
          organizationId,
          senderUserId: session.userId,
          body: input.body.trim(),
        },
      });
      return created;
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "conversation.create",
      entityType: "conversation",
      entityId: conversation.id,
      metadata: { memberId: member.id },
    });

    await notifyNewMessageParticipants({
      conversationId: conversation.id,
      organizationId,
      senderUserId: session.userId,
      senderDisplayName: session.userEmail,
      body: input.body.trim(),
    }).catch(() => null);

    return Response.json({ ok: true, data: { id: conversation.id } }, { status: 201 });
  });
}
