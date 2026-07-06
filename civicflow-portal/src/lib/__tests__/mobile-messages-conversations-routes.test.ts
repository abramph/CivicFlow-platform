import { beforeEach, describe, expect, it, vi } from "vitest";

const requireMobileMembership = vi.fn();
vi.mock("@/lib/mobile-auth", () => ({
  requireMobileMembership: (...args: unknown[]) => requireMobileMembership(...args),
}));

const findManyParticipant = vi.fn();
const findFirstConversation = vi.fn();
const findManyMessage = vi.fn().mockResolvedValue([]);
const createMessage = vi.fn();
const updateConversation = vi.fn().mockResolvedValue(undefined);
const updateManyParticipant = vi.fn().mockResolvedValue(undefined);

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
  },
}));

vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

const notifyNewMessageParticipants = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/messaging", () => ({
  notifyNewMessageParticipants: (...args: unknown[]) => notifyNewMessageParticipants(...args),
}));

import { GET as listGET } from "@/app/api/mobile/messages/conversations/route";
import { GET as detailGET } from "@/app/api/mobile/messages/conversations/[id]/route";
import { POST as replyPOST } from "@/app/api/mobile/messages/conversations/[id]/messages/route";

function jsonRequest(url: string, body: unknown) {
  return new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

describe("GET /api/mobile/messages/conversations", () => {
  beforeEach(() => {
    requireMobileMembership.mockReset();
    findManyParticipant.mockReset();
  });

  it("requires organizationId", async () => {
    const response = await listGET(new Request("https://portal.test/api/mobile/messages/conversations"));
    expect(response.status).toBe(400);
    expect(requireMobileMembership).not.toHaveBeenCalled();
  });

  it("scopes the list to the caller's own participant rows within the verified org", async () => {
    requireMobileMembership.mockResolvedValueOnce({
      session: { userId: "member-user-1", email: "member@example.com" },
      organizationId: "org-a",
      memberId: "member-1",
    });
    findManyParticipant.mockResolvedValueOnce([]);

    await listGET(new Request("https://portal.test/api/mobile/messages/conversations?organizationId=org-a"));

    expect(findManyParticipant).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "member-user-1", organizationId: "org-a" } })
    );
  });
});

describe("GET /api/mobile/messages/conversations/[id]", () => {
  beforeEach(() => {
    requireMobileMembership.mockReset();
    findFirstConversation.mockReset();
    updateManyParticipant.mockClear();
  });

  it("404s for a conversation the member isn't a participant of (cross-org / cross-member guesses)", async () => {
    requireMobileMembership.mockResolvedValueOnce({
      session: { userId: "member-user-1", email: "member@example.com" },
      organizationId: "org-a",
      memberId: "member-1",
    });
    findFirstConversation.mockResolvedValueOnce(null);

    const response = await detailGET(
      new Request("https://portal.test/api/mobile/messages/conversations/conv-1?organizationId=org-a"),
      { params: Promise.resolve({ id: "conv-1" }) }
    );

    expect(response.status).toBe(404);
    expect(updateManyParticipant).not.toHaveBeenCalled();
  });
});

describe("POST /api/mobile/messages/conversations/[id]/messages", () => {
  beforeEach(() => {
    requireMobileMembership.mockReset();
    findFirstConversation.mockReset();
    createMessage.mockReset();
    notifyNewMessageParticipants.mockClear();
  });

  it("rejects sending to a conversation the member isn't a participant of", async () => {
    requireMobileMembership.mockResolvedValueOnce({
      session: { userId: "member-user-1", email: "member@example.com" },
      organizationId: "org-a",
      memberId: "member-1",
    });
    findFirstConversation.mockResolvedValueOnce(null);

    const response = await replyPOST(
      jsonRequest("https://portal.test/api/mobile/messages/conversations/conv-1/messages", { organizationId: "org-a", body: "Hi" }),
      { params: Promise.resolve({ id: "conv-1" }) }
    );

    expect(response.status).toBe(404);
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("sends the reply and notifies the officer", async () => {
    requireMobileMembership.mockResolvedValueOnce({
      session: { userId: "member-user-1", email: "member@example.com" },
      organizationId: "org-a",
      memberId: "member-1",
    });
    findFirstConversation.mockResolvedValueOnce({ id: "conv-1" });
    createMessage.mockResolvedValueOnce({ id: "msg-1", createdAt: new Date("2026-07-05T12:00:00Z") });

    const response = await replyPOST(
      jsonRequest("https://portal.test/api/mobile/messages/conversations/conv-1/messages", { organizationId: "org-a", body: "Reply" }),
      { params: Promise.resolve({ id: "conv-1" }) }
    );

    expect(response.status).toBe(201);
    expect(notifyNewMessageParticipants).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "conv-1", senderUserId: "member-user-1" })
    );
  });
});
