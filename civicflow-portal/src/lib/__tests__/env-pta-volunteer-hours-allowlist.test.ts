import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

// Fictional, clean 25-char lowercase-alphanumeric IDs shaped like this
// schema's real cuid()s (never actual production organization IDs).
const ORG_A = "aaaaaaaaaaaaaaaaaaaaaaaaa";
const ORG_B = "bbbbbbbbbbbbbbbbbbbbbbbbb";

describe("isPtaVolunteerHoursOrgAllowed", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  async function isAllowed(orgId: string) {
    const { isPtaVolunteerHoursOrgAllowed } = await import("@/lib/env");
    return isPtaVolunteerHoursOrgAllowed(orgId);
  }

  it("missing variable: denies every organization", async () => {
    delete process.env.PTA_VOLUNTEER_HOURS_ALLOWED_ORG_IDS;
    expect(await isAllowed(ORG_A)).toBe(false);
  });

  it("empty variable: denies every organization", async () => {
    process.env.PTA_VOLUNTEER_HOURS_ALLOWED_ORG_IDS = "";
    expect(await isAllowed(ORG_A)).toBe(false);
  });

  it("whitespace-only variable: denies every organization", async () => {
    process.env.PTA_VOLUNTEER_HOURS_ALLOWED_ORG_IDS = "   ,  ,   ";
    expect(await isAllowed(ORG_A)).toBe(false);
  });

  it("one ID: allows exactly that organization", async () => {
    process.env.PTA_VOLUNTEER_HOURS_ALLOWED_ORG_IDS = ORG_A;
    expect(await isAllowed(ORG_A)).toBe(true);
    expect(await isAllowed(ORG_B)).toBe(false);
  });

  it("multiple IDs: allows every listed organization", async () => {
    process.env.PTA_VOLUNTEER_HOURS_ALLOWED_ORG_IDS = `${ORG_A},${ORG_B}`;
    expect(await isAllowed(ORG_A)).toBe(true);
    expect(await isAllowed(ORG_B)).toBe(true);
  });

  it("duplicate IDs: behaves identically to a single entry, no error, no over-grant", async () => {
    process.env.PTA_VOLUNTEER_HOURS_ALLOWED_ORG_IDS = `${ORG_A},${ORG_A},${ORG_A}`;
    expect(await isAllowed(ORG_A)).toBe(true);
    expect(await isAllowed(ORG_B)).toBe(false);
  });

  it("trailing comma: the listed ID still works, no crash", async () => {
    process.env.PTA_VOLUNTEER_HOURS_ALLOWED_ORG_IDS = `${ORG_A},`;
    expect(await isAllowed(ORG_A)).toBe(true);
  });

  it("leading comma: the listed ID still works, no crash", async () => {
    process.env.PTA_VOLUNTEER_HOURS_ALLOWED_ORG_IDS = `,${ORG_A}`;
    expect(await isAllowed(ORG_A)).toBe(true);
  });

  it("empty entries between commas: ignored, surrounding IDs still work", async () => {
    process.env.PTA_VOLUNTEER_HOURS_ALLOWED_ORG_IDS = `${ORG_A},,${ORG_B}`;
    expect(await isAllowed(ORG_A)).toBe(true);
    expect(await isAllowed(ORG_B)).toBe(true);
  });

  it("exact match: allowed", async () => {
    process.env.PTA_VOLUNTEER_HOURS_ALLOWED_ORG_IDS = ORG_A;
    expect(await isAllowed(ORG_A)).toBe(true);
  });

  it("partial match: never valid — a superstring or substring of a listed ID is denied", async () => {
    process.env.PTA_VOLUNTEER_HOURS_ALLOWED_ORG_IDS = ORG_A;
    expect(await isAllowed(ORG_A + "extra")).toBe(false);
    expect(await isAllowed(ORG_A.slice(0, 10))).toBe(false);
  });

  it("case difference: comparison is case-sensitive", async () => {
    process.env.PTA_VOLUNTEER_HOURS_ALLOWED_ORG_IDS = ORG_A;
    expect(await isAllowed(ORG_A.toUpperCase())).toBe(false);
  });

  it("malformed ID: dropped during parsing, never matches, and doesn't break parsing of the rest of the list", async () => {
    process.env.PTA_VOLUNTEER_HOURS_ALLOWED_ORG_IDS = `not-a-valid-id!,${ORG_A}`;
    expect(await isAllowed("not-a-valid-id!")).toBe(false);
    expect(await isAllowed(ORG_A)).toBe(true);
  });

  it("wildcard attempt ('*'): never grants universal access", async () => {
    process.env.PTA_VOLUNTEER_HOURS_ALLOWED_ORG_IDS = "*";
    expect(await isAllowed(ORG_A)).toBe(false);
    expect(await isAllowed(ORG_B)).toBe(false);
    expect(await isAllowed("*")).toBe(false);
  });

  it("'all': never grants universal access", async () => {
    process.env.PTA_VOLUNTEER_HOURS_ALLOWED_ORG_IDS = "all";
    expect(await isAllowed(ORG_A)).toBe(false);
    expect(await isAllowed("all")).toBe(false);
  });

  it("'true': never grants universal access", async () => {
    process.env.PTA_VOLUNTEER_HOURS_ALLOWED_ORG_IDS = "true";
    expect(await isAllowed(ORG_A)).toBe(false);
    expect(await isAllowed("true")).toBe(false);
  });
});
