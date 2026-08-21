import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueUser = vi.fn();
const findFirstMembership = vi.fn();
const findFirstHouseholdAdult = vi.fn();
const findFirstOrgMember = vi.fn();
const findManyOrgMember = vi.fn();
const findManyUnionCase = vi.fn();
const findFirstUnionCase = vi.fn();
const findUniqueOrganization = vi.fn();
const createUnionCase = vi.fn();
const createStatusHistory = vi.fn();
const createAuditEvent = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => findUniqueUser(...args) },
    organizationMembership: { findFirst: (...args: unknown[]) => findFirstMembership(...args) },
    ptaHouseholdAdult: { findFirst: (...args: unknown[]) => findFirstHouseholdAdult(...args) },
    orgMember: {
      findFirst: (...args: unknown[]) => findFirstOrgMember(...args),
      findMany: (...args: unknown[]) => findManyOrgMember(...args),
    },
    organization: { findUnique: (...args: unknown[]) => findUniqueOrganization(...args) },
    unionCase: {
      findMany: (...args: unknown[]) => findManyUnionCase(...args),
      findFirst: (...args: unknown[]) => findFirstUnionCase(...args),
    },
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        unionCase: { create: (...a: unknown[]) => createUnionCase(...a) },
        unionCaseStatusHistory: { create: (...a: unknown[]) => createStatusHistory(...a) },
      }),
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));
vi.mock("@/lib/mail", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/push", () => ({ sendPushToTokens: vi.fn() }));

// This suite tests union-case org-tie resolution, not the subscription gate
// — assume every organization is allowed.
vi.mock("@/lib/subscription-gate", () => ({
  assertOrganizationAccess: vi.fn().mockResolvedValue({
    allowed: true,
    reason: null,
    trialEndsAt: null,
    subscriptionStatus: null,
    billingExempt: false,
  }),
}));

import { GET as getCases, POST as postCase } from "@/app/api/mobile/union/cases/route";
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

async function authedPostRequest(url: string, body: unknown) {
  const token = await signAccessToken("user-1", 0);
  return new Request(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
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
  findManyOrgMember.mockReset();
  findManyUnionCase.mockReset();
  findFirstUnionCase.mockReset();
  findUniqueOrganization.mockReset();
  createUnionCase.mockReset();
  createStatusHistory.mockReset();
  createAuditEvent.mockReset();
  findUniqueUser.mockResolvedValue({ id: "user-1", email: "user@example.com", mobileTokenVersion: 0 });
  findUniqueOrganization.mockResolvedValue({ primaryVertical: "UNION", status: "active" });
  createStatusHistory.mockResolvedValue({});
  createAuditEvent.mockResolvedValue(undefined);
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

  it("resolves an assigned representative's display name via a single batched lookup, never a raw id", async () => {
    primeIdentity({ orgMember: { id: "member-1" } });
    findManyUnionCase.mockResolvedValue([baseCase({ id: "case-1" }), { ...baseCase({ id: "case-2" }), assignedToOrgMemberId: "rep-1" }]);
    findManyOrgMember.mockResolvedValue([{ id: "rep-1", firstName: "Jordan", lastName: "Reyes", preferredName: null }]);

    const response = await getCases(await authedRequest("https://portal.test/api/mobile/union/cases?organizationId=org-1"));
    const body = await response.json();

    expect(findManyOrgMember).toHaveBeenCalledTimes(1);
    expect(body.data.find((c: { id: string }) => c.id === "case-1").representativeName).toBeNull();
    expect(body.data.find((c: { id: string }) => c.id === "case-2").representativeName).toBe("Jordan Reyes");
  });

  it("skips the representative lookup entirely when no case in the list has an assignee (no unnecessary query)", async () => {
    primeIdentity({ orgMember: { id: "member-1" } });
    findManyUnionCase.mockResolvedValue([baseCase({ id: "case-1" })]);

    await getCases(await authedRequest("https://portal.test/api/mobile/union/cases?organizationId=org-1"));

    expect(findManyOrgMember).not.toHaveBeenCalled();
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

  it("resolves the assigned representative's display name on the detail response", async () => {
    primeIdentity({ orgMember: { id: "member-1" } });
    findFirstUnionCase.mockResolvedValueOnce({ id: "case-1", memberOrgMemberId: "member-1" });
    findFirstUnionCase.mockResolvedValueOnce({ ...baseCase({ id: "case-1" }), assignedToOrgMemberId: "rep-1" });
    findFirstOrgMember.mockImplementation((args: { where: { id: string } }) =>
      args.where.id === "rep-1"
        ? Promise.resolve({ firstName: "Casey", lastName: "Kim", preferredName: "Cass" })
        : Promise.resolve({ id: "member-1" })
    );

    const response = await getCase(
      await authedRequest("https://portal.test/api/mobile/union/cases/case-1?organizationId=org-1"),
      params
    );
    const body = await response.json();

    expect(body.data.representativeName).toBe("Cass Kim");
  });
});

describe("POST /api/mobile/union/cases (Get Help intake)", () => {
  it("creates an intake scoped to the caller's own server-resolved memberId, never a client-supplied one", async () => {
    primeIdentity({ orgMember: { id: "member-1" } });
    createUnionCase.mockResolvedValue(baseCase({ id: "case-new", memberOrgMemberId: "member-1" }));

    const response = await postCase(
      await authedPostRequest("https://portal.test/api/mobile/union/cases", {
        organizationId: "org-1",
        caseType: "SCHEDULING",
        title: "Overtime not paid",
        description: "Worked extra hours in July, never got paid for them.",
        representationRequested: true,
        memberOrgMemberId: "someone-else", // forged — must have no effect
      })
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(createUnionCase).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ memberOrgMemberId: "member-1", status: "NEW" }) })
    );
    expect(body.data.title).toBe("Unpaid overtime"); // from the mocked baseCase() return value
  });

  it("never creates a formal grievance on submission -- status starts NEW regardless of caseType", async () => {
    primeIdentity({ orgMember: { id: "member-1" } });
    createUnionCase.mockResolvedValue(baseCase({ id: "case-new", memberOrgMemberId: "member-1" }));

    await postCase(
      await authedPostRequest("https://portal.test/api/mobile/union/cases", {
        organizationId: "org-1",
        caseType: "GRIEVANCE",
        title: "I want to file a grievance",
        description: "Details here.",
      })
    );

    expect(createUnionCase).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "NEW" }) }));
  });

  it("rejects a caller with no active tie to the organization", async () => {
    primeIdentity({ hasActiveTie: false });

    const response = await postCase(
      await authedPostRequest("https://portal.test/api/mobile/union/cases", {
        organizationId: "org-foreign",
        caseType: "OTHER",
        title: "t",
        description: "d",
      })
    );

    expect(response.status).toBe(403);
    expect(createUnionCase).not.toHaveBeenCalled();
  });

  it("rejects an org where Union Case Center isn't enabled (e.g. not a UNION-vertical org)", async () => {
    primeIdentity({ orgMember: { id: "member-1" } });
    findUniqueOrganization.mockResolvedValue({ primaryVertical: "COMMUNITY", status: "active" });

    const response = await postCase(
      await authedPostRequest("https://portal.test/api/mobile/union/cases", {
        organizationId: "org-1",
        caseType: "OTHER",
        title: "t",
        description: "d",
      })
    );

    expect(response.status).toBe(403);
    expect(createUnionCase).not.toHaveBeenCalled();
  });

  it("rejects an empty title/description (validation)", async () => {
    primeIdentity({ orgMember: { id: "member-1" } });

    const response = await postCase(
      await authedPostRequest("https://portal.test/api/mobile/union/cases", {
        organizationId: "org-1",
        caseType: "OTHER",
        title: "",
        description: "",
      })
    );

    expect(response.status).toBe(400);
    expect(createUnionCase).not.toHaveBeenCalled();
  });
});
