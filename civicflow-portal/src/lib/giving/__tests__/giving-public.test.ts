import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueOrg = vi.fn();
const findUniqueOrgSettings = vi.fn();
const findManyFunds = vi.fn();
const findFirstFund = vi.fn();
const findManyCampaigns = vi.fn();
const aggregateContributions = vi.fn();
const findFirstContribution = vi.fn();
const findManyContributions = vi.fn();
const createContribution = vi.fn();
const updateContribution = vi.fn();
const findFirstOrgMember = vi.fn();
const findManyOrgMembers = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: (...a: unknown[]) => findUniqueOrg(...a) },
    orgSettings: { findUnique: (...a: unknown[]) => findUniqueOrgSettings(...a) },
    fund: {
      findMany: (...a: unknown[]) => findManyFunds(...a),
      findFirst: (...a: unknown[]) => findFirstFund(...a),
    },
    campaign: { findMany: (...a: unknown[]) => findManyCampaigns(...a) },
    contribution: {
      aggregate: (...a: unknown[]) => aggregateContributions(...a),
      findFirst: (...a: unknown[]) => findFirstContribution(...a),
      findMany: (...a: unknown[]) => findManyContributions(...a),
      create: (...a: unknown[]) => createContribution(...a),
      update: (...a: unknown[]) => updateContribution(...a),
    },
    orgMember: {
      findFirst: (...a: unknown[]) => findFirstOrgMember(...a),
      findMany: (...a: unknown[]) => findManyOrgMembers(...a),
    },
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));
vi.mock("@/lib/giving/contribution-numbers", () => ({
  withContributionNumber: async (organizationId: string, create: (n: string) => Promise<unknown>) =>
    create("CTR-2026-000042"),
}));

import {
  getPublicGivingPage,
  recordPublicGivingContribution,
  resolveGuestContribution,
  validatePublicGivingRequest,
} from "@/lib/giving/public-giving";

const OPEN_FUND = {
  id: "f-1",
  name: "General Fund",
  status: "ACTIVE",
  isPublic: true,
  allowOneTime: true,
  minimumAmount: null,
  maximumAmount: null,
  suggestedAmounts: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  findUniqueOrg.mockResolvedValue({ id: "org-1", name: "Demo Org", logoUrl: null });
  findUniqueOrgSettings.mockResolvedValue({
    contributionsEnabled: true,
    publicGivingEnabled: true,
    publicGivingMessage: null,
    contributionTerminology: "Giving",
  });
  createContribution.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
    id: "c-1",
    contributionNumber: "CTR-2026-000042",
    ...args.data,
  }));
});

describe("no tenant enumeration (§55 security review 1)", () => {
  it("unknown slug, module off, and page off all yield the same null", async () => {
    findUniqueOrg.mockResolvedValueOnce(null);
    await expect(getPublicGivingPage("nope")).resolves.toBeNull();

    findUniqueOrgSettings.mockResolvedValueOnce({ contributionsEnabled: false, publicGivingEnabled: true });
    await expect(getPublicGivingPage("demo")).resolves.toBeNull();

    findUniqueOrgSettings.mockResolvedValueOnce({ contributionsEnabled: true, publicGivingEnabled: false });
    await expect(getPublicGivingPage("demo")).resolves.toBeNull();
  });

  it("checkout validation 404s identically for the same three cases", async () => {
    findUniqueOrg.mockResolvedValueOnce(null);
    await expect(validatePublicGivingRequest({ slug: "x", fundId: "f-1", amount: 10 })).rejects.toMatchObject({ status: 404 });

    findUniqueOrgSettings.mockResolvedValueOnce({ contributionsEnabled: true, publicGivingEnabled: false });
    await expect(validatePublicGivingRequest({ slug: "x", fundId: "f-1", amount: 10 })).rejects.toMatchObject({ status: 404 });
  });
});

describe("published surface only", () => {
  it("the page queries only isPublic ACTIVE one-time funds and showPublicProgress campaigns", async () => {
    findManyFunds.mockResolvedValueOnce([]);
    findManyCampaigns.mockResolvedValueOnce([]);
    await getPublicGivingPage("demo");
    expect(findManyFunds.mock.calls[0][0].where).toMatchObject({
      organizationId: "org-1",
      isPublic: true,
      status: "ACTIVE",
      allowOneTime: true,
    });
    expect(findManyCampaigns.mock.calls[0][0].where).toMatchObject({ showPublicProgress: true, status: "active" });
    expect(findManyCampaigns.mock.calls[0][0].select).not.toHaveProperty("contributions");
  });

  it("a non-public fund 404s at checkout even when otherwise valid (§111.6 family)", async () => {
    findFirstFund.mockResolvedValueOnce({ ...OPEN_FUND, isPublic: false });
    await expect(validatePublicGivingRequest({ slug: "demo", fundId: "f-1", amount: 10 })).rejects.toMatchObject({ status: 404 });
  });
});

describe("webhook recorder (§50 + idempotency + §57)", () => {
  const base = {
    organizationId: "org-1",
    fundId: "f-1",
    amountTotalCents: 2500,
    currency: "usd",
    providerPaymentIntentId: "pi_1",
    providerSessionId: "cs_1",
  };

  it("fund/org mismatch records NOTHING", async () => {
    findFirstFund.mockResolvedValueOnce(null);
    const result = await recordPublicGivingContribution(base);
    expect(result).toEqual({ outcome: "REJECTED", reason: "fund_org_mismatch" });
    expect(createContribution).not.toHaveBeenCalled();
  });

  it("duplicate payment intent is a no-op DUPLICATE", async () => {
    findFirstFund.mockResolvedValueOnce(OPEN_FUND);
    findFirstContribution.mockResolvedValueOnce({ id: "c-existing" });
    const result = await recordPublicGivingContribution(base);
    expect(result).toEqual({ outcome: "DUPLICATE", contributionId: "c-existing" });
    expect(createContribution).not.toHaveBeenCalled();
  });

  it("a roster email match only ever SUGGESTS — memberId stays null (§57)", async () => {
    findFirstFund.mockResolvedValueOnce(OPEN_FUND);
    findFirstContribution.mockResolvedValueOnce(null);
    findFirstOrgMember.mockResolvedValueOnce({ id: "m-1" });
    const result = await recordPublicGivingContribution({ ...base, guestEmail: "Member@Example.com", guestName: "Pat" });
    expect(result.outcome).toBe("RECORDED");
    const data = createContribution.mock.calls[0][0].data;
    expect(data.guestMatchStatus).toBe("MATCH_SUGGESTED");
    expect(data.guestEmail).toBe("member@example.com");
    expect(data).not.toHaveProperty("memberId");
    expect(data.source).toBe("PUBLIC_PAGE");
  });

  it("no email → UNLINKED, no receipt requested, unknown anonymity degrades to NONE", async () => {
    findFirstFund.mockResolvedValueOnce(OPEN_FUND);
    findFirstContribution.mockResolvedValueOnce(null);
    const result = await recordPublicGivingContribution({ ...base, anonymityMode: "ORGANIZATION_ANONYMOUS" });
    expect(result.outcome).toBe("RECORDED");
    const data = createContribution.mock.calls[0][0].data;
    expect(data.guestMatchStatus).toBe("UNLINKED");
    expect(data.anonymityMode).toBe("NONE");
    expect(data.receiptRequested).toBe(false);
    expect(findFirstOrgMember).not.toHaveBeenCalled();
  });

  it("amount truth comes from the provider, currency uppercased", async () => {
    findFirstFund.mockResolvedValueOnce(OPEN_FUND);
    findFirstContribution.mockResolvedValueOnce(null);
    await recordPublicGivingContribution({ ...base, amountTotalCents: 1234 });
    const data = createContribution.mock.calls[0][0].data;
    expect(data.amount).toBe(12.34);
    expect(data.currency).toBe("USD");
  });
});

describe("guest match resolution (§57 — the only linking path)", () => {
  it("cross-org contribution → 404, nothing written", async () => {
    findFirstContribution.mockResolvedValueOnce(null);
    await expect(
      resolveGuestContribution({ organizationId: "org-1", contributionId: "c-other", action: "link", memberId: "m-1", actorUserId: "fin" })
    ).rejects.toMatchObject({ status: 404 });
    expect(updateContribution).not.toHaveBeenCalled();
  });

  it("link requires an in-org member, sets memberId + LINKED, audits", async () => {
    findFirstContribution.mockResolvedValueOnce({ id: "c-1", memberId: null });
    findFirstOrgMember.mockResolvedValueOnce({ id: "m-1", userId: "u-1" });
    await resolveGuestContribution({ organizationId: "org-1", contributionId: "c-1", action: "link", memberId: "m-1", actorUserId: "fin" });
    expect(updateContribution.mock.calls[0][0].data).toMatchObject({ memberId: "m-1", guestMatchStatus: "LINKED" });
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "giving.guest_contribution_linked" }));
  });

  it("an already-linked contribution refuses re-linking (409)", async () => {
    findFirstContribution.mockResolvedValueOnce({ id: "c-1", memberId: "m-existing" });
    await expect(
      resolveGuestContribution({ organizationId: "org-1", contributionId: "c-1", action: "link", memberId: "m-2", actorUserId: "fin" })
    ).rejects.toMatchObject({ status: 409 });
  });

  it("dismiss sets UNLINKED and audits", async () => {
    findFirstContribution.mockResolvedValueOnce({ id: "c-1", memberId: null });
    await resolveGuestContribution({ organizationId: "org-1", contributionId: "c-1", action: "dismiss", actorUserId: "fin" });
    expect(updateContribution.mock.calls[0][0].data).toMatchObject({ guestMatchStatus: "UNLINKED" });
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "giving.guest_match_dismissed" }));
  });
});
