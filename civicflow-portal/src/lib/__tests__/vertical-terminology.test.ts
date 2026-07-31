import { describe, expect, it } from "vitest";
import {
  getVerticalTerminology,
  getQuickActions,
  getHelpTopics,
  getEmptyStateCopy,
  VERTICAL_SELECTION_CARDS,
} from "@/lib/vertical-terminology";

const VERTICALS = ["COMMUNITY", "PTA", "UNION", "HOA"] as const;

describe("getVerticalTerminology", () => {
  it("never exposes internal terms (OrgMember, tenant, feature flag, Prisma model names)", () => {
    const forbidden = /OrgMember|tenant|feature flag|billing identity|ledger entry|Prisma/i;
    for (const vertical of VERTICALS) {
      const t = getVerticalTerminology(vertical);
      for (const value of Object.values(t)) {
        expect(value).not.toMatch(forbidden);
      }
    }
  });

  it("uses PTA/PTO product language for the PTA vertical even though the enum value stays PTA", () => {
    expect(getVerticalTerminology("PTA").productLabel).toBe("PTA / PTO");
  });

  it("gives each vertical a distinct dashboard title", () => {
    const titles = new Set(VERTICALS.map((v) => getVerticalTerminology(v).dashboardTitle));
    expect(titles.size).toBe(4);
  });
});

describe("getQuickActions / getHelpTopics", () => {
  it("every quick action and help topic href is a plausible in-app route (no external URLs, no placeholders)", () => {
    for (const vertical of VERTICALS) {
      for (const action of getQuickActions(vertical)) {
        expect(action.href.startsWith("/")).toBe(true);
      }
      for (const topic of getHelpTopics(vertical)) {
        expect(topic.href.startsWith("/")).toBe(true);
      }
    }
  });

  it("PTA help never mentions Community fundraising, and Union/HOA help never mentions PTA households", () => {
    const ptaHelp = getHelpTopics("PTA").map((t) => `${t.title} ${t.description}`).join(" ");
    expect(ptaHelp).not.toMatch(/fundrais/i);

    for (const vertical of ["UNION", "HOA"] as const) {
      const help = getHelpTopics(vertical).map((t) => `${t.title} ${t.description}`).join(" ");
      expect(help).not.toMatch(/household|student/i);
    }
  });
});

describe("getEmptyStateCopy", () => {
  it("is never the generic 'No records found'", () => {
    for (const vertical of VERTICALS) {
      for (const key of ["members", "events", "meetings", "documents", "communications"] as const) {
        expect(getEmptyStateCopy(vertical, key)).not.toBe("No records found");
        expect(getEmptyStateCopy(vertical, key).length).toBeGreaterThan(10);
      }
    }
  });

  it("uses PTA's household vocabulary instead of generic members language", () => {
    expect(getEmptyStateCopy("PTA", "members")).toMatch(/household/i);
    expect(getEmptyStateCopy("HOA", "members")).toMatch(/resident/i);
  });
});

describe("VERTICAL_SELECTION_CARDS", () => {
  it("has exactly the four required verticals in the required order", () => {
    expect(VERTICAL_SELECTION_CARDS.map((c) => c.vertical)).toEqual(["COMMUNITY", "PTA", "UNION", "HOA"]);
  });

  it("never claims unimplemented Union/HOA functionality", () => {
    const union = VERTICAL_SELECTION_CARDS.find((c) => c.vertical === "UNION")!;
    const hoa = VERTICAL_SELECTION_CARDS.find((c) => c.vertical === "HOA")!;
    const unionText = `${union.description} ${union.highlights.join(" ")}`;
    const hoaText = `${hoa.description} ${hoa.highlights.join(" ")}`;
    expect(unionText).not.toMatch(/grievance|arbitration/i);
    expect(hoaText).not.toMatch(/violation|maintenance ticket|architectural review/i);
  });
});
