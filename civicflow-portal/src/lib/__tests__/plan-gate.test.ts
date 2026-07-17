import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("billing exemption is fully decoupled from platform authorization", () => {
  it("plan-gate.ts has zero import statements referencing platform authorization — billing exemption cannot grant or depend on platform access", () => {
    const source = readFileSync(path.resolve(__dirname, "../plan-gate.ts"), "utf8");
    const importLines = source.split("\n").filter((line) => line.trim().startsWith("import "));
    for (const line of importLines) {
      expect(line).not.toMatch(/platform-access|auth-guards/);
    }
    expect(source).not.toMatch(/requireSuperAdmin\s*\(|requirePlatformRole\s*\(/);
  });
});

const findUnique = vi.fn();
const orgMemberCount = vi.fn();
const organizationMembershipCount = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: (...args: unknown[]) => findUnique(...args) },
    orgMember: { count: (...args: unknown[]) => orgMemberCount(...args) },
    organizationMembership: { count: (...args: unknown[]) => organizationMembershipCount(...args) },
  },
}));

beforeEach(() => vi.clearAllMocks());

describe("billing exemption does not transfer across an organization switch", () => {
  it("isBillingExempt is re-queried fresh per organizationId — switching from an exempt org to a non-exempt one returns false, not a cached true", async () => {
    findUnique.mockResolvedValueOnce({ billingExempt: true }); // APH Technologies
    findUnique.mockResolvedValueOnce({ billingExempt: false }); // Thrivepathmhs, switched to next
    const { isBillingExempt } = await import("../plan-gate");

    expect(await isBillingExempt("aph-org")).toBe(true);
    expect(await isBillingExempt("thrivepath-org")).toBe(false);
    // Each call queries prisma directly by the given id — no module-level
    // cache exists that could leak one organization's exemption into another.
    expect(findUnique).toHaveBeenNthCalledWith(1, { where: { id: "aph-org" }, select: { billingExempt: true } });
    expect(findUnique).toHaveBeenNthCalledWith(2, { where: { id: "thrivepath-org" }, select: { billingExempt: true } });
  });

  it("getOrgPlan resolves independently per organization even when called back-to-back for the same session flow", async () => {
    findUnique.mockResolvedValueOnce({ plan: "free", trialEndsAt: null, billingExempt: true });
    findUnique.mockResolvedValueOnce({ plan: "free", trialEndsAt: null, billingExempt: false });
    const { getOrgPlan } = await import("../plan-gate");

    expect(await getOrgPlan("aph-org")).toBe("elite");
    expect(await getOrgPlan("thrivepath-org")).toBe("free");
  });
});

describe("isBillingExempt", () => {
  it("is true only when the organization's billingExempt column is true", async () => {
    findUnique.mockResolvedValueOnce({ billingExempt: true });
    const { isBillingExempt } = await import("../plan-gate");
    expect(await isBillingExempt("org-1")).toBe(true);
  });

  it("is false for an ordinary organization", async () => {
    findUnique.mockResolvedValueOnce({ billingExempt: false });
    const { isBillingExempt } = await import("../plan-gate");
    expect(await isBillingExempt("org-1")).toBe(false);
  });

  it("is false (safe default) when the organization can't be found", async () => {
    findUnique.mockResolvedValueOnce(null);
    const { isBillingExempt } = await import("../plan-gate");
    expect(await isBillingExempt("missing")).toBe(false);
  });
});

describe("getOrgPlan — billing-exempt organizations", () => {
  it("returns elite for a billing-exempt organization regardless of its stored plan field", async () => {
    findUnique.mockResolvedValueOnce({ plan: "free", trialEndsAt: null, billingExempt: true });
    const { getOrgPlan } = await import("../plan-gate");
    expect(await getOrgPlan("aph-org")).toBe("elite");
  });

  it("ignores an expired/null trialEndsAt entirely when billing-exempt — never falls through to the trial-elevation branch", async () => {
    findUnique.mockResolvedValueOnce({ plan: "free", trialEndsAt: null, billingExempt: true });
    const { getOrgPlan } = await import("../plan-gate");
    expect(await getOrgPlan("aph-org")).toBe("elite");
  });
});

describe("getOrgPlan — ordinary organizations (unchanged behavior)", () => {
  it("returns the raw plan when not in trial and not billing-exempt", async () => {
    findUnique.mockResolvedValueOnce({ plan: "essential", trialEndsAt: null, billingExempt: false });
    const { getOrgPlan } = await import("../plan-gate");
    expect(await getOrgPlan("org-1")).toBe("essential");
  });

  it("elevates a free-plan org with an active trial window to essential", async () => {
    findUnique.mockResolvedValueOnce({ plan: "free", trialEndsAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), billingExempt: false });
    const { getOrgPlan } = await import("../plan-gate");
    expect(await getOrgPlan("org-1")).toBe("essential");
  });

  it("returns free for a free-plan org whose trial has expired", async () => {
    findUnique.mockResolvedValueOnce({ plan: "free", trialEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000), billingExempt: false });
    const { getOrgPlan } = await import("../plan-gate");
    expect(await getOrgPlan("org-1")).toBe("free");
  });

  it("returns free for a free-plan org with no trialEndsAt at all", async () => {
    findUnique.mockResolvedValueOnce({ plan: "free", trialEndsAt: null, billingExempt: false });
    const { getOrgPlan } = await import("../plan-gate");
    expect(await getOrgPlan("org-1")).toBe("free");
  });
});

describe("getTrialStatus — billing-exempt organizations", () => {
  it("is never 'in trial' for a billing-exempt organization, even with a null trialEndsAt (which would otherwise read as expired, not trialing, anyway)", async () => {
    findUnique.mockResolvedValueOnce({ plan: "free", trialEndsAt: null, billingExempt: true });
    const { getTrialStatus } = await import("../plan-gate");
    const status = await getTrialStatus("aph-org");
    expect(status).toEqual({ isInTrial: false, trialEndsAt: null, daysRemaining: 0 });
  });

  it("is never 'in trial' for a billing-exempt organization even if trialEndsAt is somehow set in the future", async () => {
    findUnique.mockResolvedValueOnce({ plan: "free", trialEndsAt: new Date(Date.now() + 100000), billingExempt: true });
    const { getTrialStatus } = await import("../plan-gate");
    const status = await getTrialStatus("aph-org");
    expect(status.isInTrial).toBe(false);
  });
});

describe("getTrialStatus — ordinary organizations (unchanged behavior)", () => {
  it("reports isInTrial true with days remaining for an active trial", async () => {
    const trialEndsAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    findUnique.mockResolvedValueOnce({ plan: "free", trialEndsAt, billingExempt: false });
    const { getTrialStatus } = await import("../plan-gate");
    const status = await getTrialStatus("org-1");
    expect(status.isInTrial).toBe(true);
    expect(status.daysRemaining).toBeGreaterThanOrEqual(4);
  });

  it("reports isInTrial false once trialEndsAt has passed", async () => {
    findUnique.mockResolvedValueOnce({ plan: "free", trialEndsAt: new Date(Date.now() - 1000), billingExempt: false });
    const { getTrialStatus } = await import("../plan-gate");
    const status = await getTrialStatus("org-1");
    expect(status.isInTrial).toBe(false);
    expect(status.daysRemaining).toBe(0);
  });

  it("reports isInTrial false for a paid-plan organization regardless of trialEndsAt", async () => {
    findUnique.mockResolvedValueOnce({ plan: "essential", trialEndsAt: new Date(Date.now() + 100000), billingExempt: false });
    const { getTrialStatus } = await import("../plan-gate");
    expect((await getTrialStatus("org-1")).isInTrial).toBe(false);
  });
});

describe("checkMemberLimit / checkSeatLimit — billing-exempt organizations get elite-tier limits", () => {
  it("checkMemberLimit reports unlimited for a billing-exempt organization", async () => {
    findUnique.mockResolvedValueOnce({ plan: "free", trialEndsAt: null, billingExempt: true });
    orgMemberCount.mockResolvedValueOnce(5000);
    const { checkMemberLimit } = await import("../plan-gate");
    const result = await checkMemberLimit("aph-org");
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(Infinity);
  });
});
