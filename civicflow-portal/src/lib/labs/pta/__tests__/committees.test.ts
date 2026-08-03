import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstCommittee = vi.fn();
const updateCommittee = vi.fn();
const findFirstAdult = vi.fn();
const findManyCommittee = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaCommittee: {
      findFirst: (...a: unknown[]) => findFirstCommittee(...a),
      findMany: (...a: unknown[]) => findManyCommittee(...a),
      update: (...a: unknown[]) => updateCommittee(...a),
    },
    ptaHouseholdAdult: { findFirst: (...a: unknown[]) => findFirstAdult(...a) },
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));

beforeEach(() => vi.clearAllMocks());

describe("setPtaCommitteeChair", () => {
  it("throws PTA_COMMITTEE_NOT_FOUND for a cross-tenant committee id", async () => {
    findFirstCommittee.mockResolvedValueOnce(null);
    const { setPtaCommitteeChair } = await import("../committees");
    await expect(setPtaCommitteeChair("org-b", "committee-belonging-to-org-a", "adult-1", "u1")).rejects.toMatchObject({ code: "PTA_COMMITTEE_NOT_FOUND" });
    expect(updateCommittee).not.toHaveBeenCalled();
  });

  it("rejects a chair id that isn't a household adult in this organization", async () => {
    findFirstCommittee.mockResolvedValueOnce({ id: "committee-1", organizationId: "org-a" });
    findFirstAdult.mockResolvedValueOnce(null);
    const { setPtaCommitteeChair } = await import("../committees");
    await expect(setPtaCommitteeChair("org-a", "committee-1", "adult-belonging-to-org-b", "u1")).rejects.toMatchObject({ code: "PTA_NOT_A_HOUSEHOLD_MEMBER" });
    expect(updateCommittee).not.toHaveBeenCalled();
  });

  it("sets the chair when the adult is valid", async () => {
    findFirstCommittee.mockResolvedValueOnce({ id: "committee-1", organizationId: "org-a" });
    findFirstAdult.mockResolvedValueOnce({ id: "adult-1", organizationId: "org-a" });
    updateCommittee.mockResolvedValueOnce({ id: "committee-1", chairAdultId: "adult-1" });
    const { setPtaCommitteeChair } = await import("../committees");
    await setPtaCommitteeChair("org-a", "committee-1", "adult-1", "u1");
    expect(updateCommittee).toHaveBeenCalledWith({ where: { id: "committee-1" }, data: { chairAdultId: "adult-1" } });
  });

  it("clears the chair when passed null, without validating against the adult table", async () => {
    findFirstCommittee.mockResolvedValueOnce({ id: "committee-1", organizationId: "org-a" });
    updateCommittee.mockResolvedValueOnce({ id: "committee-1", chairAdultId: null });
    const { setPtaCommitteeChair } = await import("../committees");
    await setPtaCommitteeChair("org-a", "committee-1", null, "u1");
    expect(findFirstAdult).not.toHaveBeenCalled();
    expect(updateCommittee).toHaveBeenCalledWith({ where: { id: "committee-1" }, data: { chairAdultId: null } });
  });
});

describe("setPtaCommitteeCoChair", () => {
  it("throws PTA_COMMITTEE_NOT_FOUND for a cross-tenant committee id", async () => {
    findFirstCommittee.mockResolvedValueOnce(null);
    const { setPtaCommitteeCoChair } = await import("../committees");
    await expect(setPtaCommitteeCoChair("org-b", "committee-belonging-to-org-a", "adult-1", "u1")).rejects.toMatchObject({ code: "PTA_COMMITTEE_NOT_FOUND" });
    expect(updateCommittee).not.toHaveBeenCalled();
  });

  it("rejects a co-chair id that isn't a household adult in this organization", async () => {
    findFirstCommittee.mockResolvedValueOnce({ id: "committee-1", organizationId: "org-a" });
    findFirstAdult.mockResolvedValueOnce(null);
    const { setPtaCommitteeCoChair } = await import("../committees");
    await expect(setPtaCommitteeCoChair("org-a", "committee-1", "adult-belonging-to-org-b", "u1")).rejects.toMatchObject({ code: "PTA_NOT_A_HOUSEHOLD_MEMBER" });
    expect(updateCommittee).not.toHaveBeenCalled();
  });

  it("sets the co-chair independently of the chair field", async () => {
    findFirstCommittee.mockResolvedValueOnce({ id: "committee-1", organizationId: "org-a", chairAdultId: "adult-1" });
    findFirstAdult.mockResolvedValueOnce({ id: "adult-2", organizationId: "org-a" });
    updateCommittee.mockResolvedValueOnce({ id: "committee-1", coChairAdultId: "adult-2" });
    const { setPtaCommitteeCoChair } = await import("../committees");
    await setPtaCommitteeCoChair("org-a", "committee-1", "adult-2", "u1");
    expect(updateCommittee).toHaveBeenCalledWith({ where: { id: "committee-1" }, data: { coChairAdultId: "adult-2" } });
  });

  it("clears the co-chair when passed null, without validating against the adult table", async () => {
    findFirstCommittee.mockResolvedValueOnce({ id: "committee-1", organizationId: "org-a" });
    updateCommittee.mockResolvedValueOnce({ id: "committee-1", coChairAdultId: null });
    const { setPtaCommitteeCoChair } = await import("../committees");
    await setPtaCommitteeCoChair("org-a", "committee-1", null, "u1");
    expect(findFirstAdult).not.toHaveBeenCalled();
    expect(updateCommittee).toHaveBeenCalledWith({ where: { id: "committee-1" }, data: { coChairAdultId: null } });
  });
});

describe("listPtaCommittees / getPtaCommittee — include the co-chair relation", () => {
  it("listPtaCommittees requests both chair and coChair", async () => {
    findManyCommittee.mockResolvedValueOnce([]);
    const { listPtaCommittees } = await import("../committees");
    await listPtaCommittees("org-a");
    expect(findManyCommittee).toHaveBeenCalledWith(expect.objectContaining({ include: expect.objectContaining({ chair: true, coChair: true }) }));
  });

  it("getPtaCommittee requests both chair and coChair", async () => {
    findFirstCommittee.mockResolvedValueOnce({ id: "committee-1", organizationId: "org-a" });
    const { getPtaCommittee } = await import("../committees");
    await getPtaCommittee("org-a", "committee-1");
    expect(findFirstCommittee).toHaveBeenCalledWith(expect.objectContaining({ include: expect.objectContaining({ chair: true, coChair: true }) }));
  });
});
