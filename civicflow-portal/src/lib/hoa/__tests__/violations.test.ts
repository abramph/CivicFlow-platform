import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const findFirstProperty = vi.fn();
const findFirstViolation = vi.fn();
const createViolation = vi.fn();
const updateViolation = vi.fn();
const updateManyViolation = vi.fn();
const findUniqueOrThrowViolation = vi.fn();
const findManyViolation = vi.fn();
const createViolationNotice = vi.fn();
const findManyViolationNotice = vi.fn();
const createViolationComment = vi.fn();
const createViolationStatusHistory = vi.fn();
const findManyPropertyResident = vi.fn();
const findManyMobileDeviceToken = vi.fn();
const createViolationReminderLog = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);
const sendEmail = vi.fn().mockResolvedValue({ sent: true, skipped: false });
const sendPushToTokens = vi.fn().mockResolvedValue({ sent: 0, failed: 0 });

// The service layer wraps create/issue/transition in prisma.$transaction —
// the tx client passed into that callback must support the same calls as
// the top-level client, routed through the SAME mock functions so a test
// can assert on them regardless of which path (transactional or not) wrote
// the data.
const txClient = {
  violation: {
    findFirst: (...a: unknown[]) => findFirstViolation(...a),
    create: (...a: unknown[]) => createViolation(...a),
    updateMany: (...a: unknown[]) => updateManyViolation(...a),
    findUniqueOrThrow: (...a: unknown[]) => findUniqueOrThrowViolation(...a),
  },
  violationNotice: { create: (...a: unknown[]) => createViolationNotice(...a) },
  violationStatusHistory: { create: (...a: unknown[]) => createViolationStatusHistory(...a) },
};
const transaction = vi.fn((fn: (tx: typeof txClient) => unknown) => fn(txClient));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (...a: Parameters<typeof transaction>) => transaction(...a),
    property: { findFirst: (...a: unknown[]) => findFirstProperty(...a) },
    violation: {
      findFirst: (...a: unknown[]) => findFirstViolation(...a),
      create: (...a: unknown[]) => createViolation(...a),
      update: (...a: unknown[]) => updateViolation(...a),
      updateMany: (...a: unknown[]) => updateManyViolation(...a),
      findUniqueOrThrow: (...a: unknown[]) => findUniqueOrThrowViolation(...a),
      findMany: (...a: unknown[]) => findManyViolation(...a),
    },
    violationNotice: {
      create: (...a: unknown[]) => createViolationNotice(...a),
      findMany: (...a: unknown[]) => findManyViolationNotice(...a),
    },
    violationComment: { create: (...a: unknown[]) => createViolationComment(...a) },
    violationStatusHistory: { create: (...a: unknown[]) => createViolationStatusHistory(...a) },
    propertyResident: { findMany: (...a: unknown[]) => findManyPropertyResident(...a) },
    mobileDeviceToken: { findMany: (...a: unknown[]) => findManyMobileDeviceToken(...a) },
    violationReminderLog: { create: (...a: unknown[]) => createViolationReminderLog(...a) },
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: (...a: unknown[]) => createAuditEvent(...a) }));
vi.mock("@/lib/mail", () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));
vi.mock("@/lib/push", () => ({ sendPushToTokens: (...a: unknown[]) => sendPushToTokens(...a) }));

const resolveOrganizationAccess = vi.fn();
vi.mock("@/lib/subscription-gate", () => ({
  resolveOrganizationAccess: (...a: unknown[]) => resolveOrganizationAccess(...a),
}));

beforeEach(() => {
  vi.clearAllMocks();
  transaction.mockImplementation((fn: (tx: typeof txClient) => unknown) => fn(txClient));
  findManyPropertyResident.mockResolvedValue([]);
  findManyMobileDeviceToken.mockResolvedValue([]);
  updateManyViolation.mockResolvedValue({ count: 1 });
  createViolationReminderLog.mockResolvedValue({ id: "reminder-log-1" });
  resolveOrganizationAccess.mockResolvedValue({ allowed: true, reason: null, trialEndsAt: null, subscriptionStatus: null, billingExempt: false });
});

function p2002(target: string[]) {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target },
  });
}

describe("assertValidTransition / isTerminalStatus", () => {
  it.each([
    ["DRAFT", "ISSUED"],
    ["DRAFT", "DISMISSED"],
    ["ISSUED", "ACKNOWLEDGED"],
    ["ISSUED", "IN_REVIEW"],
    ["ISSUED", "CURED"],
    ["ACKNOWLEDGED", "IN_REVIEW"],
    ["IN_REVIEW", "RESOLVED"],
    ["IN_REVIEW", "DISMISSED"],
  ] as const)("allows %s -> %s", async (from, to) => {
    const { assertValidTransition } = await import("../violations");
    expect(() => assertValidTransition(from, to)).not.toThrow();
  });

  it.each([
    ["DRAFT", "RESOLVED"],
    ["DRAFT", "ACKNOWLEDGED"],
    ["ISSUED", "DRAFT"],
    ["RESOLVED", "IN_REVIEW"],
    ["CURED", "ISSUED"],
    ["DISMISSED", "DRAFT"],
  ] as const)("rejects %s -> %s", async (from, to) => {
    const { assertValidTransition } = await import("../violations");
    expect(() => assertValidTransition(from, to)).toThrow(/Cannot move a violation/);
  });

  it("treats CURED/RESOLVED/DISMISSED as terminal and everything else as not", async () => {
    const { isTerminalStatus } = await import("../violations");
    expect(isTerminalStatus("CURED")).toBe(true);
    expect(isTerminalStatus("RESOLVED")).toBe(true);
    expect(isTerminalStatus("DISMISSED")).toBe(true);
    expect(isTerminalStatus("DRAFT")).toBe(false);
    expect(isTerminalStatus("ISSUED")).toBe(false);
    expect(isTerminalStatus("IN_REVIEW")).toBe(false);
  });
});

describe("createViolationDraft", () => {
  it("rejects a property that doesn't belong to the organization", async () => {
    findFirstProperty.mockResolvedValueOnce(null);
    const { createViolationDraft } = await import("../violations");
    await expect(
      createViolationDraft({ organizationId: "org-1", propertyId: "prop-x", violationType: "Lawn", description: "Overgrown", actorUserId: "user-1" })
    ).rejects.toMatchObject({ code: "HOA_PROPERTY_NOT_FOUND" });
    expect(createViolation).not.toHaveBeenCalled();
  });

  it("creates a DRAFT violation, records DRAFT in status history, and writes an audit event", async () => {
    findFirstProperty.mockResolvedValueOnce({ id: "prop-1" });
    createViolation.mockResolvedValueOnce({ id: "violation-1", status: "DRAFT" });
    const { createViolationDraft } = await import("../violations");

    const result = await createViolationDraft({
      organizationId: "org-1",
      propertyId: "prop-1",
      violationType: "Lawn maintenance",
      description: "Grass over 12 inches",
      actorUserId: "user-1",
    });

    expect(result.id).toBe("violation-1");
    expect(createViolation).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "DRAFT", organizationId: "org-1", propertyId: "prop-1" }) })
    );
    expect(createViolationStatusHistory).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ fromStatus: null, toStatus: "DRAFT" }) })
    );
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "create", entityType: "hoa_violation" }));
  });
});

describe("updateViolationDraft", () => {
  it("allows editing while still DRAFT", async () => {
    findFirstViolation.mockResolvedValueOnce({ id: "violation-1", status: "DRAFT" });
    updateViolation.mockResolvedValueOnce({ id: "violation-1", status: "DRAFT", description: "Updated" });
    const { updateViolationDraft } = await import("../violations");

    const result = await updateViolationDraft({ organizationId: "org-1", violationId: "violation-1", description: "Updated" });
    expect(result.description).toBe("Updated");
  });

  it("rejects editing once the violation has been issued", async () => {
    findFirstViolation.mockResolvedValueOnce({ id: "violation-1", status: "ISSUED" });
    const { updateViolationDraft } = await import("../violations");

    await expect(
      updateViolationDraft({ organizationId: "org-1", violationId: "violation-1", description: "Sneaky edit" })
    ).rejects.toMatchObject({ code: "HOA_VIOLATION_INVALID_TRANSITION" });
    expect(updateViolation).not.toHaveBeenCalled();
  });
});

describe("issueViolation", () => {
  it("moves DRAFT -> ISSUED, sends the initial notice, and notifies active residents by email and push", async () => {
    findFirstViolation.mockResolvedValueOnce({ id: "violation-1", status: "DRAFT", propertyId: "prop-1", cureByDate: null });
    findUniqueOrThrowViolation.mockResolvedValueOnce({ id: "violation-1", status: "ISSUED", violationType: "Lawn" });
    findManyPropertyResident.mockResolvedValueOnce([
      { orgMember: { id: "member-1", userId: "user-a", email: "resident@example.com", commsEmailEnabled: true, commsPushEnabled: true } },
    ]);
    findManyMobileDeviceToken.mockResolvedValueOnce([{ userId: "user-a", token: "ExponentPushToken[abc]" }]);

    const { issueViolation } = await import("../violations");
    const result = await issueViolation({
      organizationId: "org-1",
      violationId: "violation-1",
      noticeBody: "Please fix your lawn.",
      actorUserId: "officer-1",
    });

    expect(result.status).toBe("ISSUED");
    expect(updateManyViolation).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "violation-1", status: "DRAFT" }), data: expect.objectContaining({ status: "ISSUED" }) })
    );
    expect(createViolationNotice).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ noticeType: "INITIAL", body: "Please fix your lawn." }) })
    );
    expect(createViolationStatusHistory).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ fromStatus: "DRAFT", toStatus: "ISSUED" }) })
    );
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "resident@example.com" }));
    expect(sendPushToTokens).toHaveBeenCalledWith(["ExponentPushToken[abc]"], expect.objectContaining({ title: "New violation notice", deepLink: "/m/violations" }));
  });

  it("skips email for a resident who opted out via commsEmailEnabled", async () => {
    findFirstViolation.mockResolvedValueOnce({ id: "violation-1", status: "DRAFT", propertyId: "prop-1", cureByDate: null });
    findUniqueOrThrowViolation.mockResolvedValueOnce({ id: "violation-1", status: "ISSUED", violationType: "Lawn" });
    findManyPropertyResident.mockResolvedValueOnce([
      { orgMember: { id: "member-1", userId: null, email: "resident@example.com", commsEmailEnabled: false, commsPushEnabled: true } },
    ]);

    const { issueViolation } = await import("../violations");
    await issueViolation({ organizationId: "org-1", violationId: "violation-1", noticeBody: "Notice", actorUserId: "officer-1" });

    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("rejects issuing a violation that isn't in DRAFT", async () => {
    findFirstViolation.mockResolvedValueOnce({ id: "violation-1", status: "RESOLVED", propertyId: "prop-1" });
    const { issueViolation } = await import("../violations");

    await expect(
      issueViolation({ organizationId: "org-1", violationId: "violation-1", noticeBody: "x", actorUserId: "officer-1" })
    ).rejects.toMatchObject({ code: "HOA_VIOLATION_INVALID_TRANSITION" });
    expect(updateManyViolation).not.toHaveBeenCalled();
  });

  it("rejects with HOA_VIOLATION_STALE_UPDATE when a concurrent request already changed the status (compare-and-swap lost)", async () => {
    findFirstViolation.mockResolvedValueOnce({ id: "violation-1", status: "DRAFT", propertyId: "prop-1", cureByDate: null });
    updateManyViolation.mockResolvedValueOnce({ count: 0 });
    const { issueViolation } = await import("../violations");

    await expect(
      issueViolation({ organizationId: "org-1", violationId: "violation-1", noticeBody: "x", actorUserId: "officer-1" })
    ).rejects.toMatchObject({ code: "HOA_VIOLATION_STALE_UPDATE" });
    // Lost the race -- must not have gone on to create a duplicate notice or notify anyone.
    expect(createViolationNotice).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("does not fail the API call when notification delivery throws after the transition already committed", async () => {
    findFirstViolation.mockResolvedValueOnce({ id: "violation-1", status: "DRAFT", propertyId: "prop-1", cureByDate: null });
    findUniqueOrThrowViolation.mockResolvedValueOnce({ id: "violation-1", status: "ISSUED", violationType: "Lawn" });
    findManyPropertyResident.mockResolvedValueOnce([
      { orgMember: { id: "member-1", userId: null, email: "resident@example.com", commsEmailEnabled: true, commsPushEnabled: false } },
    ]);
    sendEmail.mockRejectedValueOnce(new Error("SMTP provider outage"));

    const { issueViolation } = await import("../violations");
    const result = await issueViolation({ organizationId: "org-1", violationId: "violation-1", noticeBody: "x", actorUserId: "officer-1" });

    // The transition itself succeeded and is returned normally -- a
    // notification failure must not surface as a thrown error here.
    expect(result.status).toBe("ISSUED");
  });
});

describe("transitionViolationStatus", () => {
  it("moves a non-terminal transition without setting resolvedAt/resolutionNotes", async () => {
    findFirstViolation.mockResolvedValueOnce({ id: "violation-1", status: "ISSUED", propertyId: "prop-1", violationType: "Lawn" });
    findUniqueOrThrowViolation.mockResolvedValueOnce({ id: "violation-1", status: "IN_REVIEW", violationType: "Lawn" });
    const { transitionViolationStatus } = await import("../violations");

    await transitionViolationStatus({ organizationId: "org-1", violationId: "violation-1", toStatus: "IN_REVIEW", actorUserId: "officer-1" });

    expect(updateManyViolation).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "violation-1", status: "ISSUED" }),
        data: expect.objectContaining({ status: "IN_REVIEW", resolvedAt: undefined, resolutionNotes: undefined }),
      })
    );
  });

  it("stamps resolvedAt and stores resolutionNotes on a terminal transition", async () => {
    findFirstViolation.mockResolvedValueOnce({ id: "violation-1", status: "IN_REVIEW", propertyId: "prop-1", violationType: "Lawn" });
    findUniqueOrThrowViolation.mockResolvedValueOnce({ id: "violation-1", status: "RESOLVED", violationType: "Lawn" });
    const { transitionViolationStatus } = await import("../violations");

    await transitionViolationStatus({
      organizationId: "org-1",
      violationId: "violation-1",
      toStatus: "RESOLVED",
      resolutionNotes: "Owner mowed the lawn, confirmed by site visit.",
      actorUserId: "officer-1",
    });

    expect(updateManyViolation).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "RESOLVED", resolvedAt: expect.any(Date), resolutionNotes: "Owner mowed the lawn, confirmed by site visit." }),
      })
    );
  });

  it("rejects an invalid transition and never writes anything", async () => {
    findFirstViolation.mockResolvedValueOnce({ id: "violation-1", status: "DRAFT", propertyId: "prop-1", violationType: "Lawn" });
    const { transitionViolationStatus } = await import("../violations");

    await expect(
      transitionViolationStatus({ organizationId: "org-1", violationId: "violation-1", toStatus: "RESOLVED", actorUserId: "officer-1" })
    ).rejects.toMatchObject({ code: "HOA_VIOLATION_INVALID_TRANSITION" });
    expect(updateManyViolation).not.toHaveBeenCalled();
    expect(createViolationStatusHistory).not.toHaveBeenCalled();
  });

  it("rejects with HOA_VIOLATION_STALE_UPDATE when two requests race on the same violation (compare-and-swap lost)", async () => {
    findFirstViolation.mockResolvedValueOnce({ id: "violation-1", status: "ISSUED", propertyId: "prop-1", violationType: "Lawn" });
    updateManyViolation.mockResolvedValueOnce({ count: 0 });
    const { transitionViolationStatus } = await import("../violations");

    await expect(
      transitionViolationStatus({ organizationId: "org-1", violationId: "violation-1", toStatus: "DISMISSED", actorUserId: "officer-1" })
    ).rejects.toMatchObject({ code: "HOA_VIOLATION_STALE_UPDATE" });
    // Lost the race -- must not record a second, now-inconsistent history row.
    expect(createViolationStatusHistory).not.toHaveBeenCalled();
  });

  it("uses a conditional updateMany (compare-and-swap), not an unconditional update, so a lost race cannot silently overwrite a concurrent write", async () => {
    findFirstViolation.mockResolvedValueOnce({ id: "violation-1", status: "ISSUED", propertyId: "prop-1", violationType: "Lawn" });
    findUniqueOrThrowViolation.mockResolvedValueOnce({ id: "violation-1", status: "ACKNOWLEDGED", violationType: "Lawn" });
    const { transitionViolationStatus } = await import("../violations");

    await transitionViolationStatus({ organizationId: "org-1", violationId: "violation-1", toStatus: "ACKNOWLEDGED", actorUserId: "officer-1" });

    // The WHERE clause must repeat the expected starting status -- this is
    // what makes it a compare-and-swap rather than a blind overwrite.
    expect(updateManyViolation).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "violation-1", organizationId: "org-1", status: "ISSUED" } })
    );
  });
});

describe("addViolationComment", () => {
  it("creates a private-by-default comment", async () => {
    findFirstViolation.mockResolvedValueOnce({ id: "violation-1" });
    const { addViolationComment } = await import("../violations");

    await addViolationComment({ organizationId: "org-1", violationId: "violation-1", body: "Called owner, no answer.", isPrivate: true, actorUserId: "officer-1" });

    expect(createViolationComment).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isPrivate: true, body: "Called owner, no answer." }) })
    );
  });

  it("rejects a comment on a violation that doesn't exist in this organization", async () => {
    findFirstViolation.mockResolvedValueOnce(null);
    const { addViolationComment } = await import("../violations");

    await expect(
      addViolationComment({ organizationId: "org-1", violationId: "violation-x", body: "x", isPrivate: true, actorUserId: "officer-1" })
    ).rejects.toMatchObject({ code: "HOA_VIOLATION_NOT_FOUND" });
  });
});

describe("toResidentSafeViolation", () => {
  it("never includes resolutionNotes and filters out private comments", async () => {
    const { toResidentSafeViolation } = await import("../violations");

    const safe = toResidentSafeViolation({
      id: "violation-1",
      propertyId: "prop-1",
      violationType: "Lawn",
      description: "Overgrown",
      status: "RESOLVED",
      issuedAt: new Date(),
      cureByDate: new Date(),
      resolvedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      comments: [
        { id: "c1", body: "Internal note about the resident's tone on the phone", isPrivate: true, createdAt: new Date() },
        { id: "c2", body: "Thanks for fixing this so quickly!", isPrivate: false, createdAt: new Date() },
      ],
    });

    expect(safe).not.toHaveProperty("resolutionNotes");
    expect(safe.comments).toHaveLength(1);
    expect(safe.comments[0].id).toBe("c2");
  });
});

describe("sendDeadlineReminders", () => {
  const DUE_VIOLATION = {
    id: "violation-1",
    organizationId: "org-1",
    propertyId: "prop-1",
    violationType: "Lawn",
    cureByDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
  };
  const ACTIVE_RESIDENT = {
    orgMember: { id: "member-1", userId: "user-1", email: "resident@example.org", commsEmailEnabled: true, commsPushEnabled: false },
  };

  it("claims a reminder-log row per recipient, sends to them, and records one DEADLINE_REMINDER notice", async () => {
    findManyViolation.mockResolvedValueOnce([DUE_VIOLATION]);
    findManyPropertyResident.mockResolvedValueOnce([ACTIVE_RESIDENT]);

    const { sendDeadlineReminders } = await import("../violations");
    const result = await sendDeadlineReminders();

    expect(result.remindersSent).toBe(1);
    expect(createViolationReminderLog).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ violationId: "violation-1", orgMemberId: "member-1", reminderType: "DEADLINE_REMINDER" }),
      })
    );
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "resident@example.org" }));
    expect(createViolationNotice).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ noticeType: "DEADLINE_REMINDER" }) })
    );
  });

  it("E2E-1 finding: never claims the notice or resolves residents, and audit-logs a block, when the organization's billing is inactive -- and the violation is naturally reconsidered on a later tick (no claim burned)", async () => {
    findManyViolation.mockResolvedValueOnce([DUE_VIOLATION]);
    resolveOrganizationAccess.mockResolvedValueOnce({ allowed: false, reason: "TRIAL_EXPIRED", trialEndsAt: null, subscriptionStatus: null, billingExempt: false });

    const { sendDeadlineReminders } = await import("../violations");
    const result = await sendDeadlineReminders();

    expect(result.remindersSent).toBe(0);
    expect(createViolationNotice).not.toHaveBeenCalled();
    expect(findManyPropertyResident).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", action: "hoa_violation_reminder.blocked" })
    );
  });

  it("skips a recipient whose reminder-log claim loses to a unique-constraint conflict, without sending or double-counting", async () => {
    findManyViolation.mockResolvedValueOnce([DUE_VIOLATION]);
    findManyPropertyResident.mockResolvedValueOnce([ACTIVE_RESIDENT]);
    createViolationReminderLog.mockRejectedValueOnce(p2002(["violationId", "orgMemberId", "reminderType", "dueOffsetDays"]));

    const { sendDeadlineReminders } = await import("../violations");
    const result = await sendDeadlineReminders();

    // The violation-level notice claim still succeeds (this run legitimately
    // won that), but with the one recipient's own claim lost, nobody was
    // actually notified, so the run doesn't count as having sent a reminder.
    expect(result.remindersSent).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("skips the entire violation -- no resident resolution, no per-recipient claims -- when the violation-level notice claim itself loses to a concurrent run", async () => {
    findManyViolation.mockResolvedValueOnce([DUE_VIOLATION]);
    createViolationNotice.mockRejectedValueOnce(p2002(["violationId", "noticeType", "dueOffsetDays"]));

    const { sendDeadlineReminders } = await import("../violations");
    const result = await sendDeadlineReminders();

    // This is the fix for the real defect an independent review found: two
    // concurrent runs that each won a *different* recipient's claim used to
    // each independently write their own ViolationNotice, duplicating the
    // resident-visible audit trail. Now only the run that wins this
    // violation-level claim ever resolves residents or attempts a send.
    expect(result.remindersSent).toBe(0);
    expect(findManyPropertyResident).not.toHaveBeenCalled();
    expect(createViolationReminderLog).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("still notifies the recipients who successfully claim even when another recipient on the same violation loses the race", async () => {
    const secondResident = {
      orgMember: { id: "member-2", userId: "user-2", email: "other@example.org", commsEmailEnabled: true, commsPushEnabled: false },
    };
    findManyViolation.mockResolvedValueOnce([DUE_VIOLATION]);
    findManyPropertyResident.mockResolvedValueOnce([ACTIVE_RESIDENT, secondResident]);
    createViolationReminderLog
      .mockRejectedValueOnce(p2002(["violationId", "orgMemberId", "reminderType", "dueOffsetDays"]))
      .mockResolvedValueOnce({ id: "reminder-log-2" });

    const { sendDeadlineReminders } = await import("../violations");
    const result = await sendDeadlineReminders();

    expect(result.remindersSent).toBe(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "other@example.org" }));
  });

  it("does not fail the reminder run when a claimed recipient's notification delivery throws", async () => {
    findManyViolation.mockResolvedValueOnce([DUE_VIOLATION]);
    findManyPropertyResident.mockResolvedValueOnce([ACTIVE_RESIDENT]);
    sendEmail.mockRejectedValueOnce(new Error("SMTP provider outage"));

    const { sendDeadlineReminders } = await import("../violations");
    const result = await sendDeadlineReminders();

    // The claim already committed before delivery was attempted, so this
    // still counts as "reminded" for this offset -- a transient failure
    // gets a fresh dueOffsetDays (and therefore a fresh chance) tomorrow
    // rather than being retried in a loop within this run.
    expect(result.remindersSent).toBe(1);
    expect(createViolationNotice).toHaveBeenCalled();
  });

  it("does not claim any per-recipient reminder log rows when a due violation has no ACTIVE residents", async () => {
    findManyViolation.mockResolvedValueOnce([DUE_VIOLATION]);
    findManyPropertyResident.mockResolvedValueOnce([]);

    const { sendDeadlineReminders } = await import("../violations");
    const result = await sendDeadlineReminders();

    expect(result.remindersSent).toBe(0);
    expect(createViolationReminderLog).not.toHaveBeenCalled();
  });

  it("returns zero without resolving residents when nothing is due soon", async () => {
    findManyViolation.mockResolvedValueOnce([]);
    const { sendDeadlineReminders } = await import("../violations");

    const result = await sendDeadlineReminders();

    expect(result.remindersSent).toBe(0);
    expect(findManyPropertyResident).not.toHaveBeenCalled();
  });

  it("excludes CURED, RESOLVED, and DISMISSED violations from the due-soon query", async () => {
    findManyViolation.mockResolvedValueOnce([]);
    const { sendDeadlineReminders } = await import("../violations");
    await sendDeadlineReminders();

    expect(findManyViolation).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: { in: ["ISSUED", "ACKNOWLEDGED", "IN_REVIEW"] } }) })
    );
  });
});
