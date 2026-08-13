import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PTA Vertical 2.0, PR PTA-B — committee-scoped chair authorization tests.
 * The security property under test: a chair/co-chair can manage exactly ONE
 * committee (their own), through a restricted field whitelist, without any
 * staff permission — and nobody else without pta:committees:manage gets in.
 */

const findFirstCommittee = vi.fn();
const updateCommittee = vi.fn();
const findUniqueCommittee = vi.fn();
const findFirstAdult = vi.fn();
const findFirstYear = vi.fn();
const requireOrganization = vi.fn();
const findUniqueOrganization = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaCommittee: {
      findFirst: (...a: unknown[]) => findFirstCommittee(...a),
      findUnique: (...a: unknown[]) => findUniqueCommittee(...a),
      update: (...a: unknown[]) => updateCommittee(...a),
    },
    ptaHouseholdAdult: { findFirst: (...a: unknown[]) => findFirstAdult(...a) },
    ptaSchoolYear: { findFirst: (...a: unknown[]) => findFirstYear(...a) },
    organization: { findUnique: (...a: unknown[]) => findUniqueOrganization(...a) },
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));
vi.mock("@/lib/auth-guards", () => ({
  requireOrganization: (...args: unknown[]) => requireOrganization(...args),
  requirePermission: vi.fn(),
}));

import { requireCommitteeManageOrChair, isCommitteeChair } from "@/lib/labs/pta/guard";
import { updatePtaCommittee, updatePtaCommitteeAsChair } from "@/lib/labs/pta/committees";

beforeEach(() => {
  vi.clearAllMocks();
  // PTA vertical check inside the guard.
  findUniqueOrganization.mockResolvedValue({ primaryVertical: "PTA", status: "active" });
});

function sessionAs(userId: string, permissions: string[]) {
  requireOrganization.mockResolvedValue({
    organizationId: "org-1",
    session: { userId, userEmail: `${userId}@example.test` },
    can: (permission: string) => permissions.includes(permission),
  });
}

describe("requireCommitteeManageOrChair", () => {
  it("officer with pta:committees:manage passes for any committee in their org", async () => {
    sessionAs("officer-1", ["pta:committees:manage"]);
    findFirstCommittee.mockResolvedValueOnce({ id: "committee-1" });
    const result = await requireCommitteeManageOrChair("committee-1");
    expect(result.isChairOnly).toBe(false);
  });

  it("officer permission still cannot reach another organization's committee", async () => {
    sessionAs("officer-1", ["pta:committees:manage"]);
    findFirstCommittee.mockResolvedValueOnce(null); // org-scoped where excluded it
    await expect(requireCommitteeManageOrChair("committee-of-org-2")).rejects.toMatchObject({ code: "PTA_COMMITTEE_NOT_FOUND" });
  });

  it("a linked chair passes for their own committee with isChairOnly", async () => {
    sessionAs("parent-1", []); // zero permissions — MEMBER-role parent
    findFirstCommittee.mockResolvedValueOnce({ id: "committee-1" });
    const result = await requireCommitteeManageOrChair("committee-1");
    expect(result.isChairOnly).toBe(true);
    // Linkage query must pin BOTH the committee id and the caller's userId.
    const where = findFirstCommittee.mock.calls[0][0].where;
    expect(where.id).toBe("committee-1");
    expect(where.organizationId).toBe("org-1");
    expect(JSON.stringify(where.OR)).toContain("parent-1");
  });

  it("a chair of committee A is denied on committee B", async () => {
    sessionAs("parent-1", []);
    findFirstCommittee.mockResolvedValueOnce(null); // not chair of B
    await expect(requireCommitteeManageOrChair("committee-b")).rejects.toMatchObject({ code: "PTA_NOT_A_HOUSEHOLD_MEMBER" });
  });

  it("a plain parent with no chair role and no permission is denied", async () => {
    sessionAs("parent-2", []);
    findFirstCommittee.mockResolvedValueOnce(null);
    await expect(requireCommitteeManageOrChair("committee-1")).rejects.toMatchObject({ code: "PTA_NOT_A_HOUSEHOLD_MEMBER" });
  });

  it("denies everyone when the organization is not a PTA vertical", async () => {
    sessionAs("officer-1", ["pta:committees:manage"]);
    findUniqueOrganization.mockResolvedValue({ primaryVertical: "COMMUNITY", status: "active" });
    await expect(requireCommitteeManageOrChair("committee-1")).rejects.toMatchObject({ code: "PTA_ORGANIZATION_NOT_PTA_VERTICAL" });
  });
});

describe("isCommitteeChair", () => {
  it("returns false when no linkage row matches", async () => {
    findFirstCommittee.mockResolvedValueOnce(null);
    expect(await isCommitteeChair("org-1", "user-1", "committee-1")).toBe(false);
  });
});

describe("updatePtaCommitteeAsChair", () => {
  it("only ever writes the whitelisted fields", async () => {
    findFirstCommittee.mockResolvedValueOnce({ id: "committee-1", organizationId: "org-1" });
    updateCommittee.mockResolvedValueOnce({ id: "committee-1" });
    await updatePtaCommitteeAsChair({
      organizationId: "org-1",
      committeeId: "committee-1",
      description: "New description",
      goals: "New goals",
      meetingSchedule: "Tuesdays",
      actorUserId: "parent-1",
    });
    const data = updateCommittee.mock.calls[0][0].data;
    expect(Object.keys(data).sort()).toEqual(["description", "goals", "meetingSchedule"]);
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "pta.committee.updated_by_chair" }));
  });
});

describe("updatePtaCommittee (officer path)", () => {
  it("rejects a duplicate name", async () => {
    findFirstCommittee.mockResolvedValueOnce({ id: "committee-1", organizationId: "org-1", name: "Fundraising" });
    findUniqueCommittee.mockResolvedValueOnce({ id: "committee-2" });
    await expect(
      updatePtaCommittee({ organizationId: "org-1", committeeId: "committee-1", name: "Membership", actorUserId: "u1" })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });

  it("rejects a board liaison from another organization", async () => {
    findFirstCommittee.mockResolvedValueOnce({ id: "committee-1", organizationId: "org-1", name: "Fundraising" });
    findFirstAdult.mockResolvedValueOnce(null);
    await expect(
      updatePtaCommittee({ organizationId: "org-1", committeeId: "committee-1", boardLiaisonAdultId: "foreign-adult", actorUserId: "u1" })
    ).rejects.toMatchObject({ code: "PTA_NOT_A_HOUSEHOLD_MEMBER" });
  });

  it("rejects a school year from another organization", async () => {
    findFirstCommittee.mockResolvedValueOnce({ id: "committee-1", organizationId: "org-1", name: "Fundraising" });
    findFirstYear.mockResolvedValueOnce(null);
    await expect(
      updatePtaCommittee({ organizationId: "org-1", committeeId: "committee-1", schoolYearId: "foreign-year", actorUserId: "u1" })
    ).rejects.toMatchObject({ code: "PTA_SCHOOL_YEAR_NOT_FOUND" });
  });

  it("stamps the year label alongside the FK when the year changes", async () => {
    findFirstCommittee.mockResolvedValueOnce({ id: "committee-1", organizationId: "org-1", name: "Fundraising", status: "ACTIVE" });
    findFirstYear.mockResolvedValueOnce({ id: "year-2", label: "2027-2028" });
    updateCommittee.mockResolvedValueOnce({ id: "committee-1", name: "Fundraising", status: "ACTIVE" });
    await updatePtaCommittee({ organizationId: "org-1", committeeId: "committee-1", schoolYearId: "year-2", actorUserId: "u1" });
    expect(updateCommittee.mock.calls[0][0].data).toMatchObject({ schoolYearId: "year-2", schoolYear: "2027-2028" });
  });
});
