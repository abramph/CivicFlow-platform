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
});
