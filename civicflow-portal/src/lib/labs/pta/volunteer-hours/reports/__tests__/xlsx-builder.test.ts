import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildReportFilename, buildVolunteerReportWorkbook, sanitizeFilenameSegment, type ReportColumn } from "../xlsx-builder";
import type { ReportData, ReportInfoMeta, ReportSummaryTotals } from "../types";

interface FixtureRow {
  name: string;
  hours: number | null;
  amount: number | null;
  pct: number | null;
  when: Date | null;
  count: number | null;
}

const columns: ReportColumn<FixtureRow>[] = [
  { header: "Name", format: "text", width: 20, getValue: (r) => r.name },
  { header: "Hours", format: "hours", width: 10, getValue: (r) => r.hours },
  { header: "Amount", format: "currency", width: 10, getValue: (r) => r.amount },
  { header: "Percent", format: "percent", width: 10, getValue: (r) => r.pct },
  { header: "When", format: "date", width: 10, getValue: (r) => r.when },
  { header: "Count", format: "integer", width: 10, getValue: (r) => r.count },
];

const info: ReportInfoMeta = {
  organizationName: "Test PTA",
  reportTitle: "Fixture Report",
  requirementPeriodName: "2026-2027 School Year",
  coveredDateRange: "2026-08-01 to 2027-06-01",
  appliedFilters: { "Approval status": "APPROVED" },
  generatedAt: new Date("2026-09-01T12:00:00Z"),
  organizationTimezone: "America/Chicago",
  generatedByName: "Officer Jones",
  calculationNotes: ["Verified hours = APPROVED entries only."],
};

function summaryFixture(): ReportSummaryTotals {
  return {
    totalFamilies: 2,
    totalIndividualVolunteers: 1,
    totalVerifiedMinutes: 90,
    totalEventMinutes: 90,
    totalNonEventMinutes: 0,
    totalPendingMinutes: 0,
    totalPurchasedMinutes: 0,
    totalWaivedMinutes: 0,
    totalRemainingMinutes: 0,
    familiesMeetingRequirement: 1,
    familiesNotMeetingRequirement: 1,
    familiesExempt: 0,
    totalBuyoutRevenueCents: 0,
    totalAssessmentsCents: 12345,
    outstandingBalanceCents: 0,
  };
}

const rows: FixtureRow[] = [
  { name: "Alpha", hours: 90, amount: 12345, pct: 50, when: new Date("2026-01-15T00:00:00Z"), count: 3 },
  { name: "Beta", hours: null, amount: null, pct: null, when: null, count: null },
];

async function buildAndReload(data: ReportData<FixtureRow>) {
  const buffer = await buildVolunteerReportWorkbook(data, columns);
  const reloaded = new ExcelJS.Workbook();
  await reloaded.xlsx.load(buffer as unknown as Parameters<typeof reloaded.xlsx.load>[0]);
  return reloaded;
}

describe("buildVolunteerReportWorkbook — anti-divergence (spec §14)", () => {
  it("produces a real .xlsx with exactly the three required worksheets", async () => {
    const wb = await buildAndReload({ info, summary: summaryFixture(), rows });
    expect(wb.worksheets.map((s) => s.name)).toEqual(["Report Information", "Summary", "Detailed Data"]);
  });

  it("Detailed Data rows carry the exact same values buildFn's Row.getValue would return, transformed identically to the on-screen JSON's display math", async () => {
    const wb = await buildAndReload({ info, summary: summaryFixture(), rows });
    const sheet = wb.getWorksheet("Detailed Data")!;

    const headerRow = sheet.getRow(1);
    expect(columns.map((c) => c.header)).toEqual(headerRow.values ? (headerRow.values as unknown[]).slice(1) : []);

    const alphaRow = sheet.getRow(2);
    expect(alphaRow.getCell(1).value).toBe("Alpha");
    // hours: minutes / 60, matching the on-screen JSON's own (minutes/60) display math
    expect(alphaRow.getCell(2).value).toBeCloseTo(rows[0].hours! / 60, 5);
    // currency: cents / 100
    expect(alphaRow.getCell(3).value).toBeCloseTo(rows[0].amount! / 100, 5);
    // percent: stored as a 0-1 fraction so Excel's "0%" numFmt renders it correctly
    expect(alphaRow.getCell(4).value).toBeCloseTo(rows[0].pct! / 100, 5);
    expect(alphaRow.getCell(6).value).toBe(3);

    const betaRow = sheet.getRow(3);
    expect(betaRow.getCell(2).value).toBeNull();
    expect(betaRow.getCell(3).value).toBeNull();
    expect(betaRow.getCell(6).value).toBeNull();
  });

  it("applies the number formats every report's on-screen display math depends on", async () => {
    const wb = await buildAndReload({ info, summary: summaryFixture(), rows });
    const sheet = wb.getWorksheet("Detailed Data")!;
    const alphaRow = sheet.getRow(2);
    expect(alphaRow.getCell(2).numFmt).toBe("0.00");
    expect(alphaRow.getCell(3).numFmt).toBe('"$"#,##0.00');
    expect(alphaRow.getCell(4).numFmt).toBe("0%");
    expect(alphaRow.getCell(6).numFmt).toBe("0");
  });

  it("sanitizes formula-injection-prone text cells (spec §13) the same way the CSV exporter does", async () => {
    const maliciousRows: FixtureRow[] = [{ name: "=SUM(A1:A9)", hours: 1, amount: null, pct: null, when: null, count: null }];
    const wb = await buildAndReload({ info, summary: summaryFixture(), rows: maliciousRows });
    const sheet = wb.getWorksheet("Detailed Data")!;
    expect(sheet.getRow(2).getCell(1).value).toBe("'=SUM(A1:A9)");
  });

  it("adds a bold totals row summing only numeric columns, matching a manual sum of the same rows", async () => {
    const wb = await buildAndReload({ info, summary: summaryFixture(), rows });
    const sheet = wb.getWorksheet("Detailed Data")!;
    const totalsRow = sheet.getRow(4);
    expect(totalsRow.getCell(1).value).toBe("Total");
    expect(totalsRow.getCell(2).value).toBeCloseTo(90 / 60, 5);
    expect(totalsRow.getCell(3).value).toBeCloseTo(12345 / 100, 5);
    expect(totalsRow.getCell(6).value).toBe(3);
    expect(totalsRow.font?.bold).toBe(true);
  });

  it("omits the totals row entirely when there are zero rows", async () => {
    const wb = await buildAndReload({ info, summary: summaryFixture(), rows: [] });
    const sheet = wb.getWorksheet("Detailed Data")!;
    expect(sheet.rowCount).toBe(1);
  });
});

describe("buildVolunteerReportWorkbook — exceljs styling smoke tests", () => {
  it("bolds and shades every worksheet's header row", async () => {
    const wb = await buildAndReload({ info, summary: summaryFixture(), rows });
    for (const sheetName of ["Report Information", "Summary", "Detailed Data"]) {
      const header = wb.getWorksheet(sheetName)!.getRow(1);
      expect(header.font?.bold).toBe(true);
      header.eachCell((cell) => {
        expect(cell.fill).toMatchObject({ type: "pattern", pattern: "solid" });
      });
    }
  });

  it("freezes the header row on every worksheet", async () => {
    const wb = await buildAndReload({ info, summary: summaryFixture(), rows });
    for (const sheetName of ["Report Information", "Summary", "Detailed Data"]) {
      const sheet = wb.getWorksheet(sheetName)!;
      expect(sheet.views?.[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    }
  });

  it("adds a column autofilter across the full header width of Detailed Data", async () => {
    const wb = await buildAndReload({ info, summary: summaryFixture(), rows });
    const sheet = wb.getWorksheet("Detailed Data")!;
    expect(sheet.autoFilter).toBe("A1:F1");
  });

  it("carries the Report Information metadata and calculation notes onto the workbook", async () => {
    const wb = await buildAndReload({ info, summary: summaryFixture(), rows });
    const sheet = wb.getWorksheet("Report Information")!;
    const values = sheet.getColumn(2).values as unknown[];
    expect(values).toContain(info.organizationName);
    expect(values).toContain(info.reportTitle);
    expect(values.some((v) => typeof v === "string" && v.includes("Verified hours"))).toBe(true);
  });

  it("carries summary totals onto the Summary sheet with correct display math", async () => {
    const wb = await buildAndReload({ info, summary: summaryFixture(), rows });
    const sheet = wb.getWorksheet("Summary")!;
    let found = false;
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      if (row.getCell(1).value === "Total assessments") {
        expect(row.getCell(2).value).toBeCloseTo(12345 / 100, 5);
        found = true;
      }
    });
    expect(found).toBe(true);
  });
});

describe("filename helpers", () => {
  it("strips unsafe characters and collapses whitespace", () => {
    expect(sanitizeFilenameSegment('My/PTA:Org "2026"')).toBe("MyPTAOrg_2026");
  });

  it("builds a filename from org, report title, and period, ending in .xlsx", () => {
    const filename = buildReportFilename("Lincoln Elementary PTA", "Family Volunteer Summary", "2026-2027 School Year");
    expect(filename).toMatch(/^Lincoln_Elementary_PTA_Family_Volunteer_Summary_2026-2027_School_Year_\d{4}-\d{2}-\d{2}\.xlsx$/);
  });
});
