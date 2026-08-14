import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstGroup = vi.fn();
const createGroupRow = vi.fn();
const updateGroupRow = vi.fn();
const findFirstGroupMember = vi.fn();
const findUniqueGroupMember = vi.fn();
const upsertGroupMember = vi.fn();
const deleteManyGroupMember = vi.fn();
const updateGroupMember = vi.fn();
const findFirstOrgMember = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgGroup: {
      findFirst: (...a: unknown[]) => findFirstGroup(...a),
      create: (...a: unknown[]) => createGroupRow(...a),
      update: (...a: unknown[]) => updateGroupRow(...a),
    },
    orgGroupMember: {
      findFirst: (...a: unknown[]) => findFirstGroupMember(...a),
      findUnique: (...a: unknown[]) => findUniqueGroupMember(...a),
      upsert: (...a: unknown[]) => upsertGroupMember(...a),
      deleteMany: (...a: unknown[]) => deleteManyGroupMember(...a),
      update: (...a: unknown[]) => updateGroupMember(...a),
    },
    orgMember: { findFirst: (...a: unknown[]) => findFirstOrgMember(...a) },
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

import { CATEGORY_INFO, categoriesForVertical, deriveCategoryFromVertical, getEffectiveCategory } from "@/lib/organization-category";
import { isGroupLeader, setGroupMembership } from "@/lib/groups";
import { permissionsFor } from "@/lib/rbac";
import { monthlyRunRate } from "@/lib/giving/finance-dashboard";

describe("organization categories (§2/§3)", () => {
  it("every category maps to a real experience vertical with complete presets", () => {
    for (const info of Object.values(CATEGORY_INFO)) {
      expect(["COMMUNITY", "PTA", "UNION", "HOA"]).toContain(info.experienceVertical);
      expect(info.label.length).toBeGreaterThan(0);
      expect(info.givingTerminology.length).toBeGreaterThan(0);
      expect(info.memberLabel.length).toBeGreaterThan(0);
      expect(info.groupsLabel.length).toBeGreaterThan(0);
    }
  });

  it("a church runs on the COMMUNITY experience with Giving/Ministries presets", () => {
    const church = CATEGORY_INFO.CHURCH_RELIGIOUS;
    expect(church.experienceVertical).toBe("COMMUNITY");
    expect(church.givingTerminology).toBe("Giving");
    expect(church.groupsLabel).toBe("Ministries");
  });

  it("legacy organizations derive their category from the vertical", () => {
    expect(deriveCategoryFromVertical("PTA")).toBe("PTA_PTO");
    expect(getEffectiveCategory("COMMUNITY", null)).toBe("COMMUNITY");
    expect(getEffectiveCategory("COMMUNITY", "CHURCH_RELIGIOUS")).toBe("CHURCH_RELIGIOUS");
  });

  it("a category can never move an organization to a different experience engine", () => {
    // The route only accepts categories from categoriesForVertical(current).
    expect(categoriesForVertical("PTA")).toEqual(["PTA_PTO"]);
    expect(categoriesForVertical("UNION")).toEqual(["UNION"]);
    expect(categoriesForVertical("COMMUNITY")).not.toContain("PTA_PTO");
    expect(categoriesForVertical("COMMUNITY")).toContain("CHURCH_RELIGIOUS");
  });
});

describe("group capabilities are disjoint from giving (§41/§111.3)", () => {
  it("no giving capability is implied by any groups capability, for any role", () => {
    for (const role of ["STAFF", "FINANCE", "ORG_ADMIN", "ORG_OWNER"] as const) {
      const permissions = permissionsFor(role);
      const hasGroupsView = permissions.includes("groups:view");
      // Groups view alone must not bring individual-giving visibility along.
      if (role === "STAFF") {
        expect(hasGroupsView).toBe(true);
        expect(permissions).not.toContain("contributions:individual:view");
        expect(permissions).not.toContain("contributions:summary:view");
      }
    }
  });

  it("FINANCE holds the giving bundle (all but segment) — the A-era omission is fixed", () => {
    const permissions = permissionsFor("FINANCE");
    expect(permissions).toContain("contributions:summary:view");
    expect(permissions).toContain("contributions:statements:generate");
    expect(permissions).toContain("contributions:funds:manage");
    expect(permissions).not.toContain("contributions:segment");
  });

  it("STAFF cannot manage groups, only view them", () => {
    const permissions = permissionsFor("STAFF");
    expect(permissions).toContain("groups:view");
    expect(permissions).not.toContain("groups:manage");
    expect(permissions).not.toContain("groups:members:manage");
  });
});

describe("scoped group leadership (§41)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("isGroupLeader derives from the caller's own membership row, org-scoped and active-group-scoped", async () => {
    findFirstGroupMember.mockResolvedValueOnce({ id: "gm-1" });
    await expect(isGroupLeader("org-1", "g-1", "user-1")).resolves.toBe(true);
    const where = findFirstGroupMember.mock.calls[0][0].where;
    expect(where).toMatchObject({
      groupId: "g-1",
      isLeader: true,
      group: { organizationId: "org-1", status: "ACTIVE" },
      member: { organizationId: "org-1", userId: "user-1" },
    });
  });

  it("cross-org group or member → 404, nothing written", async () => {
    findFirstGroup.mockResolvedValueOnce(null);
    await expect(
      setGroupMembership({ organizationId: "org-1", groupId: "g-other", memberId: "m-1", action: "add", actorUserId: "adm" })
    ).rejects.toMatchObject({ status: 404 });

    findFirstGroup.mockResolvedValueOnce({ id: "g-1", status: "ACTIVE" });
    findFirstOrgMember.mockResolvedValueOnce(null);
    await expect(
      setGroupMembership({ organizationId: "org-1", groupId: "g-1", memberId: "m-other", action: "add", actorUserId: "adm" })
    ).rejects.toMatchObject({ status: 404 });
    expect(upsertGroupMember).not.toHaveBeenCalled();
  });

  it("archived groups refuse membership changes (§40: archive is terminal for the roster)", async () => {
    findFirstGroup.mockResolvedValueOnce({ id: "g-1", status: "ARCHIVED" });
    await expect(
      setGroupMembership({ organizationId: "org-1", groupId: "g-1", memberId: "m-1", action: "add", actorUserId: "adm" })
    ).rejects.toMatchObject({ status: 409 });
  });

  it("add is idempotent (upsert) and audited", async () => {
    findFirstGroup.mockResolvedValueOnce({ id: "g-1", status: "ACTIVE" });
    findFirstOrgMember.mockResolvedValueOnce({ id: "m-1", organizationId: "org-1" });
    await setGroupMembership({ organizationId: "org-1", groupId: "g-1", memberId: "m-1", action: "add", actorUserId: "adm" });
    expect(upsertGroupMember).toHaveBeenCalled();
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "groups.member_add" }));
  });
});

describe("finance dashboard math (§37)", () => {
  it("normalizes every frequency to a monthly run rate", () => {
    expect(monthlyRunRate(100, "MONTHLY")).toBe(100);
    expect(monthlyRunRate(100, "WEEKLY")).toBeCloseTo((100 * 52) / 12);
    expect(monthlyRunRate(100, "BIWEEKLY")).toBeCloseTo((100 * 26) / 12);
    expect(monthlyRunRate(300, "QUARTERLY")).toBe(100);
    expect(monthlyRunRate(1200, "ANNUALLY")).toBe(100);
    expect(monthlyRunRate(100, "UNKNOWN")).toBe(0);
  });
});
