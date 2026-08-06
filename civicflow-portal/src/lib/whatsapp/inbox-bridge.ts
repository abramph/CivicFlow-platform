import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS, type Role } from "@/lib/rbac";
import { getEffectivePermissions } from "@/lib/role-permissions";
import { resolveWhatsAppConversationSender } from "@/lib/whatsapp/phone-matching";
import { sendMemberWhatsApp } from "@/lib/whatsapp/whatsapp-service";

const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Every active staff membership whose role currently resolves to
 * messages:write in this org (accounting for per-org custom role
 * permission overrides via getEffectivePermissions(), not just the
 * hardcoded default). Auto-added as Conversation participants on a new
 * WhatsApp-initiated thread — today's Inbox is a personal inbox (you only
 * see conversations you're a participant of), so this is how the thread
 * becomes visible to any eligible staff member without a new "unassigned
 * queue" UI.
 */
async function getStaffUserIdsWithMessagesWrite(organizationId: string): Promise<string[]> {
  const memberships = await prisma.organizationMembership.findMany({
    where: { organizationId, status: "active" },
    select: { userId: true, role: true },
  });

  const roles = [...new Set(memberships.map((membership) => membership.role))];
  const permittedRoles = new Set<string>();
  for (const role of roles) {
    const permissions = await getEffectivePermissions(organizationId, role as Role);
    if (permissions.includes(PERMISSIONS.MESSAGES_WRITE)) permittedRoles.add(role);
  }

  return memberships.filter((membership) => permittedRoles.has(membership.role)).map((membership) => membership.userId);
}

export interface BridgeInboundWhatsAppMessageInput {
  /** E.164, no "whatsapp:" prefix. */
  from: string;
  body: string;
  /** Twilio's MessageSid — stored as Message.externalId for idempotency. */
  messageSid: string;
}

/**
 * Bridges a real (non-keyword) inbound WhatsApp message into the existing
 * in-app Inbox. Finds-or-creates a Conversation for the resolved (org,
 * member) pair and posts the Message using the existing, unmodified
 * Conversation/Message tables — see resolveWhatsAppConversationSender()'s
 * doc comment for why no schema change to sender identity was needed.
 *
 * Idempotent via Message.externalId's unique constraint: a duplicate
 * webhook delivery for the same MessageSid hits P2002, which is caught and
 * treated as already-processed rather than an error — the same
 * compare-and-swap shape other unique-constraint-based dedupe in this
 * codebase already uses (see src/lib/hoa/violations.ts).
 *
 * Returns null when there's no OPTED_IN member to attribute the message
 * to — mirrors the existing "do nothing" behavior for an unmatched
 * STOP/START reply in the webhook route.
 */
export async function bridgeInboundWhatsAppMessage(
  input: BridgeInboundWhatsAppMessageInput
): Promise<{ conversationId: string } | null> {
  const sender = await resolveWhatsAppConversationSender(input.from);
  if (!sender) return null;

  let conversation = await prisma.conversation.findFirst({
    where: {
      organizationId: sender.organizationId,
      channel: "WHATSAPP",
      participants: { some: { userId: sender.userId } },
    },
    select: { id: true },
  });

  if (!conversation) {
    const staffUserIds = await getStaffUserIdsWithMessagesWrite(sender.organizationId);
    const participantUserIds = [...new Set([...staffUserIds, sender.userId])];
    conversation = await prisma.conversation.create({
      data: {
        organizationId: sender.organizationId,
        channel: "WHATSAPP",
        subject: "WhatsApp",
        participants: {
          create: participantUserIds.map((userId) => ({
            organizationId: sender.organizationId,
            userId,
            role: userId === sender.userId ? "MEMBER" : "STAFF",
          })),
        },
      },
      select: { id: true },
    });
  }

  const now = new Date();
  try {
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        organizationId: sender.organizationId,
        senderUserId: sender.userId,
        body: input.body,
        channel: "WHATSAPP",
        externalId: input.messageSid,
      },
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      return { conversationId: conversation.id };
    }
    throw error;
  }

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: now, lastInboundAt: now },
  });

  return { conversationId: conversation.id };
}

export interface RelayReplyOverWhatsAppInput {
  conversationId: string;
  organizationId: string;
  senderUserId: string;
  body: string;
  channel: string | null;
  lastInboundAt: Date | null;
}

/**
 * Sends a staff reply back out over WhatsApp when the thread is
 * WhatsApp-sourced, the sender is staff (not the member replying to their
 * own thread — that inbound leg is handled entirely by the Twilio webhook),
 * and the customer-service window (lastInboundAt + 24h) is still open.
 * Freeform body, not a template — sendMemberWhatsApp() already supports
 * that for exactly this case. Shared by the desktop and mobile reply
 * routes (the member-portal reply route never needs this: a member is
 * always ConversationParticipant.role "MEMBER", never "STAFF", so the role
 * check below would always no-op there).
 *
 * Never throws — the caller should still treat the in-app message as sent
 * even if this fails; a WhatsApp delivery failure must not corrupt the
 * message that was already saved (see program's own non-negotiable rule
 * that failed WhatsApp delivery must never corrupt other workflows).
 */
export async function relayReplyOverWhatsApp(
  params: RelayReplyOverWhatsAppInput
): Promise<{ sent: boolean; windowOpen: boolean }> {
  if (params.channel !== "WHATSAPP") {
    return { sent: false, windowOpen: false };
  }

  const senderParticipant = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId: params.conversationId, userId: params.senderUserId } },
    select: { role: true },
  });
  if (senderParticipant?.role !== "STAFF") {
    return { sent: false, windowOpen: false };
  }

  const windowOpen = Boolean(params.lastInboundAt) && Date.now() - params.lastInboundAt!.getTime() < WHATSAPP_WINDOW_MS;
  if (!windowOpen) {
    return { sent: false, windowOpen: false };
  }

  const memberParticipant = await prisma.conversationParticipant.findFirst({
    where: { conversationId: params.conversationId, role: "MEMBER" },
    select: { userId: true },
  });
  if (!memberParticipant) {
    return { sent: false, windowOpen: true };
  }

  const member = await prisma.orgMember.findFirst({
    where: { organizationId: params.organizationId, userId: memberParticipant.userId, whatsappPhoneNumber: { not: null } },
    select: { id: true, whatsappPhoneNumber: true },
  });
  if (!member?.whatsappPhoneNumber) {
    return { sent: false, windowOpen: true };
  }

  const result = await sendMemberWhatsApp({
    organizationId: params.organizationId,
    memberId: member.id,
    phone: member.whatsappPhoneNumber,
    sentById: params.senderUserId,
    required: true,
    body: params.body,
  });

  return { sent: result.status === "SENT", windowOpen: true };
}
