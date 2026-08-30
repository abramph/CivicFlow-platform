import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * RV-4: route-level coverage for the buyout-policy fields newly accepted by
 * POST /api/labs/pta/volunteer-hours/periods and PATCH .../[periodId] — the
 * service layer (periods.test.ts) already covers validateBuyoutPolicy's
 * actual rules exhaustively; this file proves the route's zod schema
 * accepts the new fields' valid shapes, rejects malformed ones before ever
 * reaching the service, and is gated by the same
 * pta:volunteer-requirements:manage permission (+ platform/org flag) as
 * every other write on this resource.
 */
const requireVolunteerHoursAccess = vi.fn();
vi.mock("@/lib/labs/pta/volunteer-hours/guard", () => ({
  requireVolunteerHoursAccess: (...a: unknown[]) => requireVolunteerHoursAccess(...a),
}));

const createVolunteerRequirementPeriod = vi.fn();
const updateVolunteerRequirementPeriod = vi.fn();
const listVolunteerRequirementPeriods = vi.fn();
const getVolunteerRequirementPeriod = vi.fn();
vi.mock("@/lib/labs/pta/volunteer-hours/periods", () => ({
  createVolunteerRequirementPeriod: (...a: unknown[]) => createVolunteerRequirementPeriod(...a),
  updateVolunteerRequirementPeriod: (...a: unknown[]) => updateVolunteerRequirementPeriod(...a),
  listVolunteerRequirementPeriods: (...a: unknown[]) => listVolunteerRequirementPeriods(...a),
  getVolunteerRequirementPeriod: (...a: unknown[]) => getVolunteerRequirementPeriod(...a),
}));

const session = { userId: "u1", userEmail: "officer@example.com" };
const baseBody = {
  name: "2026-2027 School Year",
  periodType: "SCHOOL_YEAR",
  startsOn: "2026-08-01",
  endsOn: "2027-06-01",
  requiredMinutesDefault: 1200,
};

function makeRequest(url: string, method: string, body: unknown) {
  return new Request(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireVolunteerHoursAccess.mockResolvedValue({ organizationId: "org-1", session });
  createVolunteerRequirementPeriod.mockResolvedValue({ id: "period-1" });
  updateVolunteerRequirementPeriod.mockResolvedValue({ id: "period-1" });
});

describe("POST /api/labs/pta/volunteer-hours/periods -- buyout policy field shape", () => {
  it("accepts and forwards a full set of buyout-policy fields to the service, requiring pta:volunteer-requirements:manage", async () => {
    const { POST } = await import("@/app/api/labs/pta/volunteer-hours/periods/route");
    const res = await POST(
      makeRequest("https://x/api/labs/pta/volunteer-hours/periods", "POST", {
        ...baseBody,
        buyoutFullAllowed: false,
        buyoutMinPurchaseMinutes: 120,
        buyoutMaxPurchaseMinutes: 900,
        buyoutMinServiceMinutes: 300,
        buyoutIncrementMinutes: 30,
      })
    );
    expect(res.status).toBe(201);
    expect(requireVolunteerHoursAccess).toHaveBeenCalledWith("pta:volunteer-requirements:manage", "requirements");
    expect(createVolunteerRequirementPeriod).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({
        buyoutFullAllowed: false,
        buyoutMinPurchaseMinutes: 120,
        buyoutMaxPurchaseMinutes: 900,
        buyoutMinServiceMinutes: 300,
        buyoutIncrementMinutes: 30,
      }),
      expect.objectContaining({ userId: "u1" })
    );
  });

  it("omits the buyout-policy fields entirely when the caller doesn't send them -- the service's own defaults apply, the route never invents one", async () => {
    const { POST } = await import("@/app/api/labs/pta/volunteer-hours/periods/route");
    await POST(makeRequest("https://x/api/labs/pta/volunteer-hours/periods", "POST", baseBody));
    const forwarded = createVolunteerRequirementPeriod.mock.calls[0][1];
    expect(forwarded.buyoutFullAllowed).toBeUndefined();
    expect(forwarded.buyoutMinPurchaseMinutes).toBeUndefined();
    expect(forwarded.buyoutIncrementMinutes).toBeUndefined();
  });

  it("rejects a non-integer buyout minute field before it ever reaches the service", async () => {
    const { POST } = await import("@/app/api/labs/pta/volunteer-hours/periods/route");
    const res = await POST(makeRequest("https://x/api/labs/pta/volunteer-hours/periods", "POST", { ...baseBody, buyoutMinPurchaseMinutes: 12.5 }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(createVolunteerRequirementPeriod).not.toHaveBeenCalled();
  });

  it("rejects a negative buyout minute field before it ever reaches the service", async () => {
    const { POST } = await import("@/app/api/labs/pta/volunteer-hours/periods/route");
    const res = await POST(makeRequest("https://x/api/labs/pta/volunteer-hours/periods", "POST", { ...baseBody, buyoutMaxPurchaseMinutes: -1 }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(createVolunteerRequirementPeriod).not.toHaveBeenCalled();
  });

  it("rejects a non-boolean buyoutFullAllowed before it ever reaches the service", async () => {
    const { POST } = await import("@/app/api/labs/pta/volunteer-hours/periods/route");
    const res = await POST(makeRequest("https://x/api/labs/pta/volunteer-hours/periods", "POST", { ...baseBody, buyoutFullAllowed: "yes" }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(createVolunteerRequirementPeriod).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/labs/pta/volunteer-hours/periods/[periodId] -- buyout policy field shape", () => {
  it("forwards an explicit null for a nullable buyout field distinctly from an omitted one", async () => {
    const { PATCH } = await import("@/app/api/labs/pta/volunteer-hours/periods/[periodId]/route");
    await PATCH(makeRequest("https://x/api/labs/pta/volunteer-hours/periods/period-1", "PATCH", { ...baseBody, buyoutMinPurchaseMinutes: null }), {
      params: Promise.resolve({ periodId: "period-1" }),
    });
    const forwarded = updateVolunteerRequirementPeriod.mock.calls[0][2];
    expect(forwarded.buyoutMinPurchaseMinutes).toBeNull();
    expect(forwarded.buyoutMaxPurchaseMinutes).toBeUndefined();
    expect(requireVolunteerHoursAccess).toHaveBeenCalledWith("pta:volunteer-requirements:manage", "requirements");
  });

  it("propagates the service's PTA_VOLUNTEER_PERIOD_INVALID_BUYOUT_POLICY rejection as a non-2xx response", async () => {
    const { PtaError } = await import("@/lib/labs/pta/errors");
    updateVolunteerRequirementPeriod.mockRejectedValue(new PtaError("PTA_VOLUNTEER_PERIOD_INVALID_BUYOUT_POLICY", "bad policy"));
    const { PATCH } = await import("@/app/api/labs/pta/volunteer-hours/periods/[periodId]/route");
    const res = await PATCH(makeRequest("https://x/api/labs/pta/volunteer-hours/periods/period-1", "PATCH", { ...baseBody, buyoutMinPurchaseMinutes: 999 }), {
      params: Promise.resolve({ periodId: "period-1" }),
    });
    expect(res.status).toBe(400);
  });
});
