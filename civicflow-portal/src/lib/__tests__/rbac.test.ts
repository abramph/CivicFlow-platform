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

describe("rbac: meetings:minutes:review / meetings:minutes:approve", () => {
  it("grants ORG_OWNER and ORG_ADMIN both review and approve authority", () => {
    expect(canDo("ORG_OWNER", "meetings:minutes:review")).toBe(true);
    expect(canDo("ORG_OWNER", "meetings:minutes:approve")).toBe(true);
    expect(canDo("ORG_ADMIN", "meetings:minutes:review")).toBe(true);
    expect(canDo("ORG_ADMIN", "meetings:minutes:approve")).toBe(true);
  });

  it("grants STAFF review authority only, not approval -- a Secretary can request changes but not finalize minutes", () => {
    expect(canDo("STAFF", "meetings:minutes:review")).toBe(true);
    expect(canDo("STAFF", "meetings:minutes:approve")).toBe(false);
  });

  it("grants neither to FINANCE, READ_ONLY, or MEMBER", () => {
    for (const role of ["FINANCE", "READ_ONLY", "MEMBER"] as const) {
      expect(canDo(role, "meetings:minutes:review")).toBe(false);
      expect(canDo(role, "meetings:minutes:approve")).toBe(false);
    }
  });
});

describe("rbac: hoa:properties:*/hoa:residents:* (PR #43 foundation)", () => {
  it("grants ORG_OWNER, ORG_ADMIN, and STAFF full read/write on both properties and residents", () => {
    for (const role of ["ORG_OWNER", "ORG_ADMIN", "STAFF"] as const) {
      expect(canDo(role, "hoa:properties:read")).toBe(true);
      expect(canDo(role, "hoa:properties:write")).toBe(true);
      expect(canDo(role, "hoa:residents:read")).toBe(true);
      expect(canDo(role, "hoa:residents:write")).toBe(true);
    }
  });

  it("grants FINANCE (Treasurer) read-only on both -- record-keeping is a board function, not a financial one", () => {
    expect(canDo("FINANCE", "hoa:properties:read")).toBe(true);
    expect(canDo("FINANCE", "hoa:properties:write")).toBe(false);
    expect(canDo("FINANCE", "hoa:residents:read")).toBe(true);
    expect(canDo("FINANCE", "hoa:residents:write")).toBe(false);
  });

  it("grants READ_ONLY visibility without authority on both", () => {
    expect(canDo("READ_ONLY", "hoa:properties:read")).toBe(true);
    expect(canDo("READ_ONLY", "hoa:properties:write")).toBe(false);
    expect(canDo("READ_ONLY", "hoa:residents:read")).toBe(true);
    expect(canDo("READ_ONLY", "hoa:residents:write")).toBe(false);
  });

  it("grants MEMBER none of them -- resident self-service is scoped by relationship, not RBAC permission", () => {
    expect(canDo("MEMBER", "hoa:properties:read")).toBe(false);
    expect(canDo("MEMBER", "hoa:properties:write")).toBe(false);
    expect(canDo("MEMBER", "hoa:residents:read")).toBe(false);
    expect(canDo("MEMBER", "hoa:residents:write")).toBe(false);
  });
});

describe("rbac: meetingIntelligence:* (internal APH pilot)", () => {
  const permissions = [
    "meetingIntelligence:read",
    "meetingIntelligence:create",
    "meetingIntelligence:review",
    "meetingIntelligence:approve",
    "meetingIntelligence:delete",
  ] as const;

  it("grants ORG_OWNER and ORG_ADMIN every meetingIntelligence permission", () => {
    for (const permission of permissions) {
      expect(canDo("ORG_OWNER", permission)).toBe(true);
      expect(canDo("ORG_ADMIN", permission)).toBe(true);
    }
  });

  it("grants none of them to FINANCE, STAFF, READ_ONLY, or MEMBER", () => {
    for (const permission of permissions) {
      expect(canDo("FINANCE", permission)).toBe(false);
      expect(canDo("STAFF", permission)).toBe(false);
      expect(canDo("READ_ONLY", permission)).toBe(false);
      expect(canDo("MEMBER", permission)).toBe(false);
    }
  });
});
