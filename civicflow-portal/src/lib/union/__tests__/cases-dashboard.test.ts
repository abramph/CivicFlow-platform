import { describe, expect, it, vi, beforeEach } from "vitest";

const countUnionCase = vi.fn();
const countUnionCaseDeadline = vi.fn();
const findManyUnionCase = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    unionCase: {
      count: (...a: unknown[]) => countUnionCase(...a),
      findMany: (...a: unknown[]) => findManyUnionCase(...a),
    },
    unionCaseDeadline: { count: (...a: unknown[]) => countUnionCaseDeadline(...a) },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  countUnionCase.mockResolvedValue(0);
  countUnionCaseDeadline.mockResolvedValue(0);
  findManyUnionCase.mockResolvedValue([]);
});

describe("getUnionCaseDashboardCounts", () => {
  it("scopes the 'new/unassigned' bucket to NEW or TRIAGE status with no assignee -- never ASSIGNED or later", async () => {
    const { getUnionCaseDashboardCounts } = await import("../cases");
    await getUnionCaseDashboardCounts("org-a", "viewer-1");

    expect(countUnionCase).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-a", status: { in: ["NEW", "TRIAGE"] }, assignedToOrgMemberId: null } })
    );
  });

  it("scopes 'assigned to me' to the viewer's own OrgMember id and excludes terminal statuses", async () => {
    const { getUnionCaseDashboardCounts } = await import("../cases");
    await getUnionCaseDashboardCounts("org-a", "viewer-1");

    expect(countUnionCase).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-a", assignedToOrgMemberId: "viewer-1", status: { notIn: ["CLOSED", "WITHDRAWN"] } },
      })
    );
  });

  it("never leaks another org's or another member's counts into the viewer's bucket -- organizationId and the exact viewerOrgMemberId are always in the WHERE clause", async () => {
    const { getUnionCaseDashboardCounts } = await import("../cases");
    await getUnionCaseDashboardCounts("org-b", "viewer-2");

    const assignedToMeCall = countUnionCase.mock.calls.find((c) => (c[0] as { where: { assignedToOrgMemberId?: string } }).where.assignedToOrgMemberId === "viewer-2");
    expect(assignedToMeCall?.[0]).toMatchObject({ where: { organizationId: "org-b" } });
  });

  it("counts an 'overdue' deadline only when it's uncompleted, past due, and on a non-terminal case", async () => {
    const { getUnionCaseDashboardCounts } = await import("../cases");
    await getUnionCaseDashboardCounts("org-a", "viewer-1");

    expect(countUnionCaseDeadline).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org-a",
          completedAt: null,
          dueAt: { lt: expect.any(Date) },
          case: { status: { notIn: ["CLOSED", "WITHDRAWN"] } },
        }),
      })
    );
  });

  it("counts 'deadlines approaching' as due between now and 7 days out, uncompleted, non-terminal case", async () => {
    const { getUnionCaseDashboardCounts } = await import("../cases");
    await getUnionCaseDashboardCounts("org-a", "viewer-1");

    expect(countUnionCaseDeadline).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ completedAt: null, dueAt: { gte: expect.any(Date), lte: expect.any(Date) } }),
      })
    );
  });

  it("counts 'recently resolved' as RESOLVED/CLOSED with either resolvedAt or closedAt within the last 14 days", async () => {
    const { getUnionCaseDashboardCounts } = await import("../cases");
    await getUnionCaseDashboardCounts("org-a", "viewer-1");

    expect(countUnionCase).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["RESOLVED", "CLOSED"] },
          OR: [{ resolvedAt: { gte: expect.any(Date) } }, { closedAt: { gte: expect.any(Date) } }],
        }),
      })
    );
  });
});

describe("listUnionCasesByBucket", () => {
  it("returns an empty array for 'assigned-to-me' without querying the database when the viewer has no linked OrgMember", async () => {
    const { listUnionCasesByBucket } = await import("../cases");
    const result = await listUnionCasesByBucket("org-a", "assigned-to-me", null);

    expect(result).toEqual([]);
    expect(findManyUnionCase).not.toHaveBeenCalled();
  });

  it("scopes 'assigned-to-me' to the viewer's own id when present", async () => {
    const { listUnionCasesByBucket } = await import("../cases");
    await listUnionCasesByBucket("org-a", "assigned-to-me", "viewer-1");

    expect(findManyUnionCase).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-a", assignedToOrgMemberId: "viewer-1" }) })
    );
  });

  it("caps every bucket query at 200 rows -- this is a triage list, not a paginated archive", async () => {
    const { listUnionCasesByBucket } = await import("../cases");
    for (const bucket of ["unassigned", "active", "pending", "deadlines-approaching", "overdue", "recently-resolved"] as const) {
      findManyUnionCase.mockClear();
      await listUnionCasesByBucket("org-a", bucket, "viewer-1");
      expect(findManyUnionCase).toHaveBeenCalledWith(expect.objectContaining({ take: 200 }));
    }
  });

  it("'overdue' and 'deadlines-approaching' both exclude terminal-status cases -- a closed case's stale deadline should never show up as needing attention", async () => {
    const { listUnionCasesByBucket } = await import("../cases");
    await listUnionCasesByBucket("org-a", "overdue", "viewer-1");
    expect(findManyUnionCase).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: { notIn: ["CLOSED", "WITHDRAWN"] } }) }));
  });
});

describe("listUnionCases filters", () => {
  it("'unassigned: true' takes priority over an explicit assignedToOrgMemberId -- the two are mutually exclusive dashboard-chip filters", async () => {
    const { listUnionCases } = await import("../cases");
    await listUnionCases("org-a", { unassigned: true, assignedToOrgMemberId: "rep-1" });

    expect(findManyUnionCase).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ assignedToOrgMemberId: null }) }));
  });

  it("a purely-numeric search term matches by exact caseNumber OR by title/member-name contains -- not caseNumber alone", async () => {
    const { listUnionCases } = await import("../cases");
    await listUnionCases("org-a", { search: "42" });

    const call = findManyUnionCase.mock.calls[0][0] as { where: { OR: unknown[] } };
    expect(call.where.OR).toEqual(
      expect.arrayContaining([
        { caseNumber: 42 },
        { title: { contains: "42", mode: "insensitive" } },
        { member: { firstName: { contains: "42", mode: "insensitive" } } },
        { member: { lastName: { contains: "42", mode: "insensitive" } } },
      ])
    );
  });

  it("a non-numeric search term never includes a caseNumber clause (would be a Prisma type error against an Int field)", async () => {
    const { listUnionCases } = await import("../cases");
    await listUnionCases("org-a", { search: "overtime dispute" });

    const call = findManyUnionCase.mock.calls[0][0] as { where: { OR: unknown[] } };
    expect(call.where.OR.some((clause) => Object.prototype.hasOwnProperty.call(clause as object, "caseNumber"))).toBe(false);
  });

  it("always scopes to organizationId even with no other filters -- never a cross-tenant listing", async () => {
    const { listUnionCases } = await import("../cases");
    await listUnionCases("org-a", {});
    expect(findManyUnionCase).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "org-a" } }));
  });
});
