import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyParticipant = vi.fn();
const findFirstOrgMember = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversationParticipant: {
      findMany: (...args: unknown[]) => findManyParticipant(...args),
    },
    orgMember: {
      findFirst: (...args: unknown[]) => findFirstOrgMember(...args),
    },
  },
}));

const sendEmail = vi.fn().mockResolvedValue({ sent: true, skipped: false });
vi.mock("@/lib/mail", () => ({ sendEmail: (...args: unknown[]) => sendEmail(...args) }));

const sendPushToMember = vi.fn();
vi.mock("@/lib/push", () => ({ sendPushToMember: (...args: unknown[]) => sendPushToMember(...args) }));

import { notifyNewMessageParticipants } from "@/lib/messaging";

describe("notifyNewMessageParticipants", () => {
  beforeEach(() => {
    findManyParticipant.mockReset();
    findFirstOrgMember.mockReset();
    sendEmail.mockClear();
    sendPushToMember.mockReset();
  });

  it("sends push to a member recipient and skips the email fallback when push is delivered", async () => {
    findManyParticipant.mockResolvedValueOnce([
      { userId: "member-user-1", role: "MEMBER", user: { email: "member@example.com" } },
    ]);
    findFirstOrgMember.mockResolvedValueOnce({ id: "member-1", commsEmailEnabled: true });
    sendPushToMember.mockResolvedValueOnce({ sent: 1, failed: 0, skipped: false });

    await notifyNewMessageParticipants({
      conversationId: "conv-1",
      organizationId: "org-a",
      senderUserId: "officer-1",
      senderDisplayName: "Officer Jane",
      body: "Hello there",
    });

    expect(sendPushToMember).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-a", memberId: "member-1", deepLink: "/messages/conv-1" })
    );
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("falls back to email when push isn't delivered and the member allows email", async () => {
    findManyParticipant.mockResolvedValueOnce([
      { userId: "member-user-1", role: "MEMBER", user: { email: "member@example.com" } },
    ]);
    findFirstOrgMember.mockResolvedValueOnce({ id: "member-1", commsEmailEnabled: true });
    sendPushToMember.mockResolvedValueOnce({ sent: 0, failed: 0, skipped: true, reason: "No linked mobile login" });

    await notifyNewMessageParticipants({
      conversationId: "conv-1",
      organizationId: "org-a",
      senderUserId: "officer-1",
      senderDisplayName: "Officer Jane",
      body: "Hello there",
    });

    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "member@example.com" }));
  });

  it("does not email a member who opted out of email even when push fails", async () => {
    findManyParticipant.mockResolvedValueOnce([
      { userId: "member-user-1", role: "MEMBER", user: { email: "member@example.com" } },
    ]);
    findFirstOrgMember.mockResolvedValueOnce({ id: "member-1", commsEmailEnabled: false });
    sendPushToMember.mockResolvedValueOnce({ sent: 0, failed: 0, skipped: true, reason: "Member has opted out of push notifications" });

    await notifyNewMessageParticipants({
      conversationId: "conv-1",
      organizationId: "org-a",
      senderUserId: "officer-1",
      senderDisplayName: "Officer Jane",
      body: "Hello there",
    });

    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("always emails a staff recipient — there's no push channel for staff", async () => {
    findManyParticipant.mockResolvedValueOnce([
      { userId: "officer-2", role: "STAFF", user: { email: "officer2@example.com" } },
    ]);

    await notifyNewMessageParticipants({
      conversationId: "conv-1",
      organizationId: "org-a",
      senderUserId: "member-user-1",
      senderDisplayName: "Jane Member",
      body: "Question about dues",
    });

    expect(sendPushToMember).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "officer2@example.com" }));
  });

  it("never notifies the sender themselves", async () => {
    findManyParticipant.mockResolvedValueOnce([]);

    await notifyNewMessageParticipants({
      conversationId: "conv-1",
      organizationId: "org-a",
      senderUserId: "officer-1",
      senderDisplayName: "Officer Jane",
      body: "Hello",
    });

    expect(findManyParticipant).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: { not: "officer-1" } }) })
    );
    expect(sendEmail).not.toHaveBeenCalled();
    expect(sendPushToMember).not.toHaveBeenCalled();
  });
});
