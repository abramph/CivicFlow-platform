import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyLedgerEntries = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaVolunteerLedgerEntry: { findMany: (...a: unknown[]) => findManyLedgerEntries(...a) },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolvePeriodLinkedHourEntryIds (fix/pta-volunteer-reports-period-scope)", () => {
  it("returns an empty set without querying when given no candidate ids", async () => {
    const { resolvePeriodLinkedHourEntryIds } = await import("../shared");
    const result = await resolvePeriodLinkedHourEntryIds("org-1", "period-1", []);
    expect(result.size).toBe(0);
    expect(findManyLedgerEntries).not.toHaveBeenCalled();
  });

  it("scopes the ledger query to organizationId, requirementPeriodId, sourceType:hourEntry, and the exact candidate ids", async () => {
    findManyLedgerEntries.mockResolvedValue([{ sourceId: "he-1" }]);
    const { resolvePeriodLinkedHourEntryIds } = await import("../shared");
    await resolvePeriodLinkedHourEntryIds("org-1", "period-1", ["he-1", "he-2"]);
    expect(findManyLedgerEntries).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        requirementPeriodId: "period-1",
        sourceType: "hourEntry",
        sourceId: { in: ["he-1", "he-2"] },
      },
      select: { sourceId: true },
    });
  });

  it("returns only the ids with a matching ledger row for the exact selected period", async () => {
    findManyLedgerEntries.mockResolvedValue([{ sourceId: "he-1" }]);
    const { resolvePeriodLinkedHourEntryIds } = await import("../shared");
    const result = await resolvePeriodLinkedHourEntryIds("org-1", "period-1", ["he-1", "he-2", "he-3"]);
    expect(result.has("he-1")).toBe(true);
    expect(result.has("he-2")).toBe(false);
    expect(result.has("he-3")).toBe(false);
  });
});

describe("parseVolunteerReportFilters mode parsing", () => {
  it("defaults to PERIOD when no mode query param is given", async () => {
    const { parseVolunteerReportFilters } = await import("../shared");
    const filters = parseVolunteerReportFilters(new URL("https://example.com/reports"), "period-1");
    expect(filters.mode).toBe("PERIOD");
  });

  it("defaults to PERIOD for any unrecognized mode value — never fails open to ALL_TIME", async () => {
    const { parseVolunteerReportFilters } = await import("../shared");
    const filters = parseVolunteerReportFilters(new URL("https://example.com/reports?mode=garbage"), "period-1");
    expect(filters.mode).toBe("PERIOD");
  });

  it("honors an explicit ?mode=ALL_TIME", async () => {
    const { parseVolunteerReportFilters } = await import("../shared");
    const filters = parseVolunteerReportFilters(new URL("https://example.com/reports?mode=ALL_TIME"), "period-1");
    expect(filters.mode).toBe("ALL_TIME");
  });
});

describe("volunteerReportFiltersToJson / FromJson mode round-trip", () => {
  it("round-trips PERIOD mode through the export-queue JSON storage", async () => {
    const { volunteerReportFiltersToJson, volunteerReportFiltersFromJson } = await import("../shared");
    const json = volunteerReportFiltersToJson({ requirementPeriodId: "period-1", mode: "PERIOD" });
    expect(json.mode).toBe("PERIOD");
    const back = volunteerReportFiltersFromJson(json);
    expect(back.mode).toBe("PERIOD");
  });

  it("round-trips ALL_TIME mode through the export-queue JSON storage", async () => {
    const { volunteerReportFiltersToJson, volunteerReportFiltersFromJson } = await import("../shared");
    const json = volunteerReportFiltersToJson({ requirementPeriodId: "period-1", mode: "ALL_TIME" });
    expect(json.mode).toBe("ALL_TIME");
    const back = volunteerReportFiltersFromJson(json);
    expect(back.mode).toBe("ALL_TIME");
  });

  it("defaults to PERIOD when reading a legacy queued export with no mode stored at all", async () => {
    const { volunteerReportFiltersFromJson } = await import("../shared");
    const back = volunteerReportFiltersFromJson({ requirementPeriodId: "period-1" });
    expect(back.mode).toBe("PERIOD");
  });
});
