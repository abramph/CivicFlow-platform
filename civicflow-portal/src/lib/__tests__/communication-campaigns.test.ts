import { describe, expect, it, vi } from "vitest";

const findManyOrgMember = vi.fn().mockResolvedValue([]);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgMember: { findMany: (...args: unknown[]) => findManyOrgMember(...args) },
  },
}));

import { resolveCommunicationRecipients } from "@/lib/communication-campaigns";

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
