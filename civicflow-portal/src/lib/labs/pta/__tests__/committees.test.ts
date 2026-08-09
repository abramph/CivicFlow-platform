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

  it("documents (rather than silently allows) that the same adult can be set as both chair and co-chair -- no cross-field validation exists", async () => {
    // This is an intentional finding surfaced during review, not an assumed
    // behavior: setPtaCommitteeChair/setPtaCommitteeCoChair never check each
    // other's current value. Whether a single person should be allowed to
    // hold both titles on the same committee is a product policy question,
    // not a security one -- this test exists so the behavior is visible and
    // deliberate rather than an untested gap.
    findFirstCommittee.mockResolvedValueOnce({ id: "committee-1", organizationId: "org-a", chairAdultId: "adult-1" });
    findFirstAdult.mockResolvedValueOnce({ id: "adult-1", organizationId: "org-a" });
    updateCommittee.mockResolvedValueOnce({ id: "committee-1", chairAdultId: "adult-1", coChairAdultId: "adult-1" });
    const { setPtaCommitteeCoChair } = await import("../committees");
    await setPtaCommitteeCoChair("org-a", "committee-1", "adult-1", "u1");
    expect(updateCommittee).toHaveBeenCalledWith({ where: { id: "committee-1" }, data: { coChairAdultId: "adult-1" } });
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

describe("getCommitteeTargetMemberIds", () => {
  it("throws PTA_COMMITTEE_NOT_FOUND for a cross-tenant or nonexistent committee id, rather than silently returning an empty list", async () => {
    findFirstCommittee.mockResolvedValueOnce(null);
    const { getCommitteeTargetMemberIds } = await import("../committees");
    await expect(getCommitteeTargetMemberIds("org-b", "committee-belonging-to-org-a")).rejects.toMatchObject({ code: "PTA_COMMITTEE_NOT_FOUND" });
  });

  it("includes the chair and co-chair even when neither was separately added via addPtaCommitteeMember", async () => {
    findFirstCommittee.mockResolvedValueOnce({
      id: "committee-1",
      organizationId: "org-a",
      chair: { id: "adult-chair", household: { orgMemberId: "member-chair" } },
      coChair: { id: "adult-cochair", household: { orgMemberId: "member-cochair" } },
      members: [],
    });
    const { getCommitteeTargetMemberIds } = await import("../committees");
    const ids = await getCommitteeTargetMemberIds("org-a", "committee-1");
    expect(ids).toEqual(expect.arrayContaining(["member-chair", "member-cochair"]));
    expect(ids).toHaveLength(2);
  });

  it("dedupes when the chair is also a regular member (or holds both chair and co-chair)", async () => {
    findFirstCommittee.mockResolvedValueOnce({
      id: "committee-1",
      organizationId: "org-a",
      chair: { id: "adult-chair", household: { orgMemberId: "member-chair" } },
      coChair: null,
      members: [{ householdAdult: { household: { orgMemberId: "member-chair" } } }, { householdAdult: { household: { orgMemberId: "member-2" } } }],
    });
    const { getCommitteeTargetMemberIds } = await import("../committees");
    const ids = await getCommitteeTargetMemberIds("org-a", "committee-1");
    expect(ids.sort()).toEqual(["member-chair", "member-2"].sort());
  });

  it("works for a committee with no chair, no co-chair, and no members set yet", async () => {
    findFirstCommittee.mockResolvedValueOnce({ id: "committee-1", organizationId: "org-a", chair: null, coChair: null, members: [] });
    const { getCommitteeTargetMemberIds } = await import("../committees");
    await expect(getCommitteeTargetMemberIds("org-a", "committee-1")).resolves.toEqual([]);
  });

  it("filters out a household with no billing-identity orgMemberId yet, without crashing", async () => {
    findFirstCommittee.mockResolvedValueOnce({
      id: "committee-1",
      organizationId: "org-a",
      chair: null,
      coChair: null,
      members: [{ householdAdult: { household: { orgMemberId: null } } }, { householdAdult: { household: { orgMemberId: "member-2" } } }],
    });
    const { getCommitteeTargetMemberIds } = await import("../committees");
    await expect(getCommitteeTargetMemberIds("org-a", "committee-1")).resolves.toEqual(["member-2"]);
  });
});
