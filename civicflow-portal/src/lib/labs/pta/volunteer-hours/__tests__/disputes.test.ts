import { beforeEach, describe, expect, it, vi } from "vitest";

const createDispute = vi.fn();
const findManyDisputes = vi.fn();
const findFirstDispute = vi.fn();
const updateDispute = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaVolunteerHourDispute: {
      create: (...a: unknown[]) => createDispute(...a),
      findMany: (...a: unknown[]) => findManyDisputes(...a),
      findFirst: (...a: unknown[]) => findFirstDispute(...a),
      update: (...a: unknown[]) => updateDispute(...a),
    },
  },
}));

const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...a: unknown[]) => createAuditEvent(...a) }));

beforeEach(() => vi.clearAllMocks());

describe("createHourDispute", () => {
  it("rejects a blank description", async () => {
    const { createHourDispute } = await import("../disputes");
    await expect(createHourDispute("org-1", "period-1", "hh-1", "   ", "u1")).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
    expect(createDispute).not.toHaveBeenCalled();
  });

  it("creates an OPEN dispute and writes an audit event", async () => {
    createDispute.mockResolvedValue({ id: "dispute-1", status: "OPEN" });
    const { createHourDispute } = await import("../disputes");
    await createHourDispute("org-1", "period-1", "hh-1", "Missing my Saturday bake-sale shift", "u1");
    expect(createDispute).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ organizationId: "org-1", householdId: "hh-1" }) })
    );
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "pta.volunteer_hours.dispute_submitted" }));
  });
});

describe("resolveHourDispute", () => {
  it("throws when the dispute doesn't belong to this organization", async () => {
    findFirstDispute.mockResolvedValue(null);
    const { resolveHourDispute } = await import("../disputes");
    await expect(resolveHourDispute("org-1", "dispute-1", "RESOLVED", null, "u1")).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });

  it("stamps resolvedByUserId/resolvedAt and writes an audit event", async () => {
    findFirstDispute.mockResolvedValue({ id: "dispute-1" });
    updateDispute.mockResolvedValue({ id: "dispute-1", status: "RESOLVED" });
    const { resolveHourDispute } = await import("../disputes");
    await resolveHourDispute("org-1", "dispute-1", "RESOLVED", "Verified via sign-in sheet", "officer-1");
    expect(updateDispute).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "RESOLVED", resolvedByUserId: "officer-1", adminNotes: "Verified via sign-in sheet" }),
      })
    );
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "pta.volunteer_hours.dispute_resolved" }));
  });
});
