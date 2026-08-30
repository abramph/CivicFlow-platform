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
    const response = await POST(postReq({ reason: "Pilot access request" }), ctx("org-1"));
    expect(response.status).toBe(400);
    expect(grantInternalOrganizationTrial).not.toHaveBeenCalled();
  });

  it("rejects a client-supplied duration/date/billingExempt — the strict schema has no field for any of them", async () => {
    getServerSession.mockResolvedValue(authedSession);
    requireSuperAdmin.mockResolvedValueOnce(authed);

    const response = await POST(
      postReq({
        reason: "Pilot access request",
        confirm: true,
        durationDays: 9999,
        trialEndsAt: "2099-01-01",
        billingExempt: true,
      }),
      ctx("org-1")
    );

    expect(response.status).toBe(400);
    expect(grantInternalOrganizationTrial).not.toHaveBeenCalled();
  });

  it("rejects a client-supplied organizationId in the body — unknown keys are rejected outright, not silently ignored (cross-organization manipulation denied)", async () => {
    getServerSession.mockResolvedValue(authedSession);
    requireSuperAdmin.mockResolvedValueOnce(authed);

    const response = await POST(
      postReq({ reason: "Pilot access request", confirm: true, organizationId: "some-other-org" }),
      ctx("org-1")
    );

    expect(response.status).toBe(400);
    expect(grantInternalOrganizationTrial).not.toHaveBeenCalled();
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

    const response = await POST(postReq({ reason: "Pilot access request", confirm: true }), ctx("org-1"));
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.code).toBe("INTERNAL_TRIAL_ALREADY_ACTIVE");
  });
});

describe("POST — strict request validation", () => {
  function rawPostReq(body: string) {
    return new Request("https://portal.test/api/admin/organizations/org-1/internal-trial", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
  }

  beforeEach(() => {
    getServerSession.mockResolvedValue(authedSession);
    requireSuperAdmin.mockResolvedValue(authed);
  });

  it("accepts a valid { reason, confirm: true } body", async () => {
    grantInternalOrganizationTrial.mockResolvedValueOnce({
      organizationId: "org-1",
      trialStartsAt: "2026-08-30T00:00:00.000Z",
      trialExpiresAt: "2026-09-29T00:00:00.000Z",
      accessActive: true,
      auditEventId: "audit-1",
    });
    const response = await POST(postReq({ reason: "Pilot access request", confirm: true }), ctx("org-1"));
    expect(response.status).toBe(201);
  });

  it("rejects confirm: false", async () => {
    const response = await POST(postReq({ reason: "Pilot access request", confirm: false }), ctx("org-1"));
    expect(response.status).toBe(400);
    expect(grantInternalOrganizationTrial).not.toHaveBeenCalled();
  });

  it("rejects a missing reason", async () => {
    const response = await POST(postReq({ confirm: true }), ctx("org-1"));
    expect(response.status).toBe(400);
  });

  it("rejects a blank (whitespace-only) reason", async () => {
    const response = await POST(postReq({ reason: "          ", confirm: true }), ctx("org-1"));
    expect(response.status).toBe(400);
  });

  it("rejects a too-short reason (below the 10-character minimum)", async () => {
    const response = await POST(postReq({ reason: "short", confirm: true }), ctx("org-1"));
    expect(response.status).toBe(400);
  });

  it("rejects a too-long reason (above the 500-character maximum)", async () => {
    const response = await POST(postReq({ reason: "x".repeat(501), confirm: true }), ctx("org-1"));
    expect(response.status).toBe(400);
  });

  it("rejects an unknown harmless-looking field", async () => {
    const response = await POST(postReq({ reason: "Pilot access request", confirm: true, notes: "fyi" }), ctx("org-1"));
    expect(response.status).toBe(400);
    expect(grantInternalOrganizationTrial).not.toHaveBeenCalled();
  });

  it("rejects a client-supplied custom duration", async () => {
    const response = await POST(postReq({ reason: "Pilot access request", confirm: true, duration: 90 }), ctx("org-1"));
    expect(response.status).toBe(400);
  });

  it("rejects a client-supplied end date", async () => {
    const response = await POST(postReq({ reason: "Pilot access request", confirm: true, endDate: "2099-01-01" }), ctx("org-1"));
    expect(response.status).toBe(400);
  });

  it("rejects a client-supplied billingExempt flag", async () => {
    const response = await POST(postReq({ reason: "Pilot access request", confirm: true, billingExempt: true }), ctx("org-1"));
    expect(response.status).toBe(400);
  });

  it("rejects a client-supplied Stripe identifier", async () => {
    const response = await POST(
      postReq({ reason: "Pilot access request", confirm: true, stripeCustomerId: "cus_fake123" }),
      ctx("org-1")
    );
    expect(response.status).toBe(400);
  });

  it("rejects an array body", async () => {
    const response = await POST(rawPostReq(JSON.stringify(["reason", true])), ctx("org-1"));
    expect(response.status).toBe(400);
    expect(grantInternalOrganizationTrial).not.toHaveBeenCalled();
  });

  it("rejects a null body", async () => {
    const response = await POST(rawPostReq("null"), ctx("org-1"));
    expect(response.status).toBe(400);
  });

  it("rejects a string body", async () => {
    const response = await POST(rawPostReq(JSON.stringify("just a string")), ctx("org-1"));
    expect(response.status).toBe(400);
  });

  it("rejects malformed JSON", async () => {
    const response = await POST(rawPostReq("{not valid json"), ctx("org-1"));
    expect(response.status).toBe(400);
    expect(grantInternalOrganizationTrial).not.toHaveBeenCalled();
  });

  it("resolves duplicate JSON keys to the last occurrence (standard JSON.parse behavior) and validates that value", async () => {
    // JSON.parse keeps only the final value for a repeated key — there is no
    // "both values" to reason about at the route layer. Confirms that
    // behavior doesn't create a bypass: the last confirm value (true) must
    // still pass with a valid reason, and the last reason value is what's used.
    grantInternalOrganizationTrial.mockResolvedValueOnce({
      organizationId: "org-1",
      trialStartsAt: "2026-08-30T00:00:00.000Z",
      trialExpiresAt: "2026-09-29T00:00:00.000Z",
      accessActive: true,
      auditEventId: "audit-1",
    });
    const response = await POST(
      rawPostReq('{"reason":"short","reason":"Pilot access request","confirm":false,"confirm":true}'),
      ctx("org-1")
    );
    expect(response.status).toBe(201);
    expect(grantInternalOrganizationTrial).toHaveBeenCalledWith(expect.objectContaining({ reason: "Pilot access request" }));
  });
});
