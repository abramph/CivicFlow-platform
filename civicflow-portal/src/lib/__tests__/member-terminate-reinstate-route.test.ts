import { beforeEach, describe, expect, it, vi } from "vitest";

const canFn = vi.fn().mockReturnValue(true);
vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return {
    ...actual,
    requireOrganization: vi.fn().mockResolvedValue({
      session: { userId: "admin-1", userEmail: "admin@org-a.example.com" },
      organizationId: "org-a",
      role: "ORG_ADMIN",
      can: (...a: unknown[]) => canFn(...a),
    }),
  };
});

const terminateMember = vi.fn();
const reinstateMember = vi.fn();
vi.mock("@/lib/member-lifecycle", () => ({
  terminateMember: (...a: unknown[]) => terminateMember(...a),
  reinstateMember: (...a: unknown[]) => reinstateMember(...a),
}));

vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

import { MemberLifecycleError } from "@/lib/member-lifecycle-errors";
import { POST as terminateRoute } from "@/app/api/members/[id]/terminate/route";
import { POST as reinstateRoute } from "@/app/api/members/[id]/reinstate/route";

function req(url: string, body: Record<string, unknown>) {
  return new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  canFn.mockReturnValue(true);
});

describe("POST /api/members/[id]/terminate", () => {
  it("returns 403 with code INSUFFICIENT_PERMISSION and never calls the service when the caller lacks members:terminate", async () => {
    canFn.mockReturnValue(false);
    const response = await terminateRoute(
      req("https://portal.test/api/members/member-1/terminate", { reasonCode: "RESIGNED_VOLUNTARY", effectiveDate: "2026-08-01" }),
      params("member-1")
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.code).toBe("INSUFFICIENT_PERMISSION");
    expect(terminateMember).not.toHaveBeenCalled();
  });

  it("calls terminateMember with the org/actor/member scoped from the session, not the client", async () => {
    terminateMember.mockResolvedValueOnce({ id: "member-1", membershipStatus: "terminated" });
    const response = await terminateRoute(
      req("https://portal.test/api/members/member-1/terminate", {
        reasonCode: "RESIGNED_VOLUNTARY",
        effectiveDate: "2026-08-01",
        internalNotes: "left the org",
      }),
      params("member-1")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(terminateMember).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-a", memberId: "member-1", actorUserId: "admin-1", reasonCode: "RESIGNED_VOLUNTARY" })
    );
  });

  it("rejects an unrecognized reasonCode with a 400 field error before ever calling the service", async () => {
    const response = await terminateRoute(
      req("https://portal.test/api/members/member-1/terminate", { reasonCode: "MADE_UP_REASON", effectiveDate: "2026-08-01" }),
      params("member-1")
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.details.fieldErrors.reasonCode).toBeDefined();
    expect(terminateMember).not.toHaveBeenCalled();
  });

  it("surfaces a MemberLifecycleError thrown by the service with its structured code and status", async () => {
    terminateMember.mockRejectedValueOnce(new MemberLifecycleError("LAST_OWNER_CANNOT_BE_TERMINATED", "Assign owner access to someone else first."));
    const response = await terminateRoute(
      req("https://portal.test/api/members/member-1/terminate", { reasonCode: "RESIGNED_VOLUNTARY", effectiveDate: "2026-08-01" }),
      params("member-1")
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe("LAST_OWNER_CANNOT_BE_TERMINATED");
  });
});

describe("POST /api/members/[id]/reinstate", () => {
  it("returns 403 with code INSUFFICIENT_PERMISSION when the caller lacks members:terminate", async () => {
    canFn.mockReturnValue(false);
    const response = await reinstateRoute(
      req("https://portal.test/api/members/member-1/reinstate", { reason: "Paid balance", effectiveDate: "2026-08-01" }),
      params("member-1")
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.code).toBe("INSUFFICIENT_PERMISSION");
    expect(reinstateMember).not.toHaveBeenCalled();
  });

  it("calls reinstateMember with the org/actor/member scoped from the session", async () => {
    reinstateMember.mockResolvedValueOnce({ id: "member-1", membershipStatus: "active" });
    const response = await reinstateRoute(
      req("https://portal.test/api/members/member-1/reinstate", { reason: "Paid balance", effectiveDate: "2026-08-01" }),
      params("member-1")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(reinstateMember).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-a", memberId: "member-1", actorUserId: "admin-1", reason: "Paid balance" })
    );
  });

  it("rejects a blank reason with a 400 field error before ever calling the service", async () => {
    const response = await reinstateRoute(
      req("https://portal.test/api/members/member-1/reinstate", { reason: "", effectiveDate: "2026-08-01" }),
      params("member-1")
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.details.fieldErrors.reason).toBeDefined();
    expect(reinstateMember).not.toHaveBeenCalled();
  });
});
