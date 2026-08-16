import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueUser = vi.fn();
const findFirstMembership = vi.fn();
const findFirstHouseholdAdult = vi.fn();
const findFirstOrgMember = vi.fn();
const findManyUnionCase = vi.fn();
const findFirstUnionCase = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => findUniqueUser(...args) },
    organizationMembership: { findFirst: (...args: unknown[]) => findFirstMembership(...args) },
    ptaHouseholdAdult: { findFirst: (...args: unknown[]) => findFirstHouseholdAdult(...args) },
    orgMember: { findFirst: (...args: unknown[]) => findFirstOrgMember(...args) },
    unionCase: {
      findMany: (...args: unknown[]) => findManyUnionCase(...args),
      findFirst: (...args: unknown[]) => findFirstUnionCase(...args),
    },
  },
}));

import { GET as getCases } from "@/app/api/mobile/union/cases/route";
import { GET as getCase } from "@/app/api/mobile/union/cases/[caseId]/route";
import { signAccessToken } from "@/lib/mobile-auth";

/** requireMobileMembership resolution: an active MEMBER-role
 * OrganizationMembership plus a linked OrgMember record. */
function primeIdentity(options: { hasActiveTie?: boolean; orgMember?: { id: string } | null }) {
  findFirstMembership.mockResolvedValue(options.hasActiveTie === false ? null : { id: "membership-1" });
  findFirstHouseholdAdult.mockResolvedValue(null);
  findFirstOrgMember.mockResolvedValue("orgMember" in options ? options.orgMember : { id: "member-1" });
}

async function authedRequest(url: string) {
  const token = await signAccessToken("user-1", 0);
  return new Request(url, { method: "GET", headers: { Authorization: `Bearer ${token}` } });
}

function baseCase(overrides: Partial<{ id: string; memberOrgMemberId: string; organizationId: string }> = {}) {
  return {
    id: overrides.id ?? "case-1",
    caseNumber: 42,
    caseType: "Grievance",
    title: "Unpaid overtime",
    description: "Details.",
    status: "ACTIVE",
    isFormalGrievance: false,
    representationRequested: true,
    incidentDate: null,
    openedAt: new Date("2026-08-01"),
    resolvedAt: null,
    resolutionSummary: null,
    closedAt: null,
    assignedToOrgMemberId: null,
    memberOrgMemberId: overrides.memberOrgMemberId ?? "member-1",
    organizationId: overrides.organizationId ?? "org-1",
    createdAt: new Date("2026-08-01"),
    updatedAt: new Date("2026-08-01"),
    comments: [],
    deadlines: [],
  };
}

beforeEach(() => {
  findUniqueUser.mockReset();
  findFirstMembership.mockReset();
  findFirstHouseholdAdult.mockReset();
  findFirstOrgMember.mockReset();
  findManyUnionCase.mockReset();
  findFirstUnionCase.mockReset();
  findUniqueUser.mockResolvedValue({ id: "user-1", email: "user@example.com", mobileTokenVersion: 0 });
});

describe("GET /api/mobile/union/cases", () => {
  it("returns the caller's own cases, scoped by the server-resolved memberId", async () => {
    primeIdentity({ orgMember: { id: "member-1" } });
    findManyUnionCase.mockResolvedValue([baseCase()]);

    const response = await getCases(await authedRequest("https://portal.test/api/mobile/union/cases?organizationId=org-1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].title).toBe("Unpaid overtime");
    expect(findManyUnionCase).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-1", memberOrgMemberId: "member-1" } })
    );
  });

  it("rejects a caller with no active tie to the organization", async () => {
    primeIdentity({ hasActiveTie: false });

    const response = await getCases(await authedRequest("https://portal.test/api/mobile/union/cases?organizationId=org-foreign"));

    expect(response.status).toBe(403);
    expect(findManyUnionCase).not.toHaveBeenCalled();
  });

  it("rejects a staff-only login with no linked OrgMember", async () => {
    primeIdentity({ orgMember: null });

    const response = await getCases(await authedRequest("https://portal.test/api/mobile/union/cases?organizationId=org-1"));

    expect(response.status).toBe(403);
    expect(findManyUnionCase).not.toHaveBeenCalled();
  });
});

describe("GET /api/mobile/union/cases/[caseId]", () => {
  const params = { params: Promise.resolve({ caseId: "case-1" }) };

  it("returns case detail with member-visible comments only", async () => {
    primeIdentity({ orgMember: { id: "member-1" } });
    findFirstUnionCase.mockResolvedValue(
      baseCase({
        id: "case-1",
        // both calls (ownership check + re-fetch) read from the same mock
      })
    );
    findFirstUnionCase.mockResolvedValueOnce({ id: "case-1", memberOrgMemberId: "member-1" });
    findFirstUnionCase.mockResolvedValueOnce({
      ...baseCase({ id: "case-1" }),
      comments: [
        { id: "c1", body: "Visible update", isPrivate: false, createdAt: new Date("2026-08-02") },
        { id: "c2", body: "Internal note", isPrivate: true, createdAt: new Date("2026-08-02") },
      ],
    });

    const response = await getCase(
      await authedRequest("https://portal.test/api/mobile/union/cases/case-1?organizationId=org-1"),
      params
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.comments).toEqual([{ id: "c1", body: "Visible update", createdAt: expect.any(String) }]);
  });

  it("404s a case that doesn't exist in this organization", async () => {
    primeIdentity({ orgMember: { id: "member-1" } });
    findFirstUnionCase.mockResolvedValue(null);

    const response = await getCase(
      await authedRequest("https://portal.test/api/mobile/union/cases/case-missing?organizationId=org-1"),
      { params: Promise.resolve({ caseId: "case-missing" }) }
    );

    expect(response.status).toBe(404);
  });

  it("403s a case that belongs to a different member (cross-member access)", async () => {
    primeIdentity({ orgMember: { id: "member-1" } });
    findFirstUnionCase.mockResolvedValue({ id: "case-1", memberOrgMemberId: "someone-else" });

    const response = await getCase(
      await authedRequest("https://portal.test/api/mobile/union/cases/case-1?organizationId=org-1"),
      params
    );

    expect(response.status).toBe(403);
  });
});
