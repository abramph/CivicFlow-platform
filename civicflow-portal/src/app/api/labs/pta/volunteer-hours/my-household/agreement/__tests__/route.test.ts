import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * feature/pta-family-agreement-buyout follow-up (FA2 §3). Route-level proof
 * for the data contract PtaVolunteerAgreementStatusCard depends on: identity
 * is resolved entirely server-side from the authenticated adult's own
 * household linkage (never a client-supplied householdId — there is no such
 * input on this GET route at all), a guard rejection (capability disabled)
 * propagates as an error rather than a fabricated "not required" response,
 * and a missing active period returns null cleanly instead of throwing.
 */

const requireVolunteerHoursHouseholdAccess = vi.fn();
const checkVolunteerHoursAvailable = vi.fn();
vi.mock("@/lib/labs/pta/volunteer-hours/guard", () => ({
  requireVolunteerHoursHouseholdAccess: (...a: unknown[]) => requireVolunteerHoursHouseholdAccess(...a),
  checkVolunteerHoursAvailable: (...a: unknown[]) => checkVolunteerHoursAvailable(...a),
}));

const getCurrentActivePeriod = vi.fn();
vi.mock("@/lib/labs/pta/volunteer-hours/periods", () => ({ getCurrentActivePeriod: (...a: unknown[]) => getCurrentActivePeriod(...a) }));

const resolveHouseholdAgreementStatus = vi.fn();
vi.mock("@/lib/labs/pta/volunteer-hours/agreements", () => ({
  resolveHouseholdAgreementStatus: (...a: unknown[]) => resolveHouseholdAgreementStatus(...a),
}));

beforeEach(() => {
  vi.clearAllMocks();
  requireVolunteerHoursHouseholdAccess.mockResolvedValue({ organizationId: "org-1", adult: { id: "adult-1", householdId: "hh-1" } });
  getCurrentActivePeriod.mockResolvedValue({ id: "period-1" });
  checkVolunteerHoursAvailable.mockResolvedValue(true);
  resolveHouseholdAgreementStatus.mockResolvedValue({
    required: true,
    assignedVersion: { id: "v1", title: "Agreement", versionNumber: 1 },
    acceptance: { id: "acc-1", acceptedAt: new Date().toISOString() },
    contractLinkedBuyoutEnabled: true,
    contractLinkedEligibleUntil: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
    contractLinkedEligibleNow: true,
  });
});

describe("GET .../my-household/agreement", () => {
  it("gates on the requirements capability (this is what the card's fail-closed behavior actually rests on)", async () => {
    const { GET } = await import("../route");
    await GET(new Request("https://x.test"));
    expect(requireVolunteerHoursHouseholdAccess).toHaveBeenCalledWith("requirements");
  });

  it("resolves the household entirely server-side from the guard, never from any request input -- there is no householdId field this route reads", async () => {
    const { GET } = await import("../route");
    await GET(new Request("https://x.test"));
    expect(resolveHouseholdAgreementStatus).toHaveBeenCalledWith("org-1", "period-1", "hh-1");
  });

  it("propagates a guard rejection (capability disabled) as an error response, never a fabricated status object the card could misread as 'nothing assigned'", async () => {
    const { PtaError } = await import("@/lib/labs/pta/errors");
    requireVolunteerHoursHouseholdAccess.mockRejectedValue(new PtaError("PTA_NOT_A_HOUSEHOLD_MEMBER", "not linked"));
    const { GET } = await import("../route");
    const res = await GET(new Request("https://x.test"));
    expect(res.status).not.toBe(200);
    expect(resolveHouseholdAgreementStatus).not.toHaveBeenCalled();
  });

  it("returns data: null (not an error, not a fabricated empty status) when there is no current active period at all", async () => {
    getCurrentActivePeriod.mockResolvedValue(null);
    const { GET } = await import("../route");
    const res = await GET(new Request("https://x.test"));
    const body = await res.json();
    expect(body).toEqual({ ok: true, data: null });
    expect(resolveHouseholdAgreementStatus).not.toHaveBeenCalled();
  });

  it("returns assignedVersion: null verbatim when the period has no agreement assigned -- this is exactly what makes the card self-hide, not a separate flag", async () => {
    resolveHouseholdAgreementStatus.mockResolvedValue({
      required: false,
      assignedVersion: null,
      acceptance: null,
      contractLinkedBuyoutEnabled: false,
      contractLinkedEligibleUntil: null,
      contractLinkedEligibleNow: false,
    });
    const { GET } = await import("../route");
    const res = await GET(new Request("https://x.test"));
    const body = await res.json();
    expect(body.data.assignedVersion).toBeNull();
  });

  it("honors an explicit ?periodId= override instead of the current active period", async () => {
    const { GET } = await import("../route");
    await GET(new Request("https://x.test?periodId=period-other"));
    expect(getCurrentActivePeriod).not.toHaveBeenCalled();
    expect(resolveHouseholdAgreementStatus).toHaveBeenCalledWith("org-1", "period-other", "hh-1");
  });

  describe("FA2 §4 (capability-guard rule 2/3): contract-linked buyout fields", () => {
    it("passes through the real contract-linked fields when the buyout capability is enabled for this org", async () => {
      const { GET } = await import("../route");
      const res = await GET(new Request("https://x.test"));
      const body = await res.json();
      expect(body.data.contractLinkedBuyoutEnabled).toBe(true);
      expect(body.data.contractLinkedEligibleNow).toBe(true);
      expect(body.data.contractLinkedEligibleUntil).not.toBeNull();
    });

    it("suppresses contract-linked fields to inert defaults when the buyout capability is disabled for this org -- even though the agreement itself remains fully visible/acceptable (rule 3)", async () => {
      checkVolunteerHoursAvailable.mockResolvedValue(false);
      const { GET } = await import("../route");
      const res = await GET(new Request("https://x.test"));
      const body = await res.json();
      expect(body.data.contractLinkedBuyoutEnabled).toBe(false);
      expect(body.data.contractLinkedEligibleNow).toBe(false);
      expect(body.data.contractLinkedEligibleUntil).toBeNull();
      // The agreement itself -- required/assignedVersion/acceptance -- is untouched.
      expect(body.data.assignedVersion).toEqual({ id: "v1", title: "Agreement", versionNumber: 1 });
      expect(body.data.acceptance).not.toBeNull();
    });

    it("checks the buyout capability without ever throwing on it -- a disabled buyout capability degrades the response, it never blocks the route (rule 3)", async () => {
      checkVolunteerHoursAvailable.mockResolvedValue(false);
      const { GET } = await import("../route");
      const res = await GET(new Request("https://x.test"));
      expect(res.status).toBe(200);
      expect(checkVolunteerHoursAvailable).toHaveBeenCalledWith("org-1", "buyout");
    });
  });
});
