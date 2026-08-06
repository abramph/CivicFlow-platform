import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Real-database test for resolveWhatsAppConversationSender()'s tie-break
 * logic — deliberately NOT using a mocked Prisma client, mirroring
 * whatsapp-phone-matching.integration.test.ts's structure and skip
 * convention. The tie-break (prefer an org with an existing Conversation,
 * else the most recently opted-in member) depends on raw-SQL digit matching
 * plus real timestamp ordering across two OrgMember rows in two different
 * organizations — exactly the kind of thing a mocked $queryRaw can't prove
 * actually works against real Postgres.
 *
 * Skipped by default (no live DB in a normal `vitest run`) — run with:
 *   DATABASE_URL="postgresql://postgres@localhost:5433/civicflow_dev" \
 *   HOA_RUN_DB_INTEGRATION_TEST=1 \
 *     npx vitest run src/lib/__tests__/whatsapp-conversation-sender.integration.test.ts
 * Never point this at a shared or production database; it creates and
 * deletes real rows.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN_INTEGRATION = Boolean(DATABASE_URL) && process.env.HOA_RUN_DB_INTEGRATION_TEST === "1";

describe.skipIf(!RUN_INTEGRATION)("resolveWhatsAppConversationSender — real tie-break", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let orgAId: string;
  let orgBId: string;
  const userIds: string[] = [];

  // OrgMember has a unique (organizationId, userId) constraint, so every
  // member created in these tests needs its own User row — reusing one
  // User across multiple OrgMembers in the same org would collide.
  async function createUser(label: string): Promise<string> {
    const user = await prisma.user.create({
      data: { email: `whatsapp-tiebreak-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`, passwordHash: "test-hash-not-real" },
    });
    userIds.push(user.id);
    return user.id;
  }

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();

    const stamp = Date.now();
    const orgA = await prisma.organization.create({
      data: { slug: `whatsapp-tiebreak-a-${stamp}`, name: "WhatsApp Tiebreak Org A", primaryVertical: "COMMUNITY" },
    });
    const orgB = await prisma.organization.create({
      data: { slug: `whatsapp-tiebreak-b-${stamp}`, name: "WhatsApp Tiebreak Org B", primaryVertical: "COMMUNITY" },
    });
    orgAId = orgA.id;
    orgBId = orgB.id;
  });

  afterAll(async () => {
    await prisma?.message.deleteMany({ where: { organizationId: { in: [orgAId, orgBId] } } }).catch(() => {});
    await prisma?.conversationParticipant.deleteMany({ where: { organizationId: { in: [orgAId, orgBId] } } }).catch(() => {});
    await prisma?.conversation.deleteMany({ where: { organizationId: { in: [orgAId, orgBId] } } }).catch(() => {});
    await prisma?.orgMember.deleteMany({ where: { organizationId: { in: [orgAId, orgBId] } } }).catch(() => {});
    await prisma?.organization.deleteMany({ where: { id: { in: [orgAId, orgBId] } } }).catch(() => {});
    await prisma?.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {});
    await prisma?.$disconnect();
  });

  it("returns the single OPTED_IN match when only one org has this phone", async () => {
    const { resolveWhatsAppConversationSender } = await import("@/lib/whatsapp/phone-matching");

    const userAId = await createUser("solo");
    const member = await prisma.orgMember.create({
      data: {
        organizationId: orgAId,
        userId: userAId,
        firstName: "Solo",
        lastName: "Match",
        whatsappPhoneNumber: "+15551110000",
        whatsappOptInStatus: "OPTED_IN",
      },
    });

    const sender = await resolveWhatsAppConversationSender("+15551110000");

    expect(sender).not.toBeNull();
    expect(sender?.memberId).toBe(member.id);
    expect(sender?.organizationId).toBe(orgAId);
    expect(sender?.userId).toBe(userAId);
  });

  it("excludes an OPTED_OUT member even if the phone number matches", async () => {
    const { resolveWhatsAppConversationSender } = await import("@/lib/whatsapp/phone-matching");

    const userId = await createUser("opted-out");
    await prisma.orgMember.create({
      data: {
        organizationId: orgAId,
        userId,
        firstName: "Opted",
        lastName: "Out",
        whatsappPhoneNumber: "+15552220000",
        whatsappOptInStatus: "OPTED_OUT",
      },
    });

    const sender = await resolveWhatsAppConversationSender("+15552220000");

    expect(sender).toBeNull();
  });

  it("prefers the org with an existing Conversation when the same phone is opted in across two orgs", async () => {
    const { resolveWhatsAppConversationSender } = await import("@/lib/whatsapp/phone-matching");

    const sharedPhone = "+15553330000";
    const userAId = await createUser("sticky-a");
    const userBId = await createUser("sticky-b");
    const memberA = await prisma.orgMember.create({
      data: {
        organizationId: orgAId,
        userId: userAId,
        firstName: "Sticky",
        lastName: "OrgA",
        whatsappPhoneNumber: sharedPhone,
        whatsappOptInStatus: "OPTED_IN",
        whatsappOptedInAt: new Date("2026-01-01T00:00:00Z"),
      },
    });
    await prisma.orgMember.create({
      data: {
        organizationId: orgBId,
        userId: userBId,
        firstName: "Newer",
        lastName: "OrgB",
        whatsappPhoneNumber: sharedPhone,
        whatsappOptInStatus: "OPTED_IN",
        whatsappOptedInAt: new Date("2026-06-01T00:00:00Z"),
      },
    });

    // Org A already has an existing Conversation with this member — even
    // though org B opted in more recently, the sticky rule must win.
    await prisma.conversation.create({
      data: {
        organizationId: orgAId,
        channel: "WHATSAPP",
        subject: "WhatsApp",
        participants: { create: [{ organizationId: orgAId, userId: userAId, role: "MEMBER" }] },
      },
    });

    const sender = await resolveWhatsAppConversationSender(sharedPhone);

    expect(sender?.memberId).toBe(memberA.id);
    expect(sender?.organizationId).toBe(orgAId);
  });

  it("falls back to the most recently opted-in member when neither org has an existing Conversation", async () => {
    const { resolveWhatsAppConversationSender } = await import("@/lib/whatsapp/phone-matching");

    const sharedPhone = "+15554440000";
    const userAId = await createUser("fallback-a");
    const userBId = await createUser("fallback-b");
    await prisma.orgMember.create({
      data: {
        organizationId: orgAId,
        userId: userAId,
        firstName: "Older",
        lastName: "OptIn",
        whatsappPhoneNumber: sharedPhone,
        whatsappOptInStatus: "OPTED_IN",
        whatsappOptedInAt: new Date("2026-01-01T00:00:00Z"),
      },
    });
    const memberB = await prisma.orgMember.create({
      data: {
        organizationId: orgBId,
        userId: userBId,
        firstName: "Newer",
        lastName: "OptIn",
        whatsappPhoneNumber: sharedPhone,
        whatsappOptInStatus: "OPTED_IN",
        whatsappOptedInAt: new Date("2026-06-01T00:00:00Z"),
      },
    });

    const sender = await resolveWhatsAppConversationSender(sharedPhone);

    expect(sender?.memberId).toBe(memberB.id);
    expect(sender?.organizationId).toBe(orgBId);
  });
});
