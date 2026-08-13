import { beforeEach, describe, expect, it, vi } from "vitest";

const upsertYear = vi.fn();
const findManyYears = vi.fn();
const findUniqueYear = vi.fn();
const findFirstYear = vi.fn();
const createYear = vi.fn();
const updateYear = vi.fn();
const updateManyYears = vi.fn();
const updateManyProfiles = vi.fn();
const transaction = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaSchoolYear: {
      upsert: (...args: unknown[]) => upsertYear(...args),
      findMany: (...args: unknown[]) => findManyYears(...args),
      findUnique: (...args: unknown[]) => findUniqueYear(...args),
      findFirst: (...args: unknown[]) => findFirstYear(...args),
      create: (...args: unknown[]) => createYear(...args),
      update: (...args: unknown[]) => updateYear(...args),
      updateMany: (...args: unknown[]) => updateManyYears(...args),
    },
    ptaProfile: {
      updateMany: (...args: unknown[]) => updateManyProfiles(...args),
    },
    $transaction: (...args: unknown[]) => transaction(...args),
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

import {
  createSchoolYear,
  deriveNextLabel,
  derivePreviousLabel,
  getSchoolYearContext,
  parseSchoolYearLabel,
  resolveSchoolYearId,
  setCurrentSchoolYear,
} from "@/lib/labs/pta/school-years";

describe("school year label helpers", () => {
  it("parses canonical labels and rejects everything else", () => {
    expect(parseSchoolYearLabel("2026-2027")).toEqual({ startYear: 2026, endYear: 2027 });
    expect(parseSchoolYearLabel(" 2026-2027 ")).toEqual({ startYear: 2026, endYear: 2027 });
    expect(parseSchoolYearLabel("2026-2028")).toBeNull(); // not consecutive
    expect(parseSchoolYearLabel("2026/2027")).toBeNull();
    expect(parseSchoolYearLabel("Fall 2026")).toBeNull();
    expect(parseSchoolYearLabel("")).toBeNull();
  });

  it("derives next and previous labels", () => {
    expect(deriveNextLabel("2026-2027")).toBe("2027-2028");
    expect(derivePreviousLabel("2026-2027")).toBe("2025-2026");
    expect(deriveNextLabel("not-a-year")).toBeNull();
    expect(derivePreviousLabel("not-a-year")).toBeNull();
  });
});

describe("resolveSchoolYearId", () => {
  beforeEach(() => {
    upsertYear.mockReset();
  });

  it("returns null for blank labels without touching the database", async () => {
    expect(await resolveSchoolYearId("org-1", "")).toBeNull();
    expect(await resolveSchoolYearId("org-1", "   ")).toBeNull();
    expect(await resolveSchoolYearId("org-1", null)).toBeNull();
    expect(upsertYear).not.toHaveBeenCalled();
  });

  it("finds-or-creates by the composite unique and never flips isCurrent", async () => {
    upsertYear.mockResolvedValue({ id: "year-1" });
    const id = await resolveSchoolYearId("org-1", " 2026-2027 ");
    expect(id).toBe("year-1");
    expect(upsertYear).toHaveBeenCalledWith({
      where: { organizationId_label: { organizationId: "org-1", label: "2026-2027" } },
      create: { organizationId: "org-1", label: "2026-2027" },
      update: {},
    });
  });
});

describe("createSchoolYear", () => {
  beforeEach(() => {
    findUniqueYear.mockReset();
    createYear.mockReset();
    createAuditEvent.mockClear();
  });

  it("rejects non-canonical labels", async () => {
    await expect(
      createSchoolYear({ organizationId: "org-1", label: "next year", actorUserId: "user-1" })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
    expect(createYear).not.toHaveBeenCalled();
  });

  it("rejects duplicates", async () => {
    findUniqueYear.mockResolvedValue({ id: "existing" });
    await expect(
      createSchoolYear({ organizationId: "org-1", label: "2027-2028", actorUserId: "user-1" })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });

  it("creates without changing the current year unless asked", async () => {
    findUniqueYear.mockResolvedValue(null);
    createYear.mockResolvedValue({ id: "year-2", label: "2027-2028" });
    const year = await createSchoolYear({ organizationId: "org-1", label: "2027-2028", actorUserId: "user-1" });
    expect(year).toMatchObject({ id: "year-2" });
    expect(createYear.mock.calls[0][0].data.isCurrent ?? false).toBe(false);
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "pta.school_year.created" }));
  });
});

describe("setCurrentSchoolYear", () => {
  beforeEach(() => {
    findFirstYear.mockReset();
    transaction.mockReset();
    createAuditEvent.mockClear();
  });

  it("rejects a year from another organization", async () => {
    findFirstYear.mockResolvedValue(null);
    await expect(
      setCurrentSchoolYear({ organizationId: "org-1", schoolYearId: "other-org-year", actorUserId: "user-1" })
    ).rejects.toMatchObject({ code: "PTA_SCHOOL_YEAR_NOT_FOUND" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("unsets siblings, sets the target, and keeps the profile label in lockstep", async () => {
    findFirstYear.mockResolvedValue({ id: "year-2", organizationId: "org-1", label: "2027-2028" });
    updateManyYears.mockResolvedValue({ count: 1 });
    updateYear.mockResolvedValue({ id: "year-2", isCurrent: true });
    updateManyProfiles.mockResolvedValue({ count: 1 });
    transaction.mockImplementation(async (operations: Promise<unknown>[]) => Promise.all(operations));

    await setCurrentSchoolYear({ organizationId: "org-1", schoolYearId: "year-2", actorUserId: "user-1" });

    expect(updateManyYears).toHaveBeenCalledWith({
      where: { organizationId: "org-1", isCurrent: true, id: { not: "year-2" } },
      data: { isCurrent: false },
    });
    expect(updateYear).toHaveBeenCalledWith({ where: { id: "year-2" }, data: { isCurrent: true } });
    expect(updateManyProfiles).toHaveBeenCalledWith({
      where: { organizationId: "org-1" },
      data: { currentSchoolYear: "2027-2028" },
    });
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "pta.school_year.set_current" }));
  });
});

describe("getSchoolYearContext", () => {
  it("resolves previous/next by label arithmetic against existing rows only", async () => {
    findManyYears.mockResolvedValue([
      { id: "y3", label: "2027-2028", isCurrent: false },
      { id: "y2", label: "2026-2027", isCurrent: true },
      { id: "y1", label: "2025-2026", isCurrent: false },
    ]);
    const context = await getSchoolYearContext("org-1");
    expect(context.current?.id).toBe("y2");
    expect(context.previous?.id).toBe("y1");
    expect(context.next?.id).toBe("y3");
    expect(context.suggestedNextLabel).toBe("2027-2028");
  });

  it("returns nulls when no current year or non-canonical labels", async () => {
    findManyYears.mockResolvedValue([{ id: "y1", label: "Fall Term", isCurrent: true }]);
    const context = await getSchoolYearContext("org-1");
    expect(context.previous).toBeNull();
    expect(context.next).toBeNull();
    expect(context.suggestedNextLabel).toBeNull();
  });
});
