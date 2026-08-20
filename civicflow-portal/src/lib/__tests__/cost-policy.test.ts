import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueOrgSettings = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { orgSettings: { findUnique: (...a: unknown[]) => findUniqueOrgSettings(...a) } },
}));

import { derivePaymentNature, resolveCoveragePlan } from "@/lib/payments/cost-policy";

/** §14 classification tests — the nature comes from what the payment IS,
 * never from the vertical and never from the client. */
describe("derivePaymentNature (COST-POLICY §2)", () => {
  it("union / PTA / community dues are fixed obligations", () => {
    expect(derivePaymentNature({ purpose: "member-dues" })).toBe("FIXED_OBLIGATION");
    expect(derivePaymentNature({ purpose: "payment-link-dues" })).toBe("FIXED_OBLIGATION");
  });

  it("a church donation is voluntary; a PTA fundraiser donation is voluntary", () => {
    expect(derivePaymentNature({ purpose: "giving" })).toBe("VOLUNTARY");
    expect(derivePaymentNature({ purpose: "public-give" })).toBe("VOLUNTARY");
    expect(derivePaymentNature({ purpose: "payment-link-campaign" })).toBe("VOLUNTARY");
  });

  it("a church event ticket (event-registration link) is a fixed purchase", () => {
    expect(derivePaymentNature({ purpose: "payment-link-event" })).toBe("FIXED_OBLIGATION");
  });

  it("payroll-deducted union dues are offline", () => {
    expect(derivePaymentNature({ purpose: "offline-entry" })).toBe("OFFLINE");
  });

  it("a REQUIRED DUES-type contribution program is a fixed obligation; every other program stays voluntary", () => {
    expect(
      derivePaymentNature({ purpose: "giving", programType: "DUES", programObligationNature: "REQUIRED" })
    ).toBe("FIXED_OBLIGATION");
    expect(
      derivePaymentNature({ purpose: "giving", programType: "FUNDRAISER", programObligationNature: "VOLUNTARY" })
    ).toBe("VOLUNTARY");
    // REQUIRED is only legal on DUES — a mislabeled program cannot create an obligation.
    expect(
      derivePaymentNature({ purpose: "giving", programType: "FUNDRAISER", programObligationNature: "REQUIRED" })
    ).toBe("VOLUNTARY");
  });
});

const LEGACY_SETTINGS = {
  paymentCostPolicyV2Enabled: false,
  fixedObligationCoveragePolicy: "ORGANIZATION_ABSORBS",
  voluntaryCoveragePolicy: "OPTIONAL",
  ineligiblePaymentMethodFallback: "ORGANIZATION_ABSORBS",
  achEnabled: false,
  policyAcceptedAt: null,
  policyVersion: null,
  processingCostCoverageMode: "OPTIONAL_CONTRIBUTOR_COVERAGE",
  processingCostCoveragePercentBps: 290,
  processingCostCoverageFixedCents: 30,
};

describe("resolveCoveragePlan (COST-POLICY §3)", () => {
  beforeEach(() => {
    findUniqueOrgSettings.mockReset();
    delete process.env.MANDATORY_OBLIGATION_COVERAGE;
    delete process.env.PAYMENT_METHOD_ELIGIBILITY_CHECK;
  });
  afterEach(() => {
    delete process.env.MANDATORY_OBLIGATION_COVERAGE;
    delete process.env.PAYMENT_METHOD_ELIGIBILITY_CHECK;
  });

  it("v2 disabled reproduces legacy CONNECT-F behavior exactly — for every nature", async () => {
    findUniqueOrgSettings.mockResolvedValue(LEGACY_SETTINGS);

    // $5.00 at 290bps+30¢ → 46¢ (the live-verified production number).
    const optedIn = await resolveCoveragePlan({
      organizationId: "org-1",
      nature: "FIXED_OBLIGATION",
      baseCents: 500,
      payerOptedIn: true,
    });
    expect(optedIn).toMatchObject({ offered: true, required: false, coverageCents: 46, totalCents: 546, coverageMode: "LEGACY_OPTIONAL" });

    const declined = await resolveCoveragePlan({ organizationId: "org-1", nature: "VOLUNTARY", baseCents: 500, payerOptedIn: false });
    expect(declined).toMatchObject({ offered: true, coverageCents: 0, totalCents: 500 });
  });

  it("OFFLINE never gets an online processing cost, in any configuration", async () => {
    findUniqueOrgSettings.mockResolvedValue({ ...LEGACY_SETTINGS, paymentCostPolicyV2Enabled: true });
    const plan = await resolveCoveragePlan({ organizationId: "org-1", nature: "OFFLINE", baseCents: 1000, payerOptedIn: true });
    expect(plan).toMatchObject({ offered: false, required: false, coverageCents: 0, totalCents: 1000 });
  });

  it("v2 voluntary OPTIONAL keeps the unchecked opt-in; ORGANIZATION_ABSORBS hides it", async () => {
    findUniqueOrgSettings.mockResolvedValue({ ...LEGACY_SETTINGS, paymentCostPolicyV2Enabled: true });
    const optional = await resolveCoveragePlan({ organizationId: "org-1", nature: "VOLUNTARY", baseCents: 2500, payerOptedIn: true });
    expect(optional).toMatchObject({ offered: true, required: false, coverageMode: "V2_OPTIONAL", coverageCents: 106, totalCents: 2606 });

    findUniqueOrgSettings.mockResolvedValue({
      ...LEGACY_SETTINGS,
      paymentCostPolicyV2Enabled: true,
      voluntaryCoveragePolicy: "ORGANIZATION_ABSORBS",
    });
    const absorbed = await resolveCoveragePlan({ organizationId: "org-1", nature: "VOLUNTARY", baseCents: 2500, payerOptedIn: true });
    expect(absorbed).toMatchObject({ offered: false, coverageCents: 0, totalCents: 2500, coverageMode: "V2_ORGANIZATION_ABSORBED" });
  });

  it("§4: a $10 obligation with the org absorbing the fee charges exactly $10 — the member is credited in full", async () => {
    findUniqueOrgSettings.mockResolvedValue({ ...LEGACY_SETTINGS, paymentCostPolicyV2Enabled: true });
    const plan = await resolveCoveragePlan({ organizationId: "org-1", nature: "FIXED_OBLIGATION", baseCents: 1000, payerOptedIn: false });
    expect(plan).toMatchObject({ offered: false, required: false, coverageCents: 0, totalCents: 1000, coverageMode: "V2_ORGANIZATION_ABSORBED" });
  });

  it("REQUIRED_WHERE_PERMITTED without a compliant eligibility mechanism resolves to the configured fallback (never a home-grown surcharge)", async () => {
    findUniqueOrgSettings.mockResolvedValue({
      ...LEGACY_SETTINGS,
      paymentCostPolicyV2Enabled: true,
      fixedObligationCoveragePolicy: "REQUIRED_WHERE_PERMITTED",
      policyAcceptedAt: new Date(),
      policyVersion: "v2.0",
    });
    const plan = await resolveCoveragePlan({ organizationId: "org-1", nature: "FIXED_OBLIGATION", baseCents: 1000, payerOptedIn: false });
    expect(plan.required).toBe(false);
    expect(plan.coverageCents).toBe(0);
    expect(plan.totalCents).toBe(1000);
    expect(plan.coverageMode).toBe("V2_FALLBACK_ORGANIZATION_ABSORBED");
  });

  it("REQUIRE_ACH fallback restricts payment methods when ACH is enabled, and degrades to absorb when it is not", async () => {
    findUniqueOrgSettings.mockResolvedValue({
      ...LEGACY_SETTINGS,
      paymentCostPolicyV2Enabled: true,
      fixedObligationCoveragePolicy: "REQUIRED_WHERE_PERMITTED",
      ineligiblePaymentMethodFallback: "REQUIRE_ACH",
      achEnabled: true,
      policyAcceptedAt: new Date(),
    });
    const ach = await resolveCoveragePlan({ organizationId: "org-1", nature: "FIXED_OBLIGATION", baseCents: 1000, payerOptedIn: false });
    expect(ach.restrictToPaymentMethods).toEqual(["us_bank_account"]);
    expect(ach.totalCents).toBe(1000);

    findUniqueOrgSettings.mockResolvedValue({
      ...LEGACY_SETTINGS,
      paymentCostPolicyV2Enabled: true,
      fixedObligationCoveragePolicy: "REQUIRED_WHERE_PERMITTED",
      ineligiblePaymentMethodFallback: "REQUIRE_ACH",
      achEnabled: false,
      policyAcceptedAt: new Date(),
    });
    const degraded = await resolveCoveragePlan({ organizationId: "org-1", nature: "FIXED_OBLIGATION", baseCents: 1000, payerOptedIn: false });
    expect(degraded.restrictToPaymentMethods).toBeNull();
    expect(degraded.coverageMode).toBe("V2_FALLBACK_ORGANIZATION_ABSORBED");
    expect(degraded.totalCents).toBe(1000);
  });

  it("mandatory coverage activates ONLY with both global flags AND the §6 acknowledgment", async () => {
    const requiredSettings = {
      ...LEGACY_SETTINGS,
      paymentCostPolicyV2Enabled: true,
      fixedObligationCoveragePolicy: "REQUIRED_WHERE_PERMITTED",
      policyAcceptedAt: new Date(),
      policyVersion: "v2.0",
    };
    findUniqueOrgSettings.mockResolvedValue(requiredSettings);

    process.env.MANDATORY_OBLIGATION_COVERAGE = "true";
    // Eligibility flag still off → fallback.
    let plan = await resolveCoveragePlan({ organizationId: "org-1", nature: "FIXED_OBLIGATION", baseCents: 1000, payerOptedIn: false });
    expect(plan.required).toBe(false);

    process.env.PAYMENT_METHOD_ELIGIBILITY_CHECK = "true";
    plan = await resolveCoveragePlan({ organizationId: "org-1", nature: "FIXED_OBLIGATION", baseCents: 1000, payerOptedIn: false });
    // $10.00 at 290bps+30¢: ceil(1030/0.971) = 1061 → 61¢ (the §8 example).
    expect(plan).toMatchObject({ offered: true, required: true, coverageCents: 61, totalCents: 1061, coverageMode: "V2_REQUIRED" });

    // Without the acknowledgment, both flags are not enough.
    findUniqueOrgSettings.mockResolvedValue({ ...requiredSettings, policyAcceptedAt: null });
    plan = await resolveCoveragePlan({ organizationId: "org-1", nature: "FIXED_OBLIGATION", baseCents: 1000, payerOptedIn: false });
    expect(plan.required).toBe(false);
  });

  it("rounding is deterministic integer minor units — never floating-point currency", async () => {
    findUniqueOrgSettings.mockResolvedValue(LEGACY_SETTINGS);
    for (const base of [1, 99, 101, 33333, 999999]) {
      const plan = await resolveCoveragePlan({ organizationId: "org-1", nature: "VOLUNTARY", baseCents: base, payerOptedIn: true });
      expect(Number.isInteger(plan.coverageCents)).toBe(true);
      expect(plan.totalCents).toBe(base + plan.coverageCents);
      // Gross-up property: the processor's cut of the total leaves >= base.
      expect(plan.totalCents - (plan.totalCents * 0.029 + 30)).toBeGreaterThanOrEqual(base - 1e-9);
    }
  });
});
