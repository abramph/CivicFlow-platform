import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePermission = vi.fn();
vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return { ...actual, requirePermission: (...args: unknown[]) => requirePermission(...args) };
});

const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

const findUnique = vi.fn();
const update = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgSettings: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}));

import { PUT } from "@/app/api/payments/cost-policy/route";

function buildRequest(body: object) {
  return new Request("https://app.getunestra.com/api/payments/cost-policy", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const EXISTING = {
  paymentCostPolicyV2Enabled: false,
  fixedObligationCoveragePolicy: "ORGANIZATION_ABSORBS",
  voluntaryCoveragePolicy: "OPTIONAL",
  ineligiblePaymentMethodFallback: "ORGANIZATION_ABSORBS",
  fixedObligationPaymentPreference: "CARD_AND_ABSORB",
  achEnabled: false,
  policyAcceptedAt: null,
  policyAcceptedByUserId: null,
  policyVersion: null,
};

describe("PUT /api/payments/cost-policy (COST-POLICY §6/§13, LAUNCH-SAFE gating)", () => {
  beforeEach(() => {
    requirePermission.mockReset();
    requirePermission.mockResolvedValue({
      organizationId: "org-1",
      session: { userId: "admin-1", userEmail: "admin@example.org" },
    });
    findUnique.mockReset();
    findUnique.mockResolvedValue(EXISTING);
    update.mockReset();
    update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...EXISTING, ...data }));
    createAuditEvent.mockClear();
    delete process.env.MANDATORY_OBLIGATION_COVERAGE;
    delete process.env.PAYMENT_METHOD_ELIGIBILITY_CHECK;
  });

  it("LAUNCH-SAFE §3: REQUIRED_WHERE_PERMITTED is refused while the capability is unavailable — even with acceptPolicy", async () => {
    const response = await PUT(
      buildRequest({ fixedObligationCoveragePolicy: "REQUIRED_WHERE_PERMITTED", acceptPolicy: true })
    );
    expect(response.status).toBe(409);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toMatch(/not currently available/i);
    expect(update).not.toHaveBeenCalled();
    expect(createAuditEvent).not.toHaveBeenCalled();
  });

  it("with the capability flags on, REQUIRED still needs the acknowledgment first", async () => {
    process.env.MANDATORY_OBLIGATION_COVERAGE = "true";
    process.env.PAYMENT_METHOD_ELIGIBILITY_CHECK = "true";
    const response = await PUT(buildRequest({ fixedObligationCoveragePolicy: "REQUIRED_WHERE_PERMITTED" }));
    expect(response.status).toBe(409);
    expect(update).not.toHaveBeenCalled();
  });

  it("acceptPolicy records who acknowledged, when, and which policy version", async () => {
    const response = await PUT(buildRequest({ acceptPolicy: true }));
    expect(response.status).toBe(200);
    const data = update.mock.calls[0][0].data;
    expect(data.policyAcceptedByUserId).toBe("admin-1");
    expect(data.policyAcceptedAt).toBeInstanceOf(Date);
    expect(data.policyVersion).toBe("v2.0");
  });

  it("LAUNCH-SAFE §1: REQUIRE_ACH is refused while ACH is not enabled", async () => {
    const response = await PUT(buildRequest({ fixedObligationPaymentPreference: "REQUIRE_ACH" }));
    expect(response.status).toBe(409);
    expect(update).not.toHaveBeenCalled();

    const ok = await PUT(buildRequest({ fixedObligationPaymentPreference: "REQUIRE_ACH", achEnabled: true }));
    expect(ok.status).toBe(200);
  });

  it("§13: every change is audited with previous and next values", async () => {
    await PUT(buildRequest({ voluntaryCoveragePolicy: "ORGANIZATION_ABSORBS", acceptPolicy: false }));
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        entityType: "payment_cost_policy",
        metadata: expect.objectContaining({
          actorUserId: "admin-1",
          previous: expect.objectContaining({ voluntaryCoveragePolicy: "OPTIONAL" }),
          next: expect.objectContaining({ voluntaryCoveragePolicy: "ORGANIZATION_ABSORBS" }),
        }),
      })
    );
  });

  it("there is no field that overrides technical eligibility — unknown keys are stripped", async () => {
    const response = await PUT(
      buildRequest({
        achEnabled: true,
        overrideEligibility: true,
        forceSurcharge: true,
        cardNetworkCapOverride: 9999,
      } as never)
    );
    expect(response.status).toBe(200);
    const data = update.mock.calls[0][0].data;
    expect(Object.keys(data)).toEqual(["achEnabled"]);
  });
});
