import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "@/lib/rbac";

const requireVolunteerHoursAccess = vi.fn();
vi.mock("@/lib/labs/pta/volunteer-hours/guard", () => ({
  requireVolunteerHoursAccess: (...a: unknown[]) => requireVolunteerHoursAccess(...a),
}));

const updateAgreementPolicy = vi.fn();
vi.mock("@/lib/labs/pta/volunteer-hours/agreements", () => ({ updateAgreementPolicy: (...a: unknown[]) => updateAgreementPolicy(...a) }));

const params = Promise.resolve({ periodId: "period-1" });
const validBody = {
  agreementRequired: true,
  agreementVersionId: "v1",
  contractLinkedBuyoutEnabled: true,
  contractLinkedEligibilityDays: 14,
  contractLinkedUsesAcceptanceRate: true,
};

function putRequest(body: unknown) {
  return new Request("https://x.test", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireVolunteerHoursAccess.mockResolvedValue({ organizationId: "org-1", session: { userId: "u1", userEmail: "finance@example.test" } });
  updateAgreementPolicy.mockResolvedValue({ id: "period-1", ...validBody });
});

describe("PUT .../periods/[periodId]/agreement-policy", () => {
  it("requires the STRICTER buyout-pricing-manage permission, not merely requirements-manage -- a STAFF-shaped caller is rejected", async () => {
    const { PtaError } = await import("@/lib/labs/pta/errors");
    requireVolunteerHoursAccess.mockRejectedValue(new PtaError("PTA_ORGANIZATION_NOT_PTA_VERTICAL", "no permission"));

    const { PUT } = await import("../route");
    const res = await PUT(putRequest(validBody), { params });
    expect(res.status).not.toBe(200);
    expect(updateAgreementPolicy).not.toHaveBeenCalled();
  });

  it("calls requireVolunteerHoursAccess with PTA_VOLUNTEER_BUYOUT_PRICING_MANAGE against the buyout capability", async () => {
    const { PUT } = await import("../route");
    await PUT(putRequest(validBody), { params });
    expect(requireVolunteerHoursAccess).toHaveBeenCalledWith(PERMISSIONS.PTA_VOLUNTEER_BUYOUT_PRICING_MANAGE, "buyout");
  });

  it("passes through organizationId/periodId/actor from the guard, and the validated body, to updateAgreementPolicy", async () => {
    const { PUT } = await import("../route");
    await PUT(putRequest(validBody), { params });
    expect(updateAgreementPolicy).toHaveBeenCalledWith("org-1", "period-1", validBody, { userId: "u1", userEmail: "finance@example.test" });
  });

  it("rejects a body with an unrecognized extra field (strict schema)", async () => {
    const { PUT } = await import("../route");
    const res = await PUT(putRequest({ ...validBody, somethingElse: true }), { params });
    expect(res.status).not.toBe(200);
    expect(updateAgreementPolicy).not.toHaveBeenCalled();
  });

  it("rejects a negative or zero contractLinkedEligibilityDays at the schema layer", async () => {
    const { PUT } = await import("../route");
    const res1 = await PUT(putRequest({ ...validBody, contractLinkedEligibilityDays: 0 }), { params });
    expect(res1.status).not.toBe(200);
    const res2 = await PUT(putRequest({ ...validBody, contractLinkedEligibilityDays: -5 }), { params });
    expect(res2.status).not.toBe(200);
    expect(updateAgreementPolicy).not.toHaveBeenCalled();
  });
});
