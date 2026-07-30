import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstSignup = vi.fn();
const findUniqueOpportunity = vi.fn();
const upsertAttendance = vi.fn();
const findUniqueOrThrowAttendance = vi.fn();
const updateManyAttendance = vi.fn();
const transactionMock = vi.fn();
const createHourEntry = vi.fn();
const findFirstHourEntry = vi.fn();
const updateHourEntry = vi.fn();
const createHourAdjustment = vi.fn();
const findFirstAdult = vi.fn();
const aggregateHourEntry = vi.fn();
const findUniqueRequirement = vi.fn();
const upsertRequirement = vi.fn();
const findFirstOpportunity = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (arg: unknown) => transactionMock(arg),
    ptaVolunteerSignup: {
      findFirst: (...a: unknown[]) => findFirstSignup(...a),
      update: vi.fn(),
    },
    ptaVolunteerOpportunity: {
      findUnique: (...a: unknown[]) => findUniqueOpportunity(...a),
      findFirst: (...a: unknown[]) => findFirstOpportunity(...a),
    },
    ptaVolunteerAttendance: {
      upsert: (...a: unknown[]) => upsertAttendance(...a),
      findUniqueOrThrow: (...a: unknown[]) => findUniqueOrThrowAttendance(...a),
      updateMany: (...a: unknown[]) => updateManyAttendance(...a),
      update: vi.fn(),
    },
    ptaVolunteerHourEntry: {
      create: (...a: unknown[]) => createHourEntry(...a),
      findFirst: (...a: unknown[]) => findFirstHourEntry(...a),
      update: (...a: unknown[]) => updateHourEntry(...a),
      aggregate: (...a: unknown[]) => aggregateHourEntry(...a),
    },
    ptaVolunteerHourAdjustment: { create: (...a: unknown[]) => createHourAdjustment(...a) },
    ptaHouseholdAdult: { findFirst: (...a: unknown[]) => findFirstAdult(...a) },
    ptaVolunteerRequirement: {
      findUnique: (...a: unknown[]) => findUniqueRequirement(...a),
      upsert: (...a: unknown[]) => upsertRequirement(...a),
    },
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@prisma/client", () => ({
  Prisma: { PrismaClientKnownRequestError: class extends Error {} },
}));

beforeEach(() => {
  vi.clearAllMocks();
  transactionMock.mockImplementation(async (arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg);
    return undefined;
  });
});

describe("setPtaVolunteerAttendanceStatus — hour-entry generation precedence", () => {
  const baseSignup = {
    id: "signup-1",
    organizationId: "org-a",
    householdAdultId: "adult-1",
    householdId: "household-1",
    slotId: "slot-1",
    slot: { id: "slot-1", opportunityId: "opp-1", startAt: new Date("2026-09-01T09:00:00Z"), endAt: new Date("2026-09-01T11:00:00Z"), defaultCreditedMinutes: 90 },
  };

  it("never generates an hour entry for NO_SHOW", async () => {
    findFirstSignup.mockResolvedValue(baseSignup);
    upsertAttendance.mockResolvedValueOnce({ id: "att-1", checkInAt: null, checkOutAt: null, officerNotes: null });

    const { setPtaVolunteerAttendanceStatus } = await import("../volunteers");
    const result = await setPtaVolunteerAttendanceStatus("org-a", "signup-1", "NO_SHOW", "officer-1");

    expect(result.hourEntry).toBeNull();
    expect(createHourEntry).not.toHaveBeenCalled();
  });

  it("never generates an hour entry for EXCUSED", async () => {
    findFirstSignup.mockResolvedValue(baseSignup);
    upsertAttendance.mockResolvedValueOnce({ id: "att-1", checkInAt: null, checkOutAt: null, officerNotes: null });

    const { setPtaVolunteerAttendanceStatus } = await import("../volunteers");
    const result = await setPtaVolunteerAttendanceStatus("org-a", "signup-1", "EXCUSED", "officer-1");

    expect(result.hourEntry).toBeNull();
    expect(createHourEntry).not.toHaveBeenCalled();
  });

  it("prefers explicit manual minutes over everything else, even when actual check-in/out times exist", async () => {
    findFirstSignup.mockResolvedValue(baseSignup);
    upsertAttendance.mockResolvedValueOnce({
      id: "att-1",
      checkInAt: new Date("2026-09-01T09:00:00Z"),
      checkOutAt: new Date("2026-09-01T09:30:00Z"), // 30 real minutes
      officerNotes: null,
    });
    findUniqueOpportunity.mockResolvedValueOnce({ schoolYear: "2026-2027" });
    createHourEntry.mockResolvedValueOnce({ id: "entry-1", creditedMinutes: 45 });

    const { setPtaVolunteerAttendanceStatus } = await import("../volunteers");
    await setPtaVolunteerAttendanceStatus("org-a", "signup-1", "ATTENDED", "officer-1", { manualMinutes: 45 });

    expect(createHourEntry).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ creditedMinutes: 45 }) }));
  });

  it("falls back to actual check-in/check-out duration when no manual minutes are given", async () => {
    findFirstSignup.mockResolvedValue(baseSignup);
    upsertAttendance.mockResolvedValueOnce({
      id: "att-1",
      checkInAt: new Date("2026-09-01T09:00:00Z"),
      checkOutAt: new Date("2026-09-01T10:15:00Z"), // 75 real minutes, vs. 120 scheduled
      officerNotes: null,
    });
    findUniqueOpportunity.mockResolvedValueOnce({ schoolYear: "2026-2027" });
    createHourEntry.mockResolvedValueOnce({ id: "entry-1", creditedMinutes: 75 });

    const { setPtaVolunteerAttendanceStatus } = await import("../volunteers");
    await setPtaVolunteerAttendanceStatus("org-a", "signup-1", "ATTENDED", "officer-1");

    expect(createHourEntry).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ creditedMinutes: 75 }) }));
  });

  it("falls back to the shift's own scheduled duration when there's no check-in/out at all", async () => {
    findFirstSignup.mockResolvedValue(baseSignup);
    upsertAttendance.mockResolvedValueOnce({ id: "att-1", checkInAt: null, checkOutAt: null, officerNotes: null });
    findUniqueOpportunity.mockResolvedValueOnce({ schoolYear: "2026-2027" });
    createHourEntry.mockResolvedValueOnce({ id: "entry-1", creditedMinutes: 120 });

    const { setPtaVolunteerAttendanceStatus } = await import("../volunteers");
    await setPtaVolunteerAttendanceStatus("org-a", "signup-1", "ATTENDED", "officer-1");

    // 09:00-11:00 scheduled = 120 minutes
    expect(createHourEntry).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ creditedMinutes: 120 }) }));
  });

  it("falls back to the slot's own defaultCreditedMinutes only when neither actual nor scheduled times exist", async () => {
    findFirstSignup.mockResolvedValue({ ...baseSignup, slot: { ...baseSignup.slot, startAt: null, endAt: null } });
    upsertAttendance.mockResolvedValueOnce({ id: "att-1", checkInAt: null, checkOutAt: null, officerNotes: null });
    findUniqueOpportunity.mockResolvedValueOnce({ schoolYear: "2026-2027" });
    createHourEntry.mockResolvedValueOnce({ id: "entry-1", creditedMinutes: 90 });

    const { setPtaVolunteerAttendanceStatus } = await import("../volunteers");
    await setPtaVolunteerAttendanceStatus("org-a", "signup-1", "ATTENDED", "officer-1");

    expect(createHourEntry).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ creditedMinutes: 90 }) }));
  });

  it("never fabricates negative credited minutes even if a check-out somehow precedes check-in in stored data", async () => {
    findFirstSignup.mockResolvedValue(baseSignup);
    upsertAttendance.mockResolvedValueOnce({
      id: "att-1",
      checkInAt: new Date("2026-09-01T11:00:00Z"),
      checkOutAt: new Date("2026-09-01T09:00:00Z"),
      officerNotes: null,
    });
    findUniqueOpportunity.mockResolvedValueOnce({ schoolYear: "2026-2027" });
    createHourEntry.mockResolvedValueOnce({ id: "entry-1", creditedMinutes: 0 });

    const { setPtaVolunteerAttendanceStatus } = await import("../volunteers");
    await setPtaVolunteerAttendanceStatus("org-a", "signup-1", "ATTENDED", "officer-1");

    expect(createHourEntry).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ creditedMinutes: 0 }) }));
  });
});

describe("approvePtaVolunteerHourEntry — self-approval and finalization guards", () => {
  it("refuses an officer approving their own volunteer hours", async () => {
    findFirstHourEntry.mockResolvedValueOnce({ id: "entry-1", organizationId: "org-a", status: "PENDING", householdAdultId: "adult-1", creditedMinutes: 60 });
    findFirstAdult.mockResolvedValueOnce({ userId: "officer-1" }); // the entry's own volunteer IS this officer

    const { approvePtaVolunteerHourEntry } = await import("../volunteers");
    await expect(approvePtaVolunteerHourEntry("org-a", "entry-1", "officer-1")).rejects.toMatchObject({ code: "PTA_SELF_APPROVAL_FORBIDDEN" });
    expect(updateHourEntry).not.toHaveBeenCalled();
  });

  it("allows a different officer to approve", async () => {
    findFirstHourEntry.mockResolvedValueOnce({ id: "entry-1", organizationId: "org-a", status: "PENDING", householdAdultId: "adult-1", creditedMinutes: 60 });
    findFirstAdult.mockResolvedValueOnce({ userId: "some-other-parent" });
    updateHourEntry.mockResolvedValueOnce({ id: "entry-1", status: "APPROVED", creditedMinutes: 60 });

    const { approvePtaVolunteerHourEntry } = await import("../volunteers");
    await expect(approvePtaVolunteerHourEntry("org-a", "entry-1", "officer-1")).resolves.toMatchObject({ status: "APPROVED" });
  });

  it("refuses to approve an entry that's already been finalized", async () => {
    findFirstHourEntry.mockResolvedValueOnce({ id: "entry-1", organizationId: "org-a", status: "APPROVED", householdAdultId: "adult-1", creditedMinutes: 60 });

    const { approvePtaVolunteerHourEntry } = await import("../volunteers");
    await expect(approvePtaVolunteerHourEntry("org-a", "entry-1", "officer-1")).rejects.toMatchObject({ code: "PTA_HOUR_ENTRY_ALREADY_FINALIZED" });
  });

  it("rejects an entry with a required reason", async () => {
    findFirstHourEntry.mockResolvedValue({ id: "entry-1", organizationId: "org-a", status: "PENDING" });
    updateHourEntry.mockResolvedValueOnce({ id: "entry-1", status: "REJECTED" });

    const { rejectPtaVolunteerHourEntry } = await import("../volunteers");
    await expect(rejectPtaVolunteerHourEntry("org-a", "entry-1", "", "officer-1")).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
    await expect(rejectPtaVolunteerHourEntry("org-a", "entry-1", "Not enough detail provided", "officer-1")).resolves.toMatchObject({ status: "REJECTED" });
  });

  it("only allows adjusting an already-APPROVED entry, and records an immutable adjustment row", async () => {
    findFirstHourEntry.mockResolvedValueOnce({ id: "entry-1", organizationId: "org-a", status: "PENDING", creditedMinutes: 60 });
    const { adjustPtaVolunteerHourEntry } = await import("../volunteers");
    await expect(adjustPtaVolunteerHourEntry("org-a", "entry-1", 15, "correction", "officer-1")).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });

    findFirstHourEntry.mockResolvedValueOnce({ id: "entry-1", organizationId: "org-a", status: "APPROVED", creditedMinutes: 60 });
    updateHourEntry.mockResolvedValueOnce({ id: "entry-1", creditedMinutes: 75 });
    createHourAdjustment.mockResolvedValueOnce({ id: "adj-1" });

    await adjustPtaVolunteerHourEntry("org-a", "entry-1", 15, "correction", "officer-1");
    expect(createHourAdjustment).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ hourEntryId: "entry-1", minuteAdjustment: 15, reason: "correction" }) }));
  });
});

describe("getPtaVolunteerHourTotalsForHousehold — requirement absence is 'not configured', never zero", () => {
  it("returns null requiredMinutes/remainingMinutes when no requirement row exists at all", async () => {
    aggregateHourEntry.mockResolvedValueOnce({ _sum: { creditedMinutes: 120 } }); // approved
    aggregateHourEntry.mockResolvedValueOnce({ _sum: { creditedMinutes: 0 } }); // pending
    findUniqueRequirement.mockResolvedValueOnce(null);

    const { getPtaVolunteerHourTotalsForHousehold } = await import("../volunteers");
    const totals = await getPtaVolunteerHourTotalsForHousehold("org-a", "household-1", "2026-2027");

    expect(totals.approvedMinutes).toBe(120);
    expect(totals.requiredMinutes).toBeNull();
    expect(totals.remainingMinutes).toBeNull();
  });

  it("treats an inactive requirement the same as no requirement", async () => {
    aggregateHourEntry.mockResolvedValueOnce({ _sum: { creditedMinutes: 60 } });
    aggregateHourEntry.mockResolvedValueOnce({ _sum: { creditedMinutes: 0 } });
    findUniqueRequirement.mockResolvedValueOnce({ requiredMinutes: 600, active: false });

    const { getPtaVolunteerHourTotalsForHousehold } = await import("../volunteers");
    const totals = await getPtaVolunteerHourTotalsForHousehold("org-a", "household-1", "2026-2027");

    expect(totals.requiredMinutes).toBeNull();
  });

  it("computes remaining minutes as the gap between required and approved, floored at zero", async () => {
    aggregateHourEntry.mockResolvedValueOnce({ _sum: { creditedMinutes: 700 } });
    aggregateHourEntry.mockResolvedValueOnce({ _sum: { creditedMinutes: 0 } });
    findUniqueRequirement.mockResolvedValueOnce({ requiredMinutes: 600, active: true });

    const { getPtaVolunteerHourTotalsForHousehold } = await import("../volunteers");
    const totals = await getPtaVolunteerHourTotalsForHousehold("org-a", "household-1", "2026-2027");

    expect(totals.remainingMinutes).toBe(0); // already exceeded the requirement, never negative
  });
});

describe("setPtaVolunteerOpportunityStatus — explicit transition table", () => {
  it("refuses to jump straight from DRAFT to COMPLETED", async () => {
    findFirstOpportunity.mockResolvedValueOnce({ id: "opp-1", organizationId: "org-a", status: "DRAFT" });
    const { setPtaVolunteerOpportunityStatus } = await import("../volunteers");
    await expect(setPtaVolunteerOpportunityStatus("org-a", "opp-1", "COMPLETED", "officer-1")).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });

  it("allows DRAFT to OPEN (publishing)", async () => {
    findFirstOpportunity.mockResolvedValueOnce({ id: "opp-1", organizationId: "org-a", status: "DRAFT" });
    const { prisma } = await import("@/lib/prisma");
    (prisma.ptaVolunteerOpportunity as unknown as { update: ReturnType<typeof vi.fn> }).update = vi.fn().mockResolvedValueOnce({ id: "opp-1", status: "OPEN" });
    const { setPtaVolunteerOpportunityStatus } = await import("../volunteers");
    await expect(setPtaVolunteerOpportunityStatus("org-a", "opp-1", "OPEN", "officer-1")).resolves.toMatchObject({ status: "OPEN" });
  });

  it("refuses any transition out of ARCHIVED — it's a terminal state", async () => {
    findFirstOpportunity.mockResolvedValueOnce({ id: "opp-1", organizationId: "org-a", status: "ARCHIVED" });
    const { setPtaVolunteerOpportunityStatus } = await import("../volunteers");
    await expect(setPtaVolunteerOpportunityStatus("org-a", "opp-1", "OPEN", "officer-1")).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });
});
