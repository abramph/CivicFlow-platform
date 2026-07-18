import { describe, expect, it } from "vitest";
import { canDo, PERMISSIONS, permissionsFor } from "@/lib/rbac";

describe("rbac: MEMBER role", () => {
  it("has zero permissions — mobile members never get staff data access", () => {
    expect(permissionsFor("MEMBER")).toEqual([]);
  });

  it("canDo denies every permission for MEMBER", () => {
    for (const permission of Object.values(PERMISSIONS)) {
      expect(canDo("MEMBER", permission)).toBe(false);
    }
  });
});

describe("rbac: SUPER_ADMIN role (legacy org role, not platform authorization)", () => {
  it("has exactly ORG_OWNER's permission set — no more, no less", () => {
    expect(permissionsFor("SUPER_ADMIN")).toEqual(permissionsFor("ORG_OWNER"));
  });

  it("carries no permission ORG_OWNER doesn't already have", () => {
    for (const permission of Object.values(PERMISSIONS)) {
      expect(canDo("SUPER_ADMIN", permission)).toBe(canDo("ORG_OWNER", permission));
    }
  });
});

describe("rbac: READ_ONLY role", () => {
  it("can read members but cannot write them", () => {
    expect(canDo("READ_ONLY", "members:read")).toBe(true);
    expect(canDo("READ_ONLY", "members:write")).toBe(false);
  });
});

describe("rbac: labs:read (Unestra Labs, organization-facing)", () => {
  it("is granted to ORG_OWNER and ORG_ADMIN only — not FINANCE, STAFF, READ_ONLY, or MEMBER", () => {
    expect(canDo("ORG_OWNER", "labs:read")).toBe(true);
    expect(canDo("ORG_ADMIN", "labs:read")).toBe(true);
    expect(canDo("FINANCE", "labs:read")).toBe(false);
    expect(canDo("STAFF", "labs:read")).toBe(false);
    expect(canDo("READ_ONLY", "labs:read")).toBe(false);
    expect(canDo("MEMBER", "labs:read")).toBe(false);
  });
});
