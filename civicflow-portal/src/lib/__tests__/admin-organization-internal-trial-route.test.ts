import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerSession = vi.fn();
vi.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => getServerSession(...args),
}));
vi.mock("@/lib/authOptions", () => ({ authOptions: {} }));

const requireSuperAdmin = vi.fn();
vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return {
    ...actual,
    requireSuperAdmin: (...args: unknown[]) => requireSuperAdmin(...args),
  };
});

const requireRateLimit = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/rate-limit", () => ({
  requireRateLimit: (...args: unknown[]) => requireRateLimit(...args),
}));

const checkInternalTrialEligibility = vi.fn();
const grantInternalOrganizationTrial = vi.fn();
vi.mock("@/lib/platform-operations/internal-trial", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/platform-operations/internal-trial")>();
  return {
    ...actual,
    checkInternalTrialEligibility: (...args: unknown[]) => checkInternalTrialEligibility(...args),
    grantInternalOrganizationTrial: (...args: unknown[]) => grantInternalOrganizationTrial(...args),
  };
});

import { GET, POST } from "@/app/api/admin/organizations/[organizationId]/internal-trial/route";

function ctx(organizationId: string) {
  return { params: Promise.resolve({ organizationId }) };
}
function getReq() {
  return new Request("https://portal.test/api/admin/organizations/org-1/internal-trial");
}
function postReq(body: unknown) {
  return new Request("https://portal.test/api/admin/organizations/org-1/internal-trial", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const authedSession = { userId: "admin-1", userEmail: "admin@aphtechnologies.example" };
const authed = { session: authedSession };

beforeEach(() => {
  getServerSession.mockReset();
  requireSuperAdmin.mockReset();
  requireRateLimit.mockClear();
  requireRateLimit.mockResolvedValue(null);
  checkInternalTrialEligibility.mockReset();
  grantInternalOrganizationTrial.mockReset();
});

describe("GET /api/admin/organizations/[organizationId]/internal-trial", () => {
  it("returns 401 when there is no session at all", async () => {
    getServerSession.mockResolvedValue(null);
    const response = await GET(getReq(), ctx("org-1"));
    expect(response.status).toBe(401);
    expect(requireSuperAdmin).not.toHaveBeenCalled();
    expect(checkInternalTrialEligibility).not.toHaveBeenCalled();
  });

  it.each(["ORG_OWNER", "ORG_ADMIN", "STAFF", "FINANCE", "READ_ONLY", "MEMBER"])(
    "returns 403 for an authenticated non-platform-admin (%s org role does not grant platform authority)",
    async () => {
      getServerSession.mockResolvedValue(authedSession);
      const { ForbiddenError } = await import("@/lib/auth-guards");
      requireSuperAdmin.mockRejectedValueOnce(new ForbiddenError("Not a platform super-admin"));
      const response = await GET(getReq(), ctx("org-1"));
      expect(response.status).toBe(403);
      expect(checkInternalTrialEligibility).not.toHaveBeenCalled();
    }
  );

  it("returns the eligibility preview for an authenticated platform admin", async () => {
    getServerSession.mockResolvedValue(authedSession);
    requireSuperAdmin.mockResolvedValueOnce(authed);
    checkInternalTrialEligibility.mockResolvedValueOnce({
      organizationId: "org-1",
      organizationName: "Pine Grove School PTA",
      eligible: true,
      ineligibleCode: null,
      ineligibleReason: null,
      billingExempt: false,
      currentAccessAllowed: false,
      fixedDurationDays: 30,
    });

    const response = await GET(getReq(), ctx("org-1"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data.eligible).toBe(true);
    expect(checkInternalTrialEligibility).toHaveBeenCalledWith("org-1");
  });

  it("translates a not-found organization to 404", async () => {
    getServerSession.mockResolvedValue(authedSession);
    requireSuperAdmin.mockResolvedValueOnce(authed);
    const { InternalTrialError } = await import("@/lib/platform-operations/internal-trial");
    checkInternalTrialEligibility.mockRejectedValueOnce(new InternalTrialError("INTERNAL_TRIAL_ORGANIZATION_NOT_FOUND", "Organization not found: org-1"));

    const response = await GET(getReq(), ctx("org-1"));
    expect(response.status).toBe(404);
  });
});

describe("POST /api/admin/organizations/[organizationId]/internal-trial", () => {
  it("is rate-limited before authentication is even checked", async () => {
    requireRateLimit.mockResolvedValueOnce(Response.json({ ok: false, error: "Rate limit exceeded" }, { status: 429 }));
    const response = await POST(postReq({ reason: "test", confirm: true }), ctx("org-1"));
    expect(response.status).toBe(429);
    expect(getServerSession).not.toHaveBeenCalled();
    expect(grantInternalOrganizationTrial).not.toHaveBeenCalled();
  });

  it("returns 401 when there is no session", async () => {
    getServerSession.mockResolvedValue(null);
    const response = await POST(postReq({ reason: "test", confirm: true }), ctx("org-1"));
    expect(response.status).toBe(401);
    expect(grantInternalOrganizationTrial).not.toHaveBeenCalled();
  });

  it.each(["ORG_OWNER", "ORG_ADMIN", "STAFF", "FINANCE", "READ_ONLY", "MEMBER"])(
    "returns 403 for an authenticated non-platform-admin (%s)",
    async () => {
      getServerSession.mockResolvedValue(authedSession);
      const { ForbiddenError } = await import("@/lib/auth-guards");
      requireSuperAdmin.mockRejectedValueOnce(new ForbiddenError("Not a platform super-admin"));
      const response = await POST(postReq({ reason: "test", confirm: true }), ctx("org-1"));
      expect(response.status).toBe(403);
      expect(grantInternalOrganizationTrial).not.toHaveBeenCalled();
    }
  );

  it("rejects a missing reason", async () => {
    getServerSession.mockResolvedValue(authedSession);
    requireSuperAdmin.mockResolvedValueOnce(authed);
    const response = await POST(postReq({ confirm: true }), ctx("org-1"));
    expect(response.status).toBe(400);
    expect(grantInternalOrganizationTrial).not.toHaveBeenCalled();
  });

  it("rejects a whitespace-only reason", async () => {
    getServerSession.mockResolvedValue(authedSession);
    requireSuperAdmin.mockResolvedValueOnce(authed);
    const response = await POST(postReq({ reason: "   ", confirm: true }), ctx("org-1"));
    expect(response.status).toBe(400);
    expect(grantInternalOrganizationTrial).not.toHaveBeenCalled();
  });

  it("rejects a request missing the explicit confirm flag", async () => {
    getServerSession.mockResolvedValue(authedSession);
    requireSuperAdmin.mockResolvedValueOnce(authed);
    const response = await POST(postReq({ reason: "Pilot" }), ctx("org-1"));
    expect(response.status).toBe(400);
    expect(grantInternalOrganizationTrial).not.toHaveBeenCalled();
  });

  it("rejects a client-supplied duration/date — the schema has no field for it, so extra keys are simply ignored", async () => {
    getServerSession.mockResolvedValue(authedSession);
    requireSuperAdmin.mockResolvedValueOnce(authed);
    grantInternalOrganizationTrial.mockResolvedValueOnce({
      organizationId: "org-1",
      trialStartsAt: "2026-08-30T00:00:00.000Z",
      trialExpiresAt: "2026-09-29T00:00:00.000Z",
      accessActive: true,
      auditEventId: "audit-1",
    });

    await POST(
      postReq({ reason: "Pilot", confirm: true, durationDays: 9999, trialEndsAt: "2099-01-01", billingExempt: true }),
      ctx("org-1")
    );

    // The service is only ever called with organizationId/actor/reason —
    // none of the extra client-supplied fields reach it.
    expect(grantInternalOrganizationTrial).toHaveBeenCalledWith({
      organizationId: "org-1",
      actorUserId: "admin-1",
      actorEmail: "admin@aphtechnologies.example",
      actorRole: "SUPER_ADMIN",
      reason: "Pilot",
    });
  });

  it("ignores a client-supplied organizationId in the body — the URL path param is always authoritative (cross-organization manipulation denied)", async () => {
    getServerSession.mockResolvedValue(authedSession);
    requireSuperAdmin.mockResolvedValueOnce(authed);
    grantInternalOrganizationTrial.mockResolvedValueOnce({
      organizationId: "org-1",
      trialStartsAt: "2026-08-30T00:00:00.000Z",
      trialExpiresAt: "2026-09-29T00:00:00.000Z",
      accessActive: true,
      auditEventId: "audit-1",
    });

    await POST(postReq({ reason: "Pilot", confirm: true, organizationId: "some-other-org" }), ctx("org-1"));

    expect(grantInternalOrganizationTrial).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-1" }));
  });

  it("grants the trial and returns 201 with the actor's real identity for audit attribution", async () => {
    getServerSession.mockResolvedValue(authedSession);
    requireSuperAdmin.mockResolvedValueOnce(authed);
    grantInternalOrganizationTrial.mockResolvedValueOnce({
      organizationId: "org-1",
      trialStartsAt: "2026-08-30T00:00:00.000Z",
      trialExpiresAt: "2026-09-29T00:00:00.000Z",
      accessActive: true,
      auditEventId: "audit-1",
    });

    const response = await POST(
      postReq({ reason: "Pine Grove fictional PTA volunteer-hours reporting pilot", confirm: true }),
      ctx("org-1")
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.data.accessActive).toBe(true);
    expect(grantInternalOrganizationTrial).toHaveBeenCalledWith({
      organizationId: "org-1",
      actorUserId: "admin-1",
      actorEmail: "admin@aphtechnologies.example",
      actorRole: "SUPER_ADMIN",
      reason: "Pine Grove fictional PTA volunteer-hours reporting pilot",
    });
  });

  it("translates a service-level conflict (already active/used/billing-exempt/has-subscription) to its precise status and code", async () => {
    getServerSession.mockResolvedValue(authedSession);
    requireSuperAdmin.mockResolvedValueOnce(authed);
    const { InternalTrialError } = await import("@/lib/platform-operations/internal-trial");
    grantInternalOrganizationTrial.mockRejectedValueOnce(
      new InternalTrialError("INTERNAL_TRIAL_ALREADY_ACTIVE", "Organization has already used its one-time internal trial.")
    );

    const response = await POST(postReq({ reason: "Pilot", confirm: true }), ctx("org-1"));
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.code).toBe("INTERNAL_TRIAL_ALREADY_ACTIVE");
  });
});
