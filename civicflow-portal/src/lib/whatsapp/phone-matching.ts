import { prisma } from "@/lib/prisma";

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * OrgMember.whatsappPhoneNumber is normalized to E.164 at opt-in time (see
 * lib/phone.ts's normalizeToE164, used throughout whatsapp-service.ts), but
 * matches by digits-only anyway — same defensive approach as the SMS
 * webhook's findMembersByPhone, in case a row was ever set by a path that
 * didn't normalize. Returns organizationId alongside id since a shared/
 * reused phone number can match members across different organizations,
 * and each match needs its own org-scoped audit event.
 *
 * The `\\D` below is deliberate — a literal single-backslash '\D' inside a
 * JS/TS template literal is not a recognized escape sequence, so the parser
 * silently drops the backslash, sending Postgres the literal character `D`
 * instead of the non-digit regex metacharacter. That exact bug shipped
 * (mirrored from the pre-existing SMS webhook) and was only caught by a
 * real-database test — see whatsapp-phone-matching.integration.test.ts.
 */
export async function findMembersByWhatsAppPhone(from: string): Promise<{ id: string; organizationId: string }[]> {
  const fullDigits = digitsOnly(from);
  const last10Digits = fullDigits.slice(-10);
  return prisma.$queryRaw<{ id: string; organizationId: string }[]>`
    SELECT id, "organizationId" FROM "OrgMember"
    WHERE "whatsappPhoneNumber" IS NOT NULL
      AND regexp_replace("whatsappPhoneNumber", '\\D', '', 'g') IN (${fullDigits}, ${last10Digits})
  `;
}

export interface WhatsAppConversationSender {
  memberId: string;
  organizationId: string;
  userId: string;
}

/**
 * Resolves who a real (non-keyword) inbound WhatsApp message should be
 * attributed to for Inbox routing — deliberately narrower than
 * findMembersByWhatsAppPhone() above (which the STOP/START keyword path
 * uses and can safely fan out to every match): only currently OPTED_IN
 * members are considered, since routing a real conversation to someone who
 * has since opted out would be wrong, and only members with a linked User
 * account can be a Conversation/Message sender at all (see
 * ConversationParticipant.userId / Message.senderUserId, both required —
 * every OPTED_IN member already has one, since WhatsApp opt-in only
 * happens through the authenticated member portal).
 *
 * The same phone number can be opted into WhatsApp by different members in
 * different organizations. Resolved deterministically, not interactively:
 * prefer an org where a Conversation already exists with this member
 * (sticky — once a thread exists, later messages keep going there);
 * otherwise prefer whichever opt-in happened most recently. A documented,
 * intentional simplification over an interactive disambiguation menu for
 * what should be a rare collision.
 */
export async function resolveWhatsAppConversationSender(from: string): Promise<WhatsAppConversationSender | null> {
  const fullDigits = digitsOnly(from);
  const last10Digits = fullDigits.slice(-10);
  const matches = await prisma.$queryRaw<
    { id: string; organizationId: string; userId: string; whatsappOptedInAt: Date | null }[]
  >`
    SELECT id, "organizationId", "userId", "whatsappOptedInAt" FROM "OrgMember"
    WHERE "whatsappPhoneNumber" IS NOT NULL
      AND "whatsappOptInStatus" = 'OPTED_IN'
      AND "userId" IS NOT NULL
      AND regexp_replace("whatsappPhoneNumber", '\\D', '', 'g') IN (${fullDigits}, ${last10Digits})
  `;

  if (matches.length === 0) return null;
  if (matches.length === 1) {
    const match = matches[0];
    return { memberId: match.id, organizationId: match.organizationId, userId: match.userId };
  }

  const existingConversations = await prisma.conversation.findMany({
    where: {
      organizationId: { in: matches.map((match) => match.organizationId) },
      participants: { some: { userId: { in: matches.map((match) => match.userId) } } },
    },
    select: { organizationId: true },
  });
  const orgsWithExistingConversation = new Set(existingConversations.map((conversation) => conversation.organizationId));
  const stickyMatches = matches.filter((match) => orgsWithExistingConversation.has(match.organizationId));

  const winner =
    stickyMatches.length === 1
      ? stickyMatches[0]
      : [...matches].sort((a, b) => (b.whatsappOptedInAt?.getTime() ?? 0) - (a.whatsappOptedInAt?.getTime() ?? 0))[0];

  return { memberId: winner.id, organizationId: winner.organizationId, userId: winner.userId };
}
