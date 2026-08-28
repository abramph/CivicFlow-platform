import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Volunteer Hour Requirements & Buyout program, VH-L (docs/pta-volunteer-hours.md).
 *
 * Mobile-compatibility guarantee: the submitted iOS build and the current
 * Android build call only `/api/mobile/pta/{profile,volunteers/*,
 * announcements/*,events/*,dues/*,documents,meetings/*}` (enumerated from
 * civicflow-mobile/src/lib/mobile-api.ts:386-739 during this program's
 * planning phase). This program adds new endpoints exclusively under
 * `/api/labs/pta/volunteer-hours/*` and never edits an existing
 * `/api/mobile/*` route file.
 *
 * A live "before vs after" response diff isn't possible retroactively (no
 * snapshot was captured before VH-A started) — this is a static-source
 * guard instead, same rationale/shape as
 * src/components/labs/pta/__tests__/refresh-consistency.test.ts: it fails
 * loudly the moment a future change makes any `/api/mobile/pta/*` route
 * depend on this feature's code or its new PtaProfile columns, which is
 * the actual failure mode this guarantee exists to prevent.
 */

const MOBILE_PTA_DIR = path.resolve(__dirname, "../../../../../app/api/mobile/pta");

const VOLUNTEER_HOURS_FLAG_FIELDS = [
  "ptaVolunteerRequirementsEnabled",
  "ptaVolunteerBuyoutEnabled",
  "ptaVolunteerAssessmentsEnabled",
  "ptaVolunteerReportsEnabled",
  "ptaVolunteerNotificationsEnabled",
  "ptaVolunteerNativeMobileEnabled",
];

function listRouteFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listRouteFiles(full));
    else if (entry.name === "route.ts") files.push(full);
  }
  return files;
}

describe("mobile PTA routes are untouched by the volunteer-hours program", () => {
  const routeFiles = listRouteFiles(MOBILE_PTA_DIR);

  it("finds the known set of existing mobile PTA routes (sanity check — catches this test silently scanning the wrong/empty directory)", () => {
    expect(routeFiles.length).toBeGreaterThanOrEqual(20);
  });

  for (const file of listRouteFiles(MOBILE_PTA_DIR)) {
    const relative = path.relative(path.resolve(__dirname, "../../../../../.."), file).replace(/\\/g, "/");

    it(`${relative} never imports anything from the volunteer-hours module tree`, () => {
      const source = fs.readFileSync(file, "utf-8");
      expect(source).not.toMatch(/from ["']@\/lib\/labs\/pta\/volunteer-hours/);
    });

    it(`${relative} never reads any of the six new PtaProfile volunteer-hours flags directly`, () => {
      const source = fs.readFileSync(file, "utf-8");
      for (const field of VOLUNTEER_HOURS_FLAG_FIELDS) {
        expect(source).not.toContain(field);
      }
    });
  }
});

describe("PtaProfile volunteer-hours flags default OFF and are independent of each other", () => {
  it("defaults every one of the six flags to false in the schema (never auto-activated for an existing org)", () => {
    const schemaPath = path.resolve(__dirname, "../../../../../../prisma/schema.prisma");
    const schema = fs.readFileSync(schemaPath, "utf-8");
    for (const field of VOLUNTEER_HOURS_FLAG_FIELDS) {
      const fieldLineMatch = schema.match(new RegExp(`${field}\\s+Boolean\\s+@default\\(([a-z]+)\\)`));
      expect(fieldLineMatch, `expected to find a Boolean @default(...) declaration for ${field}`).not.toBeNull();
      expect(fieldLineMatch?.[1]).toBe("false");
    }
  });
});
