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
