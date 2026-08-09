import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyOrgMember = vi.fn().mockResolvedValue([]);
const findUniqueOrganization = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgMember: { findMany: (...args: unknown[]) => findManyOrgMember(...args) },
    organization: { findUnique: (...args: unknown[]) => findUniqueOrganization(...args) },
  },
}));

const resolvePtaTargetMemberIds = vi.fn();
vi.mock("@/lib/labs/pta/communications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/labs/pta/communications")>();
  return { ...actual, resolvePtaTargetMemberIds: (...a: unknown[]) => resolvePtaTargetMemberIds(...a) };
});

import { resolveCommunicationRecipients } from "@/lib/communication-campaigns";

beforeEach(() => {
  findManyOrgMember.mockReset().mockResolvedValue([]);
  findUniqueOrganization.mockReset();
  resolvePtaTargetMemberIds.mockReset();
});

describe("resolveCommunicationRecipients: outstanding_dues selector", () => {
  it("scopes to the organization and members with a pending/partial dues charge", async () => {
    await resolveCommunicationRecipients("org-a", { selector: "outstanding_dues" }, "EMAIL");

    expect(findManyOrgMember).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: "org-a",
          duesCharges: { some: { organizationId: "org-a", status: { in: ["PENDING", "PARTIAL"] } } },
        },
      })
    );
  });

  it("never lets a selector search outside the given organization", async () => {
    await resolveCommunicationRecipients("org-a", { selector: "outstanding_dues" }, "EMAIL");
    const whereArg = findManyOrgMember.mock.calls.at(-1)?.[0]?.where;
    expect(whereArg.organizationId).toBe("org-a");
    expect(whereArg.duesCharges.some.organizationId).toBe("org-a");
  });
});

describe("resolveCommunicationRecipients: manual selector", () => {
  it("scopes the explicit id list to the given organization — a foreign-org id can never slip through", async () => {
    await resolveCommunicationRecipients("org-a", { selector: "manual", memberIds: ["member-1", "member-belonging-to-org-b"] }, "EMAIL");
    expect(findManyOrgMember).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-a", id: { in: ["member-1", "member-belonging-to-org-b"] } } })
    );
  });

  it("defaults to an empty id list rather than crashing when memberIds is omitted", async () => {
    await resolveCommunicationRecipients("org-a", { selector: "manual" }, "EMAIL");
    expect(findManyOrgMember).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "org-a", id: { in: [] } } }));
  });
});

describe("resolveCommunicationRecipients: pta_target selector", () => {
  it("rejects a non-PTA organization even with a well-formed rule", async () => {
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "COMMUNITY" });
    await expect(
      resolveCommunicationRecipients("org-a", { selector: "pta_target", ptaRule: { type: "grade", gradeId: "grade-1", schoolYear: "2026-2027" } }, "EMAIL")
    ).rejects.toThrow(/PTA/);
    expect(resolvePtaTargetMemberIds).not.toHaveBeenCalled();
  });

  it("rejects a malformed ptaRule even for a PTA organization", async () => {
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "PTA" });
    await expect(
      resolveCommunicationRecipients("org-a", { selector: "pta_target", ptaRule: { type: "grade" } as never }, "EMAIL")
    ).rejects.toThrow();
    expect(resolvePtaTargetMemberIds).not.toHaveBeenCalled();
  });

  it("resolves via resolvePtaTargetMemberIds and scopes the result to the organization, never trusting a client-supplied id list", async () => {
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "PTA" });
    resolvePtaTargetMemberIds.mockResolvedValueOnce(["member-1", "member-2"]);

    const rule = { type: "committee" as const, committeeId: "committee-1" };
    await resolveCommunicationRecipients("org-a", { selector: "pta_target", ptaRule: rule, memberIds: ["member-attacker-supplied"] }, "EMAIL");

    expect(resolvePtaTargetMemberIds).toHaveBeenCalledWith("org-a", rule);
    expect(findManyOrgMember).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "org-a", id: { in: ["member-1", "member-2"] } } }));
  });
});
