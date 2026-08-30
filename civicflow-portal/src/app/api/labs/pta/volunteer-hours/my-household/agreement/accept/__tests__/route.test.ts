import { beforeEach, describe, expect, it, vi } from "vitest";

const requireVolunteerHoursHouseholdAccess = vi.fn();
vi.mock("@/lib/labs/pta/volunteer-hours/guard", () => ({
  requireVolunteerHoursHouseholdAccess: (...a: unknown[]) => requireVolunteerHoursHouseholdAccess(...a),
}));

const getCurrentActivePeriod = vi.fn();
vi.mock("@/lib/labs/pta/volunteer-hours/periods", () => ({ getCurrentActivePeriod: (...a: unknown[]) => getCurrentActivePeriod(...a) }));

const acceptAgreement = vi.fn();
vi.mock("@/lib/labs/pta/volunteer-hours/agreements", () => ({ acceptAgreement: (...a: unknown[]) => acceptAgreement(...a) }));

function jsonRequest(body: unknown) {
  return new Request("https://x.test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireVolunteerHoursHouseholdAccess.mockResolvedValue({
    organizationId: "org-1",
    session: { userId: "u1", userEmail: "parent@example.test" },
    adult: { id: "adult-1", householdId: "hh-1" },
  });
  getCurrentActivePeriod.mockResolvedValue({ id: "period-1" });
  acceptAgreement.mockResolvedValue({ id: "acc-1" });
});

describe("POST .../my-household/agreement/accept", () => {
  it("resolves organizationId/householdId/adultId entirely server-side -- the request body can never supply them", async () => {
    const { POST } = await import("../route");
    await POST(jsonRequest({ acknowledged: true, typedName: "Jane Doe" }));

    expect(acceptAgreement).toHaveBeenCalledWith(
      "org-1", // from the guard, never the body
      "period-1",
      "hh-1", // from adult.householdId, never the body
      { acknowledged: true, typedName: "Jane Doe" },
      { userId: "u1", adultId: "adult-1" } // from the guard/session, never the body
    );
  });

  it("a caller who is not an authorized household adult (guard throws) never reaches acceptAgreement", async () => {
    const { PtaError } = await import("@/lib/labs/pta/errors");
    requireVolunteerHoursHouseholdAccess.mockRejectedValue(new PtaError("PTA_NOT_A_HOUSEHOLD_MEMBER", "not linked"));

    const { POST } = await import("../route");
    const res = await POST(jsonRequest({ acknowledged: true }));

    expect(res.status).not.toBe(201);
    expect(acceptAgreement).not.toHaveBeenCalled();
  });

  it("an unrecognized extra field in the body is rejected (strict schema) -- a client cannot smuggle e.g. householdId or organizationId through", async () => {
    const { POST } = await import("../route");
    const res = await POST(jsonRequest({ acknowledged: true, householdId: "someone-elses-household" }));
    expect(res.status).not.toBe(201);
    expect(acceptAgreement).not.toHaveBeenCalled();
  });

  it("falls back to the current active period when periodId is omitted, and 404s cleanly when none is active", async () => {
    getCurrentActivePeriod.mockResolvedValue(null);
    const { POST } = await import("../route");
    const res = await POST(jsonRequest({ acknowledged: true }));
    const data = await res.json();
    expect(res.status).toBe(404);
    expect(data.ok).toBe(false);
    expect(acceptAgreement).not.toHaveBeenCalled();
  });
});
