import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return {
    ...actual,
    requirePermission: vi.fn().mockResolvedValue({
      session: { userId: "officer-1", userEmail: "officer@example.com" },
      organizationId: "org-a",
      role: "ORG_ADMIN",
      can: (permission: string) => ["messages:read", "messages:write"].includes(permission),
    }),
  };
});

const findManyParticipant = vi.fn();
const findFirstConversation = vi.fn();
const findManyMessage = vi.fn().mockResolvedValue([]);
const createMessage = vi.fn();
const updateConversation = vi.fn().mockResolvedValue(undefined);
const updateManyParticipant = vi.fn().mockResolvedValue(undefined);
const findFirstOrgMember = vi.fn();
const transaction = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversationParticipant: {
      findMany: (...args: unknown[]) => findManyParticipant(...args),
      updateMany: (...args: unknown[]) => updateManyParticipant(...args),
    },
    conversation: {
      findFirst: (...args: unknown[]) => findFirstConversation(...args),
      update: (...args: unknown[]) => updateConversation(...args),
    },
    message: {
      findMany: (...args: unknown[]) => findManyMessage(...args),
      create: (...args: unknown[]) => createMessage(...args),
    },
    orgMember: {
      findFirst: (...args: unknown[]) => findFirstOrgMember(...args),
    },
    $transaction: (...args: unknown[]) => transaction(...args),
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

const notifyNewMessageParticipants = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/messaging", () => ({
  notifyNewMessageParticipants: (...args: unknown[]) => notifyNewMessageParticipants(...args),
}));

const relayReplyOverWhatsApp = vi.fn().mockResolvedValue({ sent: false, windowOpen: false });
vi.mock("@/lib/whatsapp/inbox-bridge", () => ({
  relayReplyOverWhatsApp: (...args: unknown[]) => relayReplyOverWhatsApp(...args),
}));

import { GET as listGET, POST as createPOST } from "@/app/api/messages/conversations/route";
import { GET as detailGET } from "@/app/api/messages/conversations/[id]/route";
import { POST as replyPOST } from "@/app/api/messages/conversations/[id]/messages/route";

function jsonRequest(url: string, body: unknown) {
  return new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

describe("GET /api/messages/conversations", () => {
  beforeEach(() => {
    findManyParticipant.mockReset();
  });

  it("only returns conversations the caller participates in, scoped to their own org", async () => {
    findManyParticipant.mockResolvedValueOnce([]);
    await listGET();
    expect(findManyParticipant).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "officer-1", organizationId: "org-a" } })
    );
  });
});

describe("POST /api/messages/conversations", () => {
  beforeEach(() => {
    findFirstOrgMember.mockReset();
    transaction.mockReset();
    notifyNewMessageParticipants.mockClear();
  });

  it("rejects messaging a member from a different organization (tenant isolation)", async () => {
    findFirstOrgMember.mockResolvedValueOnce(null); // findFirst({ id, organizationId: "org-a" }) finds nothing for a cross-org id

    const response = await createPOST(
      jsonRequest("https://portal.test/api/messages/conversations", { memberId: "member-in-org-b", body: "Hi" })
    );

    expect(response.status).toBe(400);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rejects messaging a member with no linked app account", async () => {
    findFirstOrgMember.mockResolvedValueOnce({ id: "member-1", userId: null, firstName: "Jane", lastName: "Doe" });

    const response = await createPOST(
      jsonRequest("https://portal.test/api/messages/conversations", { memberId: "member-1", body: "Hi" })
    );

    expect(response.status).toBe(400);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rejects starting a conversation with yourself when the caller's own User is linked to that OrgMember", async () => {
    // Regression test: an officer's account can also be the linked User of an
    // OrgMember in the same org (e.g. an owner who is also a member).
    // ConversationParticipant has a unique (conversationId, userId) constraint,
    // so creating both participants with the same userId previously crashed
    // with a raw 500 instead of a clean validation error.
    findFirstOrgMember.mockResolvedValueOnce({ id: "member-1", userId: "officer-1", firstName: "Officer", lastName: "Self" });

    const response = await createPOST(
      jsonRequest("https://portal.test/api/messages/conversations", { memberId: "member-1", body: "Hi" })
    );

    expect(response.status).toBe(400);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("creates the conversation and notifies the member on success", async () => {
    findFirstOrgMember.mockResolvedValueOnce({ id: "member-1", userId: "member-user-1", firstName: "Jane", lastName: "Doe" });
    transaction.mockResolvedValueOnce({ id: "conv-1" });

    const response = await createPOST(
      jsonRequest("https://portal.test/api/messages/conversations", { memberId: "member-1", body: "Hi Jane" })
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.id).toBe("conv-1");
    expect(notifyNewMessageParticipants).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "conv-1", organizationId: "org-a" })
    );
  });
});

describe("GET /api/messages/conversations/[id]", () => {
  beforeEach(() => {
    findFirstConversation.mockReset();
    updateManyParticipant.mockClear();
  });

  it("404s for a conversation the caller is not a participant of (including cross-org guesses)", async () => {
    findFirstConversation.mockResolvedValueOnce(null);

    const response = await detailGET(
      new Request("https://portal.test/api/messages/conversations/conv-in-org-b"),
      { params: Promise.resolve({ id: "conv-in-org-b" }) }
    );

    expect(response.status).toBe(404);
    expect(findFirstConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "conv-in-org-b", organizationId: "org-a", participants: { some: { userId: "officer-1" } } },
      })
    );
    expect(updateManyParticipant).not.toHaveBeenCalled();
  });

  it("marks the caller's participant row as read on a successful fetch", async () => {
    findFirstConversation.mockResolvedValueOnce({ id: "conv-1", subject: null, participants: [] });

    const response = await detailGET(
      new Request("https://portal.test/api/messages/conversations/conv-1"),
      { params: Promise.resolve({ id: "conv-1" }) }
    );

    expect(response.status).toBe(200);
    expect(updateManyParticipant).toHaveBeenCalledWith({
      where: { conversationId: "conv-1", userId: "officer-1" },
      data: { lastReadAt: expect.any(Date) },
    });
  });
});

describe("POST /api/messages/conversations/[id]/messages", () => {
  beforeEach(() => {
    findFirstConversation.mockReset();
    createMessage.mockReset();
    notifyNewMessageParticipants.mockClear();
    relayReplyOverWhatsApp.mockReset();
    relayReplyOverWhatsApp.mockResolvedValue({ sent: false, windowOpen: false });
  });

  it("rejects sending to a conversation the caller isn't a participant of", async () => {
    findFirstConversation.mockResolvedValueOnce(null);

    const response = await replyPOST(
      jsonRequest("https://portal.test/api/messages/conversations/conv-1/messages", { body: "Hi" }),
      { params: Promise.resolve({ id: "conv-1" }) }
    );

    expect(response.status).toBe(404);
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("sends the message and notifies the other participants", async () => {
    findFirstConversation.mockResolvedValueOnce({ id: "conv-1" });
    createMessage.mockResolvedValueOnce({ id: "msg-1", createdAt: new Date("2026-07-05T12:00:00Z") });

    const response = await replyPOST(
      jsonRequest("https://portal.test/api/messages/conversations/conv-1/messages", { body: "Reply body" }),
      { params: Promise.resolve({ id: "conv-1" }) }
    );

    expect(response.status).toBe(201);
    expect(notifyNewMessageParticipants).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "conv-1", body: "Reply body" })
    );
  });

  it("relays a WhatsApp-sourced conversation's channel and lastInboundAt into relayReplyOverWhatsApp", async () => {
    const lastInboundAt = new Date("2026-08-06T10:00:00Z");
    findFirstConversation.mockResolvedValueOnce({ id: "conv-1", channel: "WHATSAPP", lastInboundAt });
    createMessage.mockResolvedValueOnce({ id: "msg-1", createdAt: new Date("2026-08-06T11:00:00Z") });
    relayReplyOverWhatsApp.mockResolvedValueOnce({ sent: true, windowOpen: true });

    const response = await replyPOST(
      jsonRequest("https://portal.test/api/messages/conversations/conv-1/messages", { body: "Reply over WhatsApp" }),
      { params: Promise.resolve({ id: "conv-1" }) }
    );
    const payload = await response.json();

    expect(relayReplyOverWhatsApp).toHaveBeenCalledWith({
      conversationId: "conv-1",
      organizationId: "org-a",
      senderUserId: "officer-1",
      body: "Reply over WhatsApp",
      channel: "WHATSAPP",
      lastInboundAt,
    });
    expect(payload.data.whatsappSent).toBe(true);
    expect(payload.data.whatsappWindowOpen).toBe(true);
  });

  it("still saves the in-app message and returns 201 even if the WhatsApp relay throws", async () => {
    findFirstConversation.mockResolvedValueOnce({ id: "conv-1", channel: "WHATSAPP", lastInboundAt: new Date() });
    createMessage.mockResolvedValueOnce({ id: "msg-1", createdAt: new Date("2026-08-06T11:00:00Z") });
    relayReplyOverWhatsApp.mockRejectedValueOnce(new Error("Twilio unreachable"));

    const response = await replyPOST(
      jsonRequest("https://portal.test/api/messages/conversations/conv-1/messages", { body: "Reply body" }),
      { params: Promise.resolve({ id: "conv-1" }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.ok).toBe(true);
    expect(payload.data.whatsappSent).toBe(false);
  });
});
