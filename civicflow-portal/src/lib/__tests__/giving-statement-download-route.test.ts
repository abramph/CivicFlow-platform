import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

const findUniqueStatement = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    contributionStatement: { findUnique: (...args: unknown[]) => findUniqueStatement(...args) },
    orgMember: { findFirst: vi.fn() },
  },
}));

const getMemberWebSession = vi.fn();
vi.mock("@/lib/member-web-session", () => ({
  getMemberWebSession: (...args: unknown[]) => getMemberWebSession(...args),
}));

const requirePermission = vi.fn();
vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return { ...actual, requirePermission: (...args: unknown[]) => requirePermission(...args) };
});

const getSignedObjectUrl = vi.fn().mockResolvedValue("https://signed.example/statement.pdf");
vi.mock("@/lib/storage", () => ({ getSignedObjectUrl: (...args: unknown[]) => getSignedObjectUrl(...args) }));

const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

const assertOrganizationAccess = vi.fn();
vi.mock("@/lib/subscription-gate", () => ({
  assertOrganizationAccess: (...args: unknown[]) => assertOrganizationAccess(...args),
  SubscriptionRequiredError: class SubscriptionRequiredError extends Error {
    status = 402;
    code = "ORGANIZATION_SUBSCRIPTION_REQUIRED";
    constructor(readonly reason: string, message: string) {
      super(message);
    }
  },
}));

import { GET } from "@/app/api/giving/statements/[statementId]/download/route";

const statement = {
  id: "stmt-1",
  organizationId: "org-a",
  memberId: "member-1",
  contributorUserId: null,
  householdId: null,
  year: 2026,
  version: 1,
  objectKey: "statements/stmt-1.pdf",
};

const memberSession = {
  userId: "user-1",
  organizationId: "org-a",
  memberId: "member-1",
  organizationName: "Org A",
  organizationLogoUrl: null,
  organizations: [],
};

function buildRequest() {
  return new Request("https://app.getunestra.com/api/giving/statements/stmt-1/download");
}

describe("GET /api/giving/statements/[statementId]/download — E2E-1 finding: member self-service path bypassed the billing gate", () => {
  beforeEach(() => {
    findUniqueStatement.mockReset().mockResolvedValue(statement);
    getMemberWebSession.mockReset().mockResolvedValue(memberSession);
    requirePermission.mockReset();
    getSignedObjectUrl.mockClear();
    createAuditEvent.mockClear();
    assertOrganizationAccess.mockReset().mockResolvedValue({
      allowed: true,
      reason: null,
      trialEndsAt: null,
      subscriptionStatus: null,
      billingExempt: false,
    });
  });

  it("allows a member downloading their own statement when the org is billing-active", async () => {
    const response = await GET(buildRequest(), { params: Promise.resolve({ statementId: "stmt-1" }) });

    expect(response.status).toBe(302);
    expect(assertOrganizationAccess).toHaveBeenCalledWith("org-a");
    expect(getSignedObjectUrl).toHaveBeenCalledWith("statements/stmt-1.pdf", 300);
    expect(createAuditEvent).toHaveBeenCalledTimes(1);
  });

  it("denies (and never generates a signed URL or audit event) when the member's own org is billing-inactive", async () => {
    const { SubscriptionRequiredError } = await import("@/lib/subscription-gate");
    assertOrganizationAccess.mockRejectedValueOnce(
      new SubscriptionRequiredError("TRIAL_EXPIRED", "Your organization's Unestra trial has ended.")
    );

    const response = await GET(buildRequest(), { params: Promise.resolve({ statementId: "stmt-1" }) });

    expect(response.status).toBe(402);
    expect(getSignedObjectUrl).not.toHaveBeenCalled();
    expect(createAuditEvent).not.toHaveBeenCalled();
  });

  it("still allows a staff holder of contributions:statements:generate, and still checks billing for the staff path too", async () => {
    getMemberWebSession.mockResolvedValueOnce(null);
    requirePermission.mockResolvedValueOnce({
      organizationId: "org-a",
      session: { userId: "staff-1", userEmail: "staff@example.com" },
    });

    const response = await GET(buildRequest(), { params: Promise.resolve({ statementId: "stmt-1" }) });

    expect(response.status).toBe(302);
    expect(requirePermission).toHaveBeenCalledWith("contributions:statements:generate", "throw");
    expect(assertOrganizationAccess).toHaveBeenCalledWith("org-a");
  });
});
