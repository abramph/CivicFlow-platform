import { describe, expect, it } from "vitest";
import { canDo, type Permission, type Role } from "@/lib/rbac";

/**
 * Volunteer Hour Requirements & Buyout program (docs/pta-volunteer-hours.md),
 * VH-I — the full permission matrix for all 12 pta:volunteer-* permissions,
 * verified against every role. This is the single source of truth for the
 * money-side/hours-side split documented throughout the program: STAFF
 * gets requirements/assessments/notifications authority (the operational
 * side); FINANCE gets pricing/payments/financial-reports authority (the
 * money side); ORG_OWNER/ORG_ADMIN/SUPER_ADMIN get everything; READ_ONLY
 * gets view-only visibility into hours (never money); MEMBER gets
 * nothing, as always. pta:volunteer-notifications:manage (FA3 §5) added
 * after the other 11 — it's neither money nor requirements/assessment
 * authority, so it follows STAFF's existing "operational" bucket rather
 * than either the FINANCE or the requirements/assessments-only split.
 */
const ALL_ROLES: Role[] = ["SUPER_ADMIN", "ORG_OWNER", "ORG_ADMIN", "FINANCE", "STAFF", "READ_ONLY", "MEMBER"];

const MATRIX: Record<Permission, Role[]> = {
  "pta:volunteer-requirements:view": ["SUPER_ADMIN", "ORG_OWNER", "ORG_ADMIN", "STAFF", "READ_ONLY"],
  "pta:volunteer-requirements:manage": ["SUPER_ADMIN", "ORG_OWNER", "ORG_ADMIN", "STAFF"],
  "pta:volunteer-requirements:adjust-family": ["SUPER_ADMIN", "ORG_OWNER", "ORG_ADMIN", "STAFF"],
  "pta:volunteer-buyout-pricing:manage": ["SUPER_ADMIN", "ORG_OWNER", "ORG_ADMIN", "FINANCE"],
  "pta:volunteer-reports:view": ["SUPER_ADMIN", "ORG_OWNER", "ORG_ADMIN", "FINANCE", "STAFF", "READ_ONLY"],
  "pta:volunteer-reports:export": ["SUPER_ADMIN", "ORG_OWNER", "ORG_ADMIN", "FINANCE", "STAFF"],
  "pta:volunteer-financial-reports:view": ["SUPER_ADMIN", "ORG_OWNER", "ORG_ADMIN", "FINANCE"],
  "pta:volunteer-assessments:preview-post": ["SUPER_ADMIN", "ORG_OWNER", "ORG_ADMIN", "STAFF"],
  "pta:volunteer-payments:record-offline": ["SUPER_ADMIN", "ORG_OWNER", "ORG_ADMIN", "FINANCE"],
  "pta:volunteer-payments:refund": ["SUPER_ADMIN", "ORG_OWNER", "ORG_ADMIN", "FINANCE"],
  "pta:volunteer-audit:view": ["SUPER_ADMIN", "ORG_OWNER", "ORG_ADMIN", "FINANCE"],
  "pta:volunteer-notifications:manage": ["SUPER_ADMIN", "ORG_OWNER", "ORG_ADMIN", "STAFF"],
} as Record<Permission, Role[]>;

describe("volunteer-hours permission matrix", () => {
  for (const [permission, grantedRoles] of Object.entries(MATRIX) as [Permission, Role[]][]) {
    it(`${permission} is granted to exactly [${grantedRoles.join(", ")}] and denied to everyone else`, () => {
      for (const role of ALL_ROLES) {
        const expected = grantedRoles.includes(role);
        expect(canDo(role, permission)).toBe(expected);
      }
    });
  }

  it("MEMBER holds none of the 12 volunteer-hours permissions — the hard rail applies here too", () => {
    for (const permission of Object.keys(MATRIX) as Permission[]) {
      expect(canDo("MEMBER", permission)).toBe(false);
    }
  });

  it("ORG_OWNER and SUPER_ADMIN hold all 12 volunteer-hours permissions — always-all is unconditional", () => {
    for (const permission of Object.keys(MATRIX) as Permission[]) {
      expect(canDo("ORG_OWNER", permission)).toBe(true);
      expect(canDo("SUPER_ADMIN", permission)).toBe(true);
    }
  });
});

describe("volunteer-hours permission matrix — the money-side/hours-side split", () => {
  it("FINANCE never gets requirements/assessment/notifications authority — hours and communications aren't a Treasurer's job (mirrors the existing pta:volunteers:* precedent)", () => {
    expect(canDo("FINANCE", "pta:volunteer-requirements:manage")).toBe(false);
    expect(canDo("FINANCE", "pta:volunteer-requirements:adjust-family")).toBe(false);
    expect(canDo("FINANCE", "pta:volunteer-assessments:preview-post")).toBe(false);
    expect(canDo("FINANCE", "pta:volunteer-notifications:manage")).toBe(false);
  });

  it("STAFF never gets pricing/payment/financial-report authority — the money side stays with FINANCE", () => {
    expect(canDo("STAFF", "pta:volunteer-buyout-pricing:manage")).toBe(false);
    expect(canDo("STAFF", "pta:volunteer-financial-reports:view")).toBe(false);
    expect(canDo("STAFF", "pta:volunteer-payments:record-offline")).toBe(false);
    expect(canDo("STAFF", "pta:volunteer-payments:refund")).toBe(false);
    expect(canDo("STAFF", "pta:volunteer-audit:view")).toBe(false);
  });

  it("STAFF gets notifications-manage (operational/communications, distinct from FINANCE's money side and unlocked by the same permission-split reasoning as requirements-manage)", () => {
    expect(canDo("STAFF", "pta:volunteer-notifications:manage")).toBe(true);
  });

  it("both FINANCE and STAFF can view and export general reports — the one deliberate overlap", () => {
    expect(canDo("FINANCE", "pta:volunteer-reports:view")).toBe(true);
    expect(canDo("STAFF", "pta:volunteer-reports:view")).toBe(true);
    expect(canDo("FINANCE", "pta:volunteer-reports:export")).toBe(true);
    expect(canDo("STAFF", "pta:volunteer-reports:export")).toBe(true);
  });

  it("READ_ONLY sees hours and general reports but never financial reports, pricing, payments, or assessment authority", () => {
    expect(canDo("READ_ONLY", "pta:volunteer-requirements:view")).toBe(true);
    expect(canDo("READ_ONLY", "pta:volunteer-reports:view")).toBe(true);
    expect(canDo("READ_ONLY", "pta:volunteer-financial-reports:view")).toBe(false);
    expect(canDo("READ_ONLY", "pta:volunteer-buyout-pricing:manage")).toBe(false);
    expect(canDo("READ_ONLY", "pta:volunteer-payments:record-offline")).toBe(false);
    expect(canDo("READ_ONLY", "pta:volunteer-assessments:preview-post")).toBe(false);
    expect(canDo("READ_ONLY", "pta:volunteer-requirements:manage")).toBe(false);
  });
});
