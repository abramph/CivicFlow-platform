import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstPaymentLink = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { paymentLink: { findFirst: (...args: unknown[]) => findFirstPaymentLink(...args) } },
}));

import { findActivePaymentLink } from "@/lib/payment-links";

describe("findActivePaymentLink", () => {
  beforeEach(() => {
    findFirstPaymentLink.mockReset();
  });

  it("returns null when no matching link exists", async () => {
    findFirstPaymentLink.mockResolvedValueOnce(null);
    const result = await findActivePaymentLink({ organizationId: "org-a", campaignId: "campaign-1" });
    expect(result).toBeNull();
    expect(findFirstPaymentLink).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-a", campaignId: "campaign-1", status: "active" } })
    );
  });

  it("returns null for a link that's active but past its expiration", async () => {
    findFirstPaymentLink.mockResolvedValueOnce({ id: "link-1", slug: "abc", expiresAt: new Date("2020-01-01") });
    const result = await findActivePaymentLink({ organizationId: "org-a", eventId: "event-1" });
    expect(result).toBeNull();
  });

  it("returns the link when active and not expired", async () => {
    findFirstPaymentLink.mockResolvedValueOnce({ id: "link-1", slug: "abc", expiresAt: null });
    const result = await findActivePaymentLink({ organizationId: "org-a", linkType: "DUES" });
    expect(result).toEqual({ id: "link-1", slug: "abc", expiresAt: null });
  });
});
