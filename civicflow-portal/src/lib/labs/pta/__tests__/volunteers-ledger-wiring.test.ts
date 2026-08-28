import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstHourEntry = vi.fn();
const updateHourEntry = vi.fn();
const createHourAdjustment = vi.fn();
const findFirstAdult = vi.fn();
const transactionMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (arg: unknown) => transactionMock(arg),
    ptaVolunteerHourEntry: {
      findFirst: (...a: unknown[]) => findFirstHourEntry(...a),
      update: (...a: unknown[]) => updateHourEntry(...a),
    },
    ptaVolunteerHourAdjustment: { create: (...a: unknown[]) => createHourAdjustment(...a) },
    ptaHouseholdAdult: { findFirst: (...a: unknown[]) => findFirstAdult(...a) },
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));

const isPtaVolunteerHoursPlatformEnabled = vi.fn();
vi.mock("@/lib/env", () => ({ isPtaVolunteerHoursPlatformEnabled: () => isPtaVolunteerHoursPlatformEnabled() }));

const getPtaProfile = vi.fn();
vi.mock("../profile", () => ({ getPtaProfile: (...a: unknown[]) => getPtaProfile(...a) }));

const mirrorHourEntryApprovalToLedger = vi.fn().mockResolvedValue(null);
const mirrorHourEntryAdjustmentToLedger = vi.fn().mockResolvedValue(null);
vi.mock("../volunteer-hours/ledger", () => ({
  mirrorHourEntryApprovalToLedger: (...a: unknown[]) => mirrorHourEntryApprovalToLedger(...a),
  mirrorHourEntryAdjustmentToLedger: (...a: unknown[]) => mirrorHourEntryAdjustmentToLedger(...a),
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
