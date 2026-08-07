import { beforeEach, describe, expect, it, vi } from "vitest";

const requireMobileAuth = vi.fn();
vi.mock("@/lib/mobile-auth", () => ({
  requireMobileAuth: (...args: unknown[]) => requireMobileAuth(...args),
  MobileAuthError: class MobileAuthError extends Error {
    status = 401;
  },
  MobileForbiddenError: class MobileForbiddenError extends Error {
    status = 403;
  },
}));

const resolveMobileAdminCapabilities = vi.fn();
vi.mock("@/lib/mobile-admin", () => ({
  resolveMobileAdminCapabilities: (...args: unknown[]) => resolveMobileAdminCapabilities(...args),
}));

const terminateMember = vi.fn();
const reinstateMember = vi.fn();
vi.mock("@/lib/member-lifecycle", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/member-lifecycle")>();
  return {
    ...actual,
    terminateMember: (...args: unknown[]) => terminateMember(...args),
    reinstateMember: (...args: unknown[]) => reinstateMember(...args),
  };
});

vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

import { POST as terminatePost } from "@/app/api/mobile/admin/members/[memberId]/terminate/route";
import { POST as reinstatePost } from "@/app/api/mobile/admin/members/[memberId]/reinstate/route";
import { MemberLifecycleError } from "@/lib/member-lifecycle-errors";

function req(path: string, body: Record<string, unknown>) {
  return new Request(`https://portal.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
    body: JSON.stringify(body),
  });
}

function params() {
  return { params: Promise.resolve({ memberId: "member-1" }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileAuth.mockResolvedValue({ userId: "user-1", email: "officer@example.com" });
});

describe("POST /api/mobile/admin/members/[memberId]/terminate", () => {
  it("returns 403 without manageMembers, resolved fresh for the request's own organizationId", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: false, role: null, adminCapabilities: [] });

    const response = await terminatePost(
      req("/api/mobile/admin/members/member-1/terminate", {
        organizationId: "org-victim",
        reasonCode: "RESIGNED_VOLUNTARY",
        effectiveDate: "2026-08-07",
      }),
      params()
    );

    expect(response.status).toBe(403);
    expect(resolveMobileAdminCapabilities).toHaveBeenCalledWith("org-victim", "user-1");
    expect(terminateMember).not.toHaveBeenCalled();
  });

  it("rejects a missing reasonCode with 400 before calling the service", async () => {
    const response = await terminatePost(
      req("/api/mobile/admin/members/member-1/terminate", { organizationId: "org-a", effectiveDate: "2026-08-07" }),
      params()
    );
    expect(response.status).toBe(400);
    expect(resolveMobileAdminCapabilities).not.toHaveBeenCalled();
  });

  it("delegates to the exact same terminateMember() service the web route uses, scoped by the verified org/actor, never client-supplied values overriding them", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "ORG_OWNER", adminCapabilities: ["manageMembers"] });
    terminateMember.mockResolvedValueOnce({ id: "member-1", membershipStatus: "terminated" });

    const response = await terminatePost(
      req("/api/mobile/admin/members/member-1/terminate", {
        organizationId: "org-a",
        reasonCode: "RESIGNED_VOLUNTARY",
        effectiveDate: "2026-08-07",
      }),
      params()
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.membershipStatus).toBe("terminated");
    expect(terminateMember).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-a", memberId: "member-1", actorUserId: "user-1", actorEmail: "officer@example.com" })
    );
  });

  it("propagates LAST_OWNER_CANNOT_BE_TERMINATED as a 409 -- the last-owner protection is preserved, not reimplemented", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "ORG_OWNER", adminCapabilities: ["manageMembers"] });
    terminateMember.mockRejectedValueOnce(
      new MemberLifecycleError("LAST_OWNER_CANNOT_BE_TERMINATED", "This member holds the organization's only active owner access.")
    );

    const response = await terminatePost(
      req("/api/mobile/admin/members/member-1/terminate", {
        organizationId: "org-a",
        reasonCode: "RESIGNED_VOLUNTARY",
        effectiveDate: "2026-08-07",
      }),
      params()
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe("LAST_OWNER_CANNOT_BE_TERMINATED");
  });
});

describe("POST /api/mobile/admin/members/[memberId]/reinstate", () => {
  it("returns 403 without manageMembers", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: false, role: null, adminCapabilities: [] });

    const response = await reinstatePost(
      req("/api/mobile/admin/members/member-1/reinstate", { organizationId: "org-a", reason: "Paid back dues", effectiveDate: "2026-08-07" }),
      params()
    );
    expect(response.status).toBe(403);
    expect(reinstateMember).not.toHaveBeenCalled();
  });

  it("rejects a blank reason with 400", async () => {
    const response = await reinstatePost(
      req("/api/mobile/admin/members/member-1/reinstate", { organizationId: "org-a", reason: "", effectiveDate: "2026-08-07" }),
      params()
    );
    expect(response.status).toBe(400);
  });

  it("delegates to the same reinstateMember() service the web route uses", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "ORG_OWNER", adminCapabilities: ["manageMembers"] });
    reinstateMember.mockResolvedValueOnce({ id: "member-1", membershipStatus: "active" });

    const response = await reinstatePost(
      req("/api/mobile/admin/members/member-1/reinstate", { organizationId: "org-a", reason: "Paid back dues", effectiveDate: "2026-08-07" }),
      params()
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.membershipStatus).toBe("active");
    expect(reinstateMember).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-a", memberId: "member-1", actorUserId: "user-1", actorEmail: "officer@example.com" })
    );
  });
});
