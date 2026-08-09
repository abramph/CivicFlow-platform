import { beforeEach, describe, expect, it, vi } from "vitest";

const ptaHouseholdFindMany = vi.fn();
const orgMemberFindMany = vi.fn();
const orgMemberGroupBy = vi.fn();
const organizationFindMany = vi.fn();
const ptaStudentEnrollmentFindMany = vi.fn();
const ptaCommitteeMemberFindMany = vi.fn();
const ptaVolunteerSlotFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaHousehold: { findMany: (...a: unknown[]) => ptaHouseholdFindMany(...a) },
    orgMember: {
      findMany: (...a: unknown[]) => orgMemberFindMany(...a),
      groupBy: (...a: unknown[]) => orgMemberGroupBy(...a),
    },
    organization: { findMany: (...a: unknown[]) => organizationFindMany(...a) },
    ptaStudentEnrollment: { findMany: (...a: unknown[]) => ptaStudentEnrollmentFindMany(...a) },
    ptaCommitteeMember: { findMany: (...a: unknown[]) => ptaCommitteeMemberFindMany(...a) },
    ptaVolunteerSlot: { findMany: (...a: unknown[]) => ptaVolunteerSlotFindMany(...a) },
  },
}));

function resetAllToEmpty() {
  ptaHouseholdFindMany.mockResolvedValue([]);
  orgMemberFindMany.mockResolvedValue([]);
  orgMemberGroupBy.mockResolvedValue([]);
  organizationFindMany.mockResolvedValue([]);
  ptaStudentEnrollmentFindMany.mockResolvedValue([]);
  ptaCommitteeMemberFindMany.mockResolvedValue([]);
  ptaVolunteerSlotFindMany.mockResolvedValue([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAllToEmpty();
});

describe("getDataHealthFindings", () => {
  it("returns no findings when every check comes back empty", async () => {
    const { getDataHealthFindings } = await import("../data-health");
    const findings = await getDataHealthFindings();
    expect(findings).toEqual([]);
  });

  it("flags an active household with no primary contact adult", async () => {
    ptaHouseholdFindMany.mockImplementation((args: { where?: { orgMemberId?: unknown } }) => {
      if (args?.where && "orgMemberId" in args.where) return Promise.resolve([]);
      return Promise.resolve([
        { id: "household-1", displayName: "The Test Household", organizationId: "org-a", organization: { name: "Test PTA" } },
      ]);
    });

    const { getDataHealthFindings } = await import("../data-health");
    const findings = await getDataHealthFindings();

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: "warning", title: "Household has no primary contact" });
    expect(ptaHouseholdFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: "ACTIVE", primaryContactAdultId: null },
    }));
  });

  it("does not flag inactive households as missing a primary contact", async () => {
    const { getDataHealthFindings } = await import("../data-health");
    await getDataHealthFindings();

    expect(ptaHouseholdFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: "ACTIVE", primaryContactAdultId: null },
    }));
  });

  it("flags a household billing identity with no email as warning severity", async () => {
    orgMemberFindMany.mockResolvedValueOnce([
      { id: "member-1", householdName: "Harris", organizationId: "org-a", organization: { name: "Harris PTA" } },
    ]);

    const { getDataHealthFindings } = await import("../data-health");
    const findings = await getDataHealthFindings();

    expect(findings.some((f) => f.title === "Household billing identity has no email")).toBe(true);
    const finding = findings.find((f) => f.title === "Household billing identity has no email");
    expect(finding?.affectedEntity).toEqual({ type: "org_member", id: "member-1", label: "member-1" });
    expect(finding?.explanation).not.toContain("The Test Household");
  });

  it("checks household billing OrgMembers without treating PR #85 household adults as OrgMembers", async () => {
    const { getDataHealthFindings } = await import("../data-health");
    await getDataHealthFindings();

    expect(orgMemberFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { householdName: { not: null }, email: null },
    }));
    expect(JSON.stringify(orgMemberFindMany.mock.calls)).not.toContain("ptaHouseholdAdult");
    expect(JSON.stringify(orgMemberFindMany.mock.calls)).not.toContain("userId");
  });

  it("flags duplicate communication identities within the same organization", async () => {
    orgMemberGroupBy.mockResolvedValueOnce([
      { organizationId: "org-a", email: "shared@example.com", _count: { id: 2 } },
    ]);
    organizationFindMany.mockResolvedValueOnce([{ id: "org-a", name: "Harris PTA" }]);

    const { getDataHealthFindings } = await import("../data-health");
    const findings = await getDataHealthFindings();

    expect(findings.some((f) => f.title === "Multiple OrgMembers share the same email")).toBe(true);
    const serialized = JSON.stringify(findings);
    expect(serialized).not.toContain("shared@example.com");
    expect(orgMemberGroupBy).toHaveBeenCalledWith(expect.objectContaining({
      by: ["organizationId", "email"],
      where: { email: { not: null } },
    }));
  });

  it("flags a deactivated student still actively enrolled in a classroom", async () => {
    ptaStudentEnrollmentFindMany.mockResolvedValueOnce([
      {
        id: "enrollment-1",
        organizationId: "org-a",
        organization: { name: "Test PTA" },
        classroom: { name: "Ms. Lee's Class" },
        student: { id: "student-1", status: "INACTIVE" },
      },
    ]);

    const { getDataHealthFindings } = await import("../data-health");
    const findings = await getDataHealthFindings();

    expect(findings.some((f) => f.title === "Deactivated student still actively enrolled")).toBe(true);
  });

  it("flags a committee membership for a non-active household", async () => {
    ptaCommitteeMemberFindMany.mockResolvedValueOnce([
      {
        id: "member-row-1",
        organization: { name: "Test PTA" },
        committee: { id: "committee-1", name: "Fundraising" },
        householdAdult: { household: { id: "household-1", displayName: "Old Household", status: "INACTIVE" } },
      },
    ]);

    const { getDataHealthFindings } = await import("../data-health");
    const findings = await getDataHealthFindings();

    expect(findings.some((f) => f.title === "Committee membership for a non-active household")).toBe(true);
  });

  it("flags a volunteer slot with claimedCount over capacity, but not one within capacity", async () => {
    ptaVolunteerSlotFindMany.mockResolvedValueOnce([
      { id: "slot-over", label: "Setup", claimedCount: 3, capacity: 2, organization: { name: "Test PTA" }, opportunity: { id: "opp-1", title: "Book Fair" } },
      { id: "slot-ok", label: "Cleanup", claimedCount: 2, capacity: 2, organization: { name: "Test PTA" }, opportunity: { id: "opp-1", title: "Book Fair" } },
    ]);

    const { getDataHealthFindings } = await import("../data-health");
    const findings = await getDataHealthFindings();

    const overCapacity = findings.filter((f) => f.title === "Volunteer slot has more claims than capacity");
    expect(overCapacity).toHaveLength(1);
    expect(overCapacity[0].affectedEntity).toEqual({ type: "pta_volunteer_opportunity", id: "opp-1", label: "opp-1" });
  });

  it("limits every diagnostic query to bounded reads", async () => {
    const { getDataHealthFindings } = await import("../data-health");
    await getDataHealthFindings();

    expect(ptaHouseholdFindMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ take: 500 }));
    expect(ptaHouseholdFindMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ take: 500 }));
    expect(orgMemberFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 500 }));
    expect(orgMemberGroupBy).toHaveBeenCalledWith(expect.objectContaining({ take: 200 }));
    expect(ptaStudentEnrollmentFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 500 }));
    expect(ptaCommitteeMemberFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 500 }));
    expect(ptaVolunteerSlotFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5000 }));
  });

  it("sorts findings critical first, then warning, then info", async () => {
    ptaHouseholdFindMany.mockImplementation((args: { where?: { orgMemberId?: unknown } }) => {
      if (args?.where && "orgMemberId" in args.where) {
        return Promise.resolve([{ id: "household-critical", displayName: "Broken Household", organization: { name: "Test PTA" } }]);
      }
      return Promise.resolve([{ id: "household-warning", displayName: "No Contact Household", organizationId: "org-a", organization: { name: "Test PTA" } }]);
    });
    orgMemberGroupBy.mockResolvedValueOnce([{ organizationId: "org-a", email: "shared@example.com", _count: { id: 2 } }]);
    organizationFindMany.mockResolvedValueOnce([{ id: "org-a", name: "Test PTA" }]);

    const { getDataHealthFindings } = await import("../data-health");
    const findings = await getDataHealthFindings();

    const severities = findings.map((f) => f.severity);
    const criticalIndex = severities.indexOf("critical");
    const infoIndex = severities.indexOf("info");
    expect(criticalIndex).toBeLessThan(infoIndex);
    expect(severities).toEqual([...severities].sort((a, b) => {
      const rank = { critical: 0, warning: 1, info: 2 } as const;
      return rank[a] - rank[b];
    }));
  });
});
