import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const findManyUnionCaseDeadline = vi.fn();
const createUnionCaseDeadlineReminderLog = vi.fn();
const findFirstOrgMember = vi.fn();
const findManyMobileDeviceToken = vi.fn();
const sendEmail = vi.fn().mockResolvedValue({ sent: true, skipped: false });
const sendPushToTokens = vi.fn().mockResolvedValue({ sent: 0, failed: 0 });

vi.mock("@/lib/prisma", () => ({
  prisma: {
    unionCaseDeadline: { findMany: (...a: unknown[]) => findManyUnionCaseDeadline(...a) },
    unionCaseDeadlineReminderLog: { create: (...a: unknown[]) => createUnionCaseDeadlineReminderLog(...a) },
    orgMember: { findFirst: (...a: unknown[]) => findFirstOrgMember(...a) },
    mobileDeviceToken: { findMany: (...a: unknown[]) => findManyMobileDeviceToken(...a) },
  },
}));

vi.mock("@/lib/mail", () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));
vi.mock("@/lib/push", () => ({ sendPushToTokens: (...a: unknown[]) => sendPushToTokens(...a) }));
vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));

beforeEach(() => {
  vi.clearAllMocks();
  findManyMobileDeviceToken.mockResolvedValue([]);
  createUnionCaseDeadlineReminderLog.mockResolvedValue({ id: "reminder-log-1" });
});

function p2002(target: string[]) {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target },
  });
}

const APPROACHING_DEADLINE = {
  id: "deadline-1",
  organizationId: "org-1",
  caseId: "case-1",
  deadlineType: "MANAGEMENT_RESPONSE_DUE",
  description: null,
  dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // due in ~1 day
  responsibleOrgMemberId: "rep-1",
  case: { assignedToOrgMemberId: "rep-1", caseNumber: 7, title: "Unpaid overtime" },
};

const ACTIVE_RECIPIENT = { userId: "user-1", email: "rep@example.org", commsEmailEnabled: true, commsPushEnabled: false };

describe("sendUnionCaseDeadlineReminders", () => {
  it("claims a reminder-log row and emails the responsible party for a deadline due soon", async () => {
    findManyUnionCaseDeadline.mockResolvedValueOnce([APPROACHING_DEADLINE]);
    findFirstOrgMember.mockResolvedValueOnce(ACTIVE_RECIPIENT);

    const { sendUnionCaseDeadlineReminders } = await import("../cases");
    const result = await sendUnionCaseDeadlineReminders();

    expect(result.remindersSent).toBe(1);
    expect(createUnionCaseDeadlineReminderLog).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ deadlineId: "deadline-1", orgMemberId: "rep-1", reminderType: "DEADLINE_REMINDER" }),
      })
    );
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "rep@example.org" }));
  });

  it("sends 'approaching' content (not overdue) for a deadline that hasn't passed yet", async () => {
    findManyUnionCaseDeadline.mockResolvedValueOnce([APPROACHING_DEADLINE]);
    findFirstOrgMember.mockResolvedValueOnce(ACTIVE_RECIPIENT);

    const { sendUnionCaseDeadlineReminders } = await import("../cases");
    await sendUnionCaseDeadlineReminders();

    const call = sendEmail.mock.calls[0][0] as { subject: string; text: string };
    expect(call.subject).not.toMatch(/overdue/i);
    expect(call.text).toContain("due");
    expect(call.text).not.toMatch(/overdue/i);
  });

  it("sends 'overdue' content for a deadline already past due", async () => {
    findManyUnionCaseDeadline.mockResolvedValueOnce([{ ...APPROACHING_DEADLINE, dueAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) }]);
    findFirstOrgMember.mockResolvedValueOnce(ACTIVE_RECIPIENT);

    const { sendUnionCaseDeadlineReminders } = await import("../cases");
    await sendUnionCaseDeadlineReminders();

    const call = sendEmail.mock.calls[0][0] as { subject: string; text: string };
    expect(call.subject).toMatch(/overdue/i);
    expect(call.text).toMatch(/overdue/i);
  });

  it("falls back to the case's assignedToOrgMemberId when the deadline has no responsibleOrgMemberId of its own", async () => {
    findManyUnionCaseDeadline.mockResolvedValueOnce([
      { ...APPROACHING_DEADLINE, responsibleOrgMemberId: null, case: { assignedToOrgMemberId: "rep-2", caseNumber: 7, title: "Unpaid overtime" } },
    ]);
    findFirstOrgMember.mockResolvedValueOnce(ACTIVE_RECIPIENT);

    const { sendUnionCaseDeadlineReminders } = await import("../cases");
    const result = await sendUnionCaseDeadlineReminders();

    expect(result.remindersSent).toBe(1);
    expect(createUnionCaseDeadlineReminderLog).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ orgMemberId: "rep-2" }) }));
  });

  it("skips a deadline entirely -- no claim attempted -- when neither responsibleOrgMemberId nor the case's assignedToOrgMemberId is set", async () => {
    findManyUnionCaseDeadline.mockResolvedValueOnce([
      { ...APPROACHING_DEADLINE, responsibleOrgMemberId: null, case: { assignedToOrgMemberId: null, caseNumber: 7, title: "Unpaid overtime" } },
    ]);

    const { sendUnionCaseDeadlineReminders } = await import("../cases");
    const result = await sendUnionCaseDeadlineReminders();

    expect(result.remindersSent).toBe(0);
    expect(createUnionCaseDeadlineReminderLog).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("does not count or send when the claim loses to a concurrent run's unique-constraint conflict", async () => {
    findManyUnionCaseDeadline.mockResolvedValueOnce([APPROACHING_DEADLINE]);
    createUnionCaseDeadlineReminderLog.mockRejectedValueOnce(p2002(["deadlineId", "orgMemberId", "reminderType", "dueOffsetDays"]));

    const { sendUnionCaseDeadlineReminders } = await import("../cases");
    const result = await sendUnionCaseDeadlineReminders();

    expect(result.remindersSent).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("re-throws a non-P2002 database error instead of silently swallowing it", async () => {
    findManyUnionCaseDeadline.mockResolvedValueOnce([APPROACHING_DEADLINE]);
    createUnionCaseDeadlineReminderLog.mockRejectedValueOnce(new Error("connection reset"));

    const { sendUnionCaseDeadlineReminders } = await import("../cases");
    await expect(sendUnionCaseDeadlineReminders()).rejects.toThrow("connection reset");
  });

  it("still counts the reminder as sent even when notification delivery itself throws -- the claim already committed", async () => {
    findManyUnionCaseDeadline.mockResolvedValueOnce([APPROACHING_DEADLINE]);
    findFirstOrgMember.mockResolvedValueOnce(ACTIVE_RECIPIENT);
    sendEmail.mockRejectedValueOnce(new Error("SMTP provider outage"));

    const { sendUnionCaseDeadlineReminders } = await import("../cases");
    const result = await sendUnionCaseDeadlineReminders();

    expect(result.remindersSent).toBe(1);
  });

  it("returns zero without any recipient lookup when nothing is due", async () => {
    findManyUnionCaseDeadline.mockResolvedValueOnce([]);

    const { sendUnionCaseDeadlineReminders } = await import("../cases");
    const result = await sendUnionCaseDeadlineReminders();

    expect(result.remindersSent).toBe(0);
    expect(findFirstOrgMember).not.toHaveBeenCalled();
  });

  it("scans only open (not completed) deadlines on non-terminal cases due within the window or already overdue", async () => {
    findManyUnionCaseDeadline.mockResolvedValueOnce([]);

    const { sendUnionCaseDeadlineReminders } = await import("../cases");
    await sendUnionCaseDeadlineReminders();

    expect(findManyUnionCaseDeadline).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          completedAt: null,
          dueAt: { lte: expect.any(Date) },
          case: { status: { notIn: ["CLOSED", "WITHDRAWN"] } },
        }),
      })
    );
  });

  it("never puts case description or note content in the notification -- only deadlineType/case label/due date", async () => {
    findManyUnionCaseDeadline.mockResolvedValueOnce([APPROACHING_DEADLINE]);
    findFirstOrgMember.mockResolvedValueOnce(ACTIVE_RECIPIENT);

    const { sendUnionCaseDeadlineReminders } = await import("../cases");
    await sendUnionCaseDeadlineReminders();

    const call = sendEmail.mock.calls[0][0] as { text: string };
    expect(call.text).toContain("MANAGEMENT_RESPONSE_DUE");
    expect(call.text).toContain("UC-7");
  });
});
