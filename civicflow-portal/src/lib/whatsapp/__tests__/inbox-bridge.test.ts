import { beforeEach, describe, expect, it, vi } from "vitest";

const { FakeP2002Error } = vi.hoisted(() => {
  class FakeP2002Error extends Error {
    code = "P2002";
  }
  return { FakeP2002Error };
});

vi.mock("@prisma/client", () => ({
  Prisma: {
    PrismaClientKnownRequestError: FakeP2002Error,
  },
}));

const findFirstConversation = vi.fn();
const createConversation = vi.fn();
const createMessage = vi.fn();
const updateConversation = vi.fn();
const findManyOrganizationMembership = vi.fn();
const findUniqueConversationParticipant = vi.fn();
const findFirstConversationParticipant = vi.fn();
const findFirstOrgMember = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: {
      findFirst: (...args: unknown[]) => findFirstConversation(...args),
      create: (...args: unknown[]) => createConversation(...args),
      update: (...args: unknown[]) => updateConversation(...args),
    },
    message: {
      create: (...args: unknown[]) => createMessage(...args),
    },
    organizationMembership: {
      findMany: (...args: unknown[]) => findManyOrganizationMembership(...args),
    },
    conversationParticipant: {
      findUnique: (...args: unknown[]) => findUniqueConversationParticipant(...args),
      findFirst: (...args: unknown[]) => findFirstConversationParticipant(...args),
    },
    orgMember: {
      findFirst: (...args: unknown[]) => findFirstOrgMember(...args),
    },
  },
}));

const getEffectivePermissions = vi.fn();
vi.mock("@/lib/role-permissions", () => ({
  getEffectivePermissions: (...args: unknown[]) => getEffectivePermissions(...args),
}));

const resolveWhatsAppConversationSender = vi.fn();
vi.mock("@/lib/whatsapp/phone-matching", () => ({
  resolveWhatsAppConversationSender: (...args: unknown[]) => resolveWhatsAppConversationSender(...args),
}));

const sendMemberWhatsApp = vi.fn();
vi.mock("@/lib/whatsapp/whatsapp-service", () => ({
  sendMemberWhatsApp: (...args: unknown[]) => sendMemberWhatsApp(...args),
}));

import { bridgeInboundWhatsAppMessage, relayReplyOverWhatsApp } from "@/lib/whatsapp/inbox-bridge";

describe("bridgeInboundWhatsAppMessage", () => {
  beforeEach(() => {
    findFirstConversation.mockReset();
    createConversation.mockReset();
    createMessage.mockReset();
    updateConversation.mockReset();
    findManyOrganizationMembership.mockReset();
    getEffectivePermissions.mockReset();
    resolveWhatsAppConversationSender.mockReset();
  });

  it("returns null with no side effects when there's no OPTED_IN sender", async () => {
    resolveWhatsAppConversationSender.mockResolvedValue(null);

    const result = await bridgeInboundWhatsAppMessage({ from: "+15550000000", body: "hi", messageSid: "SM1" });

    expect(result).toBeNull();
    expect(findFirstConversation).not.toHaveBeenCalled();
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("creates a new WhatsApp Conversation with all messages:write staff plus the member when none exists", async () => {
    resolveWhatsAppConversationSender.mockResolvedValue({ memberId: "member-1", organizationId: "org-1", userId: "user-member" });
    findFirstConversation.mockResolvedValue(null);
    findManyOrganizationMembership.mockResolvedValue([
      { userId: "user-staff-1", role: "admin" },
      { userId: "user-staff-2", role: "readonly" },
    ]);
    getEffectivePermissions.mockImplementation(async (_orgId: string, role: string) =>
      role === "admin" ? ["messages:write"] : []
    );
    createConversation.mockResolvedValue({ id: "conversation-1" });
    createMessage.mockResolvedValue({ id: "message-1" });
    updateConversation.mockResolvedValue({});

    const result = await bridgeInboundWhatsAppMessage({ from: "+15551234567", body: "Hello there", messageSid: "SM123" });

    expect(result).toEqual({ conversationId: "conversation-1" });
    expect(createConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-1",
          channel: "WHATSAPP",
          participants: {
            create: [
              { organizationId: "org-1", userId: "user-staff-1", role: "STAFF" },
              { organizationId: "org-1", userId: "user-member", role: "MEMBER" },
            ],
          },
        }),
      })
    );
    expect(createMessage).toHaveBeenCalledWith({
      data: {
        conversationId: "conversation-1",
        organizationId: "org-1",
        senderUserId: "user-member",
        body: "Hello there",
        channel: "WHATSAPP",
        externalId: "SM123",
      },
    });
    expect(updateConversation).toHaveBeenCalledWith({
      where: { id: "conversation-1" },
      data: { lastMessageAt: expect.any(Date), lastInboundAt: expect.any(Date) },
    });
  });

  it("reuses an existing WhatsApp Conversation for the same member instead of creating a new one", async () => {
    resolveWhatsAppConversationSender.mockResolvedValue({ memberId: "member-1", organizationId: "org-1", userId: "user-member" });
    findFirstConversation.mockResolvedValue({ id: "existing-conversation" });
    createMessage.mockResolvedValue({ id: "message-1" });
    updateConversation.mockResolvedValue({});

    const result = await bridgeInboundWhatsAppMessage({ from: "+15551234567", body: "Second message", messageSid: "SM456" });

    expect(result).toEqual({ conversationId: "existing-conversation" });
    expect(createConversation).not.toHaveBeenCalled();
    expect(findManyOrganizationMembership).not.toHaveBeenCalled();
  });

  it("treats a duplicate externalId (P2002) as already-processed, returning the conversation instead of throwing", async () => {
    resolveWhatsAppConversationSender.mockResolvedValue({ memberId: "member-1", organizationId: "org-1", userId: "user-member" });
    findFirstConversation.mockResolvedValue({ id: "existing-conversation" });
    createMessage.mockRejectedValue(new FakeP2002Error("duplicate"));

    const result = await bridgeInboundWhatsAppMessage({ from: "+15551234567", body: "Retried delivery", messageSid: "SM456" });

    expect(result).toEqual({ conversationId: "existing-conversation" });
    expect(updateConversation).not.toHaveBeenCalled();
  });

  it("re-throws a non-unique-constraint error from message creation", async () => {
    resolveWhatsAppConversationSender.mockResolvedValue({ memberId: "member-1", organizationId: "org-1", userId: "user-member" });
    findFirstConversation.mockResolvedValue({ id: "existing-conversation" });
    createMessage.mockRejectedValue(new Error("connection lost"));

    await expect(bridgeInboundWhatsAppMessage({ from: "+15551234567", body: "x", messageSid: "SM789" })).rejects.toThrow(
      "connection lost"
    );
  });
});

describe("relayReplyOverWhatsApp", () => {
  beforeEach(() => {
    findUniqueConversationParticipant.mockReset();
    findFirstConversationParticipant.mockReset();
    findFirstOrgMember.mockReset();
    sendMemberWhatsApp.mockReset();
  });

  function baseParams(overrides: Partial<Parameters<typeof relayReplyOverWhatsApp>[0]> = {}) {
    return {
      conversationId: "conversation-1",
      organizationId: "org-1",
      senderUserId: "user-staff-1",
      body: "Reply text",
      channel: "WHATSAPP" as string | null,
      lastInboundAt: new Date(),
      ...overrides,
    };
  }

  it("does nothing for a non-WhatsApp conversation", async () => {
    const result = await relayReplyOverWhatsApp(baseParams({ channel: null }));
    expect(result).toEqual({ sent: false, windowOpen: false });
    expect(findUniqueConversationParticipant).not.toHaveBeenCalled();
  });

  it("does nothing when the sender is the member, not staff", async () => {
    findUniqueConversationParticipant.mockResolvedValue({ role: "MEMBER" });
    const result = await relayReplyOverWhatsApp(baseParams());
    expect(result).toEqual({ sent: false, windowOpen: false });
    expect(sendMemberWhatsApp).not.toHaveBeenCalled();
  });

  it("does not send and reports the window as closed once lastInboundAt is more than 24h old", async () => {
    findUniqueConversationParticipant.mockResolvedValue({ role: "STAFF" });
    const staleDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const result = await relayReplyOverWhatsApp(baseParams({ lastInboundAt: staleDate }));
    expect(result).toEqual({ sent: false, windowOpen: false });
    expect(sendMemberWhatsApp).not.toHaveBeenCalled();
  });

  it("does not send when lastInboundAt is null (never received an inbound message)", async () => {
    findUniqueConversationParticipant.mockResolvedValue({ role: "STAFF" });
    const result = await relayReplyOverWhatsApp(baseParams({ lastInboundAt: null }));
    expect(result).toEqual({ sent: false, windowOpen: false });
  });

  it("sends a freeform WhatsApp reply when staff replies within the open window", async () => {
    findUniqueConversationParticipant.mockResolvedValue({ role: "STAFF" });
    findFirstConversationParticipant.mockResolvedValue({ userId: "user-member" });
    findFirstOrgMember.mockResolvedValue({ id: "member-1", whatsappPhoneNumber: "+15551234567" });
    sendMemberWhatsApp.mockResolvedValue({ status: "SENT" });

    const result = await relayReplyOverWhatsApp(baseParams());

    expect(result).toEqual({ sent: true, windowOpen: true });
    expect(sendMemberWhatsApp).toHaveBeenCalledWith({
      organizationId: "org-1",
      memberId: "member-1",
      phone: "+15551234567",
      sentById: "user-staff-1",
      required: true,
      body: "Reply text",
    });
  });

  it("reports windowOpen true but sent false when the underlying WhatsApp send fails", async () => {
    findUniqueConversationParticipant.mockResolvedValue({ role: "STAFF" });
    findFirstConversationParticipant.mockResolvedValue({ userId: "user-member" });
    findFirstOrgMember.mockResolvedValue({ id: "member-1", whatsappPhoneNumber: "+15551234567" });
    sendMemberWhatsApp.mockResolvedValue({ status: "FAILED" });

    const result = await relayReplyOverWhatsApp(baseParams());

    expect(result).toEqual({ sent: false, windowOpen: true });
  });

  it("skips sending when the member participant has no stored WhatsApp phone number", async () => {
    findUniqueConversationParticipant.mockResolvedValue({ role: "STAFF" });
    findFirstConversationParticipant.mockResolvedValue({ userId: "user-member" });
    findFirstOrgMember.mockResolvedValue(null);

    const result = await relayReplyOverWhatsApp(baseParams());

    expect(result).toEqual({ sent: false, windowOpen: true });
    expect(sendMemberWhatsApp).not.toHaveBeenCalled();
  });
});
