import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyRequirements = vi.fn();
const findFirstRequirement = vi.fn();
const createRequirement = vi.fn();
const createManyRequirements = vi.fn();
const updateRequirement = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaComplianceRequirement: {
      findMany: (...a: unknown[]) => findManyRequirements(...a),
      findFirst: (...a: unknown[]) => findFirstRequirement(...a),
      create: (...a: unknown[]) => createRequirement(...a),
      createMany: (...a: unknown[]) => createManyRequirements(...a),
      update: (...a: unknown[]) => updateRequirement(...a),
    },
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

import {
  advanceDueDate,
  applySuggestedRequirements,
  completeComplianceRequirement,
  deriveComplianceStatus,
  SUGGESTED_REQUIREMENTS,
} from "@/lib/labs/pta/compliance";

const actor = { actorUserId: "u1", actorEmail: "officer@example.org" };
const NOW = new Date("2026-08-14T12:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("deriveComplianceStatus (§22 dashboard)", () => {
  it("derives all four states and never stores them", () => {
    expect(deriveComplianceStatus({ isApplicable: false, dueDate: new Date("2020-01-01") }, NOW)).toBe("NOT_APPLICABLE");
    expect(deriveComplianceStatus({ isApplicable: true, dueDate: new Date("2026-08-01") }, NOW)).toBe("OVERDUE");
    expect(deriveComplianceStatus({ isApplicable: true, dueDate: new Date("2026-09-01") }, NOW)).toBe("DUE_SOON");
    expect(deriveComplianceStatus({ isApplicable: true, dueDate: new Date("2026-12-01") }, NOW)).toBe("COMPLIANT");
    expect(deriveComplianceStatus({ isApplicable: true, dueDate: null }, NOW)).toBe("COMPLIANT");
  });
});

describe("recurrence", () => {
  it("advances by the interval; one-offs do not advance", () => {
    const due = new Date("2026-06-30T00:00:00Z");
    expect(advanceDueDate(due, "ANNUAL")?.toISOString()).toBe("2027-06-30T00:00:00.000Z");
    expect(advanceDueDate(due, "QUARTERLY")?.toISOString()).toBe("2026-09-30T00:00:00.000Z");
    expect(advanceDueDate(due, "MONTHLY")?.toISOString()).toBe("2026-07-30T00:00:00.000Z");
    expect(advanceDueDate(due, "NONE")).toBeNull();
  });

  it("completing stamps lastCompletedAt and advances a recurring due date", async () => {
    findFirstRequirement.mockResolvedValueOnce({
      id: "c1",
      title: "Insurance renewal",
      dueDate: new Date("2026-09-01T00:00:00Z"),
      recurrence: "ANNUAL",
    });
    updateRequirement.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "c1", ...args.data }));

    await completeComplianceRequirement({ organizationId: "org-1", requirementId: "c1", ...actor });

    const data = updateRequirement.mock.calls[0][0].data;
    expect(data.lastCompletedAt).toBeInstanceOf(Date);
    expect((data.dueDate as Date).toISOString()).toBe("2027-09-01T00:00:00.000Z");
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "pta.compliance.requirement_completed" }));
  });

  it("completing a one-off clears the due date", async () => {
    findFirstRequirement.mockResolvedValueOnce({ id: "c2", title: "One-time filing", dueDate: new Date("2026-09-01"), recurrence: "NONE" });
    updateRequirement.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "c2", ...args.data }));
    await completeComplianceRequirement({ organizationId: "org-1", requirementId: "c2", ...actor });
    expect(updateRequirement.mock.calls[0][0].data.dueDate).toBeNull();
  });
});

describe("suggestions (§22: never hard-coded as universal)", () => {
  it("applies only titles not already tracked, case-insensitively", async () => {
    findManyRequirements.mockResolvedValueOnce([{ title: "BYLAWS REVIEW" }, { title: "Tax filing (990/990-EZ/990-N)" }]);
    createManyRequirements.mockResolvedValueOnce({ count: SUGGESTED_REQUIREMENTS.length - 2 });

    await applySuggestedRequirements({ organizationId: "org-1", ...actor });

    const created = createManyRequirements.mock.calls[0][0].data as { title: string }[];
    expect(created).toHaveLength(SUGGESTED_REQUIREMENTS.length - 2);
    expect(created.map((row) => row.title)).not.toContain("Bylaws review");
  });
});

describe("tenant isolation", () => {
  it("requirements are always looked up scoped to the organization", async () => {
    findFirstRequirement.mockResolvedValueOnce(null);
    await expect(completeComplianceRequirement({ organizationId: "org-1", requirementId: "foreign", ...actor })).rejects.toMatchObject({
      code: "PTA_COMPLIANCE_NOT_FOUND",
    });
    expect(findFirstRequirement.mock.calls[0][0].where).toMatchObject({ id: "foreign", organizationId: "org-1" });
  });
});
