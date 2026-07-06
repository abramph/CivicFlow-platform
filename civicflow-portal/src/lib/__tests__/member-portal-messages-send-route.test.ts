import { beforeEach, describe, expect, it, vi } from "vitest";

const requireMemberWebSession = vi.fn();
vi.mock("@/lib/member-web-session", () => ({
  requireMemberWebSession: (...args: unknown[]) => requireMemberWebSession(...args),
}));

const findFirstConversation = vi.fn();
const createMessage = vi.fn();
const updateConversation = vi.fn().mockResolvedValue(undefined);
const updateManyParticipant = vi.fn().mockResolvedValue(undefined);
const findUniqueUser = vi.fn().mockResolvedValue({ displayName: "Jane Member", email: "jane@example.com" });

vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: {
      findFirst: (...args: unknown[]) => findFirstConversation(...args),
      update: (...args: unknown[]) => updateConversation(...args),
    },
    message: {
      create: (...args: unknown[]) => createMessage(...args),
    },
    conversationParticipant: {
      updateMany: (...args: unknown[]) => updateManyParticipant(...args),
    },
    user: {
      findUnique: (...args: unknown[]) => findUniqueUser(...args),
    },
  },
}));

vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

const notifyNewMessageParticipants = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/messaging", () => ({
  notifyNewMessageParticipants: (...args: unknown[]) => notifyNewMessageParticipants(...args),
}));

import { POST as replyPOST } from "@/app/api/member-portal/messages/conversations/[id]/messages/route";

function jsonRequest(body: unknown) {
  return new Request("https://portal.test/api/member-portal/messages/conversations/conv-1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/member-portal/messages/conversations/[id]/messages", () => {
  beforeEach(() => {
    requireMemberWebSession.mockReset();
    findFirstConversation.mockReset();
    createMessage.mockReset();
    notifyNewMessageParticipants.mockClear();
  });

  it("rejects sending to a conversation the member isn't a participant of", async () => {
    requireMemberWebSession.mockResolvedValueOnce({ userId: "member-user-1", organizationId: "org-a", memberId: "member-1" });
    findFirstConversation.mockResolvedValueOnce(null);

    const response = await replyPOST(jsonRequest({ organizationId: "org-a", body: "Hi" }), {
      params: Promise.resolve({ id: "conv-1" }),
    });

    expect(response.status).toBe(404);
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("sends the reply and notifies the officer using the member's display name", async () => {
    requireMemberWebSession.mockResolvedValueOnce({ userId: "member-user-1", organizationId: "org-a", memberId: "member-1" });
    findFirstConversation.mockResolvedValueOnce({ id: "conv-1" });
    createMessage.mockResolvedValueOnce({ id: "msg-1", createdAt: new Date("2026-07-05T12:00:00Z") });

    const response = await replyPOST(jsonRequest({ organizationId: "org-a", body: "Reply" }), {
      params: Promise.resolve({ id: "conv-1" }),
    });

    expect(response.status).toBe(201);
    expect(notifyNewMessageParticipants).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "conv-1", senderUserId: "member-user-1", senderDisplayName: "Jane Member" })
    );
  });
});
