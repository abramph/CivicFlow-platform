import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Build 27 — parent contact self-edit. The load-bearing property: the adult
 * row being edited comes from the caller's own linkage, never from the
 * request, so there is no way to address anyone else's row.
 */

const requireMobilePtaHouseholdAccess = vi.fn();
vi.mock("@/lib/mobile-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mobile-auth")>();
  return { ...actual, requireMobilePtaHouseholdAccess: (...a: unknown[]) => requireMobilePtaHouseholdAccess(...a) };
});

const updateOwnPtaHouseholdAdult = vi.fn();
vi.mock("@/lib/labs/pta/households", () => ({
  updateOwnPtaHouseholdAdult: (...a: unknown[]) => updateOwnPtaHouseholdAdult(...a),
}));

const requireRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: (...a: unknown[]) => requireRateLimit(...a) }));

import { PATCH } from "../adult/route";

const ACCESS = {
  organizationId: "org-1",
  adult: { id: "adult-self", householdId: "hh-1", billingMemberId: null },
  session: { userId: "user-1", email: "parent@example.org" },
};

function request(body: unknown) {
  return new Request("https://portal.test/api/mobile/pta/my/adult?organizationId=org-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireMobilePtaHouseholdAccess.mockResolvedValue(ACCESS);
  requireRateLimit.mockResolvedValue(null);
  updateOwnPtaHouseholdAdult.mockResolvedValue({ id: "adult-self", name: "Casey Kim", email: "new@example.org", phone: null, relationshipLabel: "Mom" });
});

describe("PATCH /api/mobile/pta/my/adult", () => {
  it("updates ONLY the caller's own linkage-resolved adult row", async () => {
    const res = await PATCH(request({ email: "new@example.org" }));
    expect(res.status).toBe(200);
    expect(updateOwnPtaHouseholdAdult).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", adultId: "adult-self", email: "new@example.org", actorUserId: "user-1" })
    );
  });

  it("ignores any adultId a client tries to smuggle into the body", async () => {
    await PATCH(request({ adultId: "someone-else", email: "new@example.org" }));
    const call = updateOwnPtaHouseholdAdult.mock.calls[0][0] as Record<string, unknown>;
    expect(call.adultId).toBe("adult-self");
  });

  it("rejects an invalid email with 400 before any write", async () => {
    const res = await PATCH(request({ email: "not-an-email" }));
    expect(res.status).toBe(400);
    expect(updateOwnPtaHouseholdAdult).not.toHaveBeenCalled();
  });

  it("propagates the household guard's denial", async () => {
    const { MobileForbiddenError } = await import("@/lib/mobile-auth");
    requireMobilePtaHouseholdAccess.mockRejectedValueOnce(new MobileForbiddenError("no household"));
    const res = await PATCH(request({ email: "new@example.org" }));
    expect(res.status).toBe(403);
    expect(updateOwnPtaHouseholdAdult).not.toHaveBeenCalled();
  });
});
