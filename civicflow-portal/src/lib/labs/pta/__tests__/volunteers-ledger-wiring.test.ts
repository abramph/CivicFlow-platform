import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstHourEntry = vi.fn();
const updateHourEntry = vi.fn();
const createHourEntry = vi.fn();
const createHourAdjustment = vi.fn();
const findFirstAdult = vi.fn();
const findFirstSignup = vi.fn();
const updateSignup = vi.fn();
const upsertAttendance = vi.fn();
const updateAttendance = vi.fn();
const findUniqueOpportunity = vi.fn();
const transactionMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (arg: unknown) => transactionMock(arg),
    ptaVolunteerHourEntry: {
      findFirst: (...a: unknown[]) => findFirstHourEntry(...a),
      update: (...a: unknown[]) => updateHourEntry(...a),
      create: (...a: unknown[]) => createHourEntry(...a),
    },
    ptaVolunteerHourAdjustment: { create: (...a: unknown[]) => createHourAdjustment(...a) },
    ptaHouseholdAdult: { findFirst: (...a: unknown[]) => findFirstAdult(...a) },
    ptaVolunteerSignup: {
      findFirst: (...a: unknown[]) => findFirstSignup(...a),
      update: (...a: unknown[]) => updateSignup(...a),
    },
    ptaVolunteerAttendance: {
      upsert: (...a: unknown[]) => upsertAttendance(...a),
      update: (...a: unknown[]) => updateAttendance(...a),
    },
    ptaVolunteerOpportunity: { findUnique: (...a: unknown[]) => findUniqueOpportunity(...a) },
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));

const isPtaVolunteerHoursPlatformEnabled = vi.fn();
vi.mock("@/lib/env", () => ({ isPtaVolunteerHoursPlatformEnabled: () => isPtaVolunteerHoursPlatformEnabled() }));

const getPtaProfile = vi.fn();
vi.mock("../profile", () => ({ getPtaProfile: (...a: unknown[]) => getPtaProfile(...a) }));

const mirrorHourEntryApprovalToLedger = vi.fn().mockResolvedValue(null);
const mirrorHourEntryAdjustmentToLedger = vi.fn().mockResolvedValue(null);
const mirrorHourEntryPendingToLedger = vi.fn().mockResolvedValue(null);
const mirrorHourEntryRejectionToLedger = vi.fn().mockResolvedValue(null);
vi.mock("../volunteer-hours/ledger", () => ({
  mirrorHourEntryApprovalToLedger: (...a: unknown[]) => mirrorHourEntryApprovalToLedger(...a),
  mirrorHourEntryAdjustmentToLedger: (...a: unknown[]) => mirrorHourEntryAdjustmentToLedger(...a),
  mirrorHourEntryPendingToLedger: (...a: unknown[]) => mirrorHourEntryPendingToLedger(...a),
  mirrorHourEntryRejectionToLedger: (...a: unknown[]) => mirrorHourEntryRejectionToLedger(...a),
}));

beforeEach(() => {
  vi.clearAllMocks();
  transactionMock.mockImplementation(async (arg: unknown) => (Array.isArray(arg) ? Promise.all(arg) : undefined));
  findFirstAdult.mockResolvedValue({ userId: "someone-else" });
});

describe("approvePtaVolunteerHourEntry — ledger mirroring wiring", () => {
  const pendingEntry = { id: "he-1", status: "PENDING", householdAdultId: "adult-1", creditedMinutes: 60, category: null, opportunityId: "opp-1" };

  it("never touches PtaProfile when the platform kill-switch is off — pure early return", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(false);
    findFirstHourEntry.mockResolvedValue(pendingEntry);
    updateHourEntry.mockResolvedValue({ ...pendingEntry, status: "APPROVED" });

    const { approvePtaVolunteerHourEntry } = await import("../volunteers");
    await approvePtaVolunteerHourEntry("org-1", "he-1", "actor-1");

    expect(getPtaProfile).not.toHaveBeenCalled();
    expect(mirrorHourEntryApprovalToLedger).not.toHaveBeenCalled();
  });

  it("skips mirroring when the platform switch is on but the org's requirements flag is off", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(true);
    getPtaProfile.mockResolvedValue({ ptaVolunteerRequirementsEnabled: false });
    findFirstHourEntry.mockResolvedValue(pendingEntry);
    updateHourEntry.mockResolvedValue({ ...pendingEntry, status: "APPROVED" });

    const { approvePtaVolunteerHourEntry } = await import("../volunteers");
    await approvePtaVolunteerHourEntry("org-1", "he-1", "actor-1");

    expect(mirrorHourEntryApprovalToLedger).not.toHaveBeenCalled();
  });

  it("mirrors the approval when both the platform switch and the org flag are on", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(true);
    getPtaProfile.mockResolvedValue({ ptaVolunteerRequirementsEnabled: true });
    const approved = { ...pendingEntry, status: "APPROVED" };
    findFirstHourEntry.mockResolvedValue(pendingEntry);
    updateHourEntry.mockResolvedValue(approved);

    const { approvePtaVolunteerHourEntry } = await import("../volunteers");
    await approvePtaVolunteerHourEntry("org-1", "he-1", "actor-1");

    expect(mirrorHourEntryApprovalToLedger).toHaveBeenCalledWith("org-1", approved);
  });

  it("the primary approval still succeeds even when ledger mirroring throws — never blocks the real action", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(true);
    getPtaProfile.mockResolvedValue({ ptaVolunteerRequirementsEnabled: true });
    findFirstHourEntry.mockResolvedValue(pendingEntry);
    updateHourEntry.mockResolvedValue({ ...pendingEntry, status: "APPROVED" });
    mirrorHourEntryApprovalToLedger.mockRejectedValueOnce(new Error("ledger boom"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { approvePtaVolunteerHourEntry } = await import("../volunteers");
    const result = await approvePtaVolunteerHourEntry("org-1", "he-1", "actor-1");

    expect(result.status).toBe("APPROVED");
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("adjustPtaVolunteerHourEntry — ledger mirroring wiring", () => {
  const approvedEntry = { id: "he-1", status: "APPROVED", householdAdultId: "adult-1", creditedMinutes: 120, category: "FUNDRAISING" };

  it("mirrors the adjustment with the created adjustment row's id when enabled", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(true);
    getPtaProfile.mockResolvedValue({ ptaVolunteerRequirementsEnabled: true });
    findFirstHourEntry.mockResolvedValue(approvedEntry);
    const updatedEntry = { ...approvedEntry, creditedMinutes: 150 };
    const createdAdjustment = { id: "adj-1", minuteAdjustment: 30, reason: "corrected shift length", actorUserId: "actor-1" };
    updateHourEntry.mockResolvedValue(updatedEntry);
    createHourAdjustment.mockResolvedValue(createdAdjustment);

    const { adjustPtaVolunteerHourEntry } = await import("../volunteers");
    await adjustPtaVolunteerHourEntry("org-1", "he-1", 30, "corrected shift length", "actor-1");

    expect(mirrorHourEntryAdjustmentToLedger).toHaveBeenCalledWith("org-1", createdAdjustment, updatedEntry);
  });

  it("skips mirroring when disabled", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(false);
    findFirstHourEntry.mockResolvedValue(approvedEntry);
    updateHourEntry.mockResolvedValue({ ...approvedEntry, creditedMinutes: 150 });
    createHourAdjustment.mockResolvedValue({ id: "adj-1" });

    const { adjustPtaVolunteerHourEntry } = await import("../volunteers");
    await adjustPtaVolunteerHourEntry("org-1", "he-1", 30, "corrected shift length", "actor-1");

    expect(mirrorHourEntryAdjustmentToLedger).not.toHaveBeenCalled();
  });
});

describe("setPtaVolunteerAttendanceStatus — pending ledger mirroring wiring (VH-L follow-up)", () => {
  const signup = {
    id: "signup-1",
    householdAdultId: "adult-1",
    householdId: "hh-1",
    slotId: "slot-1",
    slot: { startAt: null, endAt: null, defaultCreditedMinutes: 60, opportunityId: "opp-1" },
  };
  const attendance = { id: "att-1", checkInAt: null, checkOutAt: null, officerNotes: null };
  const createdEntry = { id: "he-new", householdId: "hh-1", householdAdultId: "adult-1", creditedMinutes: 60, category: null, opportunityId: "opp-1" };

  beforeEach(() => {
    findFirstSignup.mockResolvedValue(signup);
    upsertAttendance.mockResolvedValue(attendance);
    updateAttendance.mockResolvedValue(attendance);
    updateSignup.mockResolvedValue({ ...signup, status: "ATTENDED" });
    findUniqueOpportunity.mockResolvedValue({ schoolYear: "2026-2027" });
    createHourEntry.mockResolvedValue(createdEntry);
  });

  it("mirrors the freshly-created PENDING entry when enabled", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(true);
    getPtaProfile.mockResolvedValue({ ptaVolunteerRequirementsEnabled: true });

    const { setPtaVolunteerAttendanceStatus } = await import("../volunteers");
    await setPtaVolunteerAttendanceStatus("org-1", "signup-1", "ATTENDED", "actor-1");

    expect(mirrorHourEntryPendingToLedger).toHaveBeenCalledWith("org-1", createdEntry);
  });

  it("never mirrors when disabled", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(false);

    const { setPtaVolunteerAttendanceStatus } = await import("../volunteers");
    await setPtaVolunteerAttendanceStatus("org-1", "signup-1", "ATTENDED", "actor-1");

    expect(mirrorHourEntryPendingToLedger).not.toHaveBeenCalled();
  });

  it("never mirrors for NO_SHOW/EXCUSED — no hour entry is ever created for those outcomes", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(true);
    getPtaProfile.mockResolvedValue({ ptaVolunteerRequirementsEnabled: true });

    const { setPtaVolunteerAttendanceStatus } = await import("../volunteers");
    await setPtaVolunteerAttendanceStatus("org-1", "signup-1", "NO_SHOW", "actor-1");

    expect(createHourEntry).not.toHaveBeenCalled();
    expect(mirrorHourEntryPendingToLedger).not.toHaveBeenCalled();
  });

  it("the real attendance/hour-entry creation still succeeds even when pending mirroring throws", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(true);
    getPtaProfile.mockResolvedValue({ ptaVolunteerRequirementsEnabled: true });
    mirrorHourEntryPendingToLedger.mockRejectedValueOnce(new Error("ledger boom"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { setPtaVolunteerAttendanceStatus } = await import("../volunteers");
    const result = await setPtaVolunteerAttendanceStatus("org-1", "signup-1", "ATTENDED", "actor-1");

    expect(result.hourEntry?.id).toBe("he-new");
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("rejectPtaVolunteerHourEntry — ledger mirroring wiring (VH-L follow-up)", () => {
  const pendingEntry = { id: "he-1", status: "PENDING", householdId: "hh-1", householdAdultId: "adult-1", creditedMinutes: 60, category: null, opportunityId: "opp-1" };

  it("mirrors the rejection when enabled", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(true);
    getPtaProfile.mockResolvedValue({ ptaVolunteerRequirementsEnabled: true });
    const rejected = { ...pendingEntry, status: "REJECTED", rejectedByUserId: "actor-1" };
    findFirstHourEntry.mockResolvedValue(pendingEntry);
    updateHourEntry.mockResolvedValue(rejected);

    const { rejectPtaVolunteerHourEntry } = await import("../volunteers");
    await rejectPtaVolunteerHourEntry("org-1", "he-1", "no longer eligible", "actor-1");

    expect(mirrorHourEntryRejectionToLedger).toHaveBeenCalledWith("org-1", rejected);
  });

  it("never mirrors when disabled", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(false);
    findFirstHourEntry.mockResolvedValue(pendingEntry);
    updateHourEntry.mockResolvedValue({ ...pendingEntry, status: "REJECTED" });

    const { rejectPtaVolunteerHourEntry } = await import("../volunteers");
    await rejectPtaVolunteerHourEntry("org-1", "he-1", "no longer eligible", "actor-1");

    expect(mirrorHourEntryRejectionToLedger).not.toHaveBeenCalled();
  });

  it("the real rejection still succeeds even when ledger mirroring throws", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(true);
    getPtaProfile.mockResolvedValue({ ptaVolunteerRequirementsEnabled: true });
    findFirstHourEntry.mockResolvedValue(pendingEntry);
    updateHourEntry.mockResolvedValue({ ...pendingEntry, status: "REJECTED" });
    mirrorHourEntryRejectionToLedger.mockRejectedValueOnce(new Error("ledger boom"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { rejectPtaVolunteerHourEntry } = await import("../volunteers");
    const result = await rejectPtaVolunteerHourEntry("org-1", "he-1", "no longer eligible", "actor-1");

    expect(result.status).toBe("REJECTED");
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
