import { beforeEach, describe, expect, it, vi } from "vitest";

const findManySignups = vi.fn();
const updateSignup = vi.fn();
const sendEmail = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaVolunteerSignup: {
      findMany: (...a: unknown[]) => findManySignups(...a),
      update: (...a: unknown[]) => updateSignup(...a),
    },
  },
}));
vi.mock("@/lib/mail", () => ({ sendEmail: (...args: unknown[]) => sendEmail(...args) }));
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

import { sendVolunteerRemindersForOrganization } from "@/lib/labs/pta/volunteer-reminders";

function signup(overrides: Record<string, unknown> = {}) {
  return {
    id: "s1",
    householdAdult: { name: "Pat Parent", email: "pat@example.org" },
    slot: {
      startAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      endAt: null,
      label: "Setup crew",
      locationOverride: "Gym",
      opportunity: { title: "Fall Festival", instructions: "Wear comfortable shoes.", organization: { name: "Demo PTA" } },
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  sendEmail.mockResolvedValue({ sent: true });
});

describe("sendVolunteerRemindersForOrganization", () => {
  it("only targets un-reminded SIGNED_UP signups inside the window", async () => {
    findManySignups.mockResolvedValueOnce([]);
    await sendVolunteerRemindersForOrganization("org-1");
    const where = findManySignups.mock.calls[0][0].where;
    expect(where).toMatchObject({ organizationId: "org-1", status: "SIGNED_UP", reminderSentAt: null });
    expect(where.slot.startAt.gte).toBeInstanceOf(Date);
    expect(where.slot.startAt.lte).toBeInstanceOf(Date);
  });

  it("sends the email and stamps reminderSentAt", async () => {
    findManySignups.mockResolvedValueOnce([signup()]);
    const result = await sendVolunteerRemindersForOrganization("org-1", { actorUserId: "u1" });
    expect(result).toMatchObject({ sent: 1, skippedNoEmail: 0, failed: 0 });
    expect(sendEmail.mock.calls[0][0].to).toBe("pat@example.org");
    expect(sendEmail.mock.calls[0][0].subject).toContain("Fall Festival");
    expect(updateSignup.mock.calls[0][0]).toMatchObject({ where: { id: "s1" } });
    expect(updateSignup.mock.calls[0][0].data.reminderSentAt).toBeInstanceOf(Date);
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "pta.volunteers.reminders_sent" }));
  });

  it("volunteers without an email are counted, not silently dropped — and not stamped", async () => {
    findManySignups.mockResolvedValueOnce([signup({ householdAdult: { name: "No Email", email: null } })]);
    const result = await sendVolunteerRemindersForOrganization("org-1");
    expect(result).toMatchObject({ sent: 0, skippedNoEmail: 1 });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(updateSignup).not.toHaveBeenCalled();
  });

  it("a send failure leaves reminderSentAt null so the next run retries", async () => {
    sendEmail.mockRejectedValueOnce(new Error("smtp down"));
    findManySignups.mockResolvedValueOnce([signup()]);
    const result = await sendVolunteerRemindersForOrganization("org-1");
    expect(result).toMatchObject({ sent: 0, failed: 1 });
    expect(updateSignup).not.toHaveBeenCalled();
  });
});
