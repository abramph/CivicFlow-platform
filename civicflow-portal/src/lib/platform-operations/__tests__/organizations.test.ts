import { beforeEach, describe, expect, it, vi } from "vitest";
import { deriveOrganizationHealth } from "../organizations";

describe("deriveOrganizationHealth", () => {
  it("is critical when the organization itself is suspended", () => {
    expect(deriveOrganizationHealth({ status: "suspended", latestSubscriptionStatus: "active", activeOwnerCount: 1 })).toBe("critical");
  });

  it("is critical when the organization is cancelled", () => {
    expect(deriveOrganizationHealth({ status: "cancelled", latestSubscriptionStatus: null, activeOwnerCount: 1 })).toBe("critical");
  });

  it("is critical when the subscription is past due, even if the org itself is active", () => {
    expect(deriveOrganizationHealth({ status: "active", latestSubscriptionStatus: "past_due", activeOwnerCount: 1 })).toBe("critical");
  });

  it("is attention when there is no active owner", () => {
    expect(deriveOrganizationHealth({ status: "active", latestSubscriptionStatus: "active", activeOwnerCount: 0 })).toBe("attention");
  });

  it("is attention when the subscription is unpaid", () => {
    expect(deriveOrganizationHealth({ status: "active", latestSubscriptionStatus: "unpaid", activeOwnerCount: 1 })).toBe("attention");
  });

  it("is healthy for a normal active org with an owner and a healthy subscription", () => {
    expect(deriveOrganizationHealth({ status: "active", latestSubscriptionStatus: "active", activeOwnerCount: 1 })).toBe("healthy");
  });

  it("is healthy for an active org with no subscription at all (e.g. free plan)", () => {
    expect(deriveOrganizationHealth({ status: "active", latestSubscriptionStatus: null, activeOwnerCount: 1 })).toBe("healthy");
  });

  it("prioritizes critical over attention when both conditions are true", () => {
    expect(deriveOrganizationHealth({ status: "suspended", latestSubscriptionStatus: null, activeOwnerCount: 0 })).toBe("critical");
  });
});

const organizationFindMany = vi.fn();
const organizationCount = vi.fn();
const organizationFindUnique = vi.fn();
const organizationMembershipGroupBy = vi.fn();
const organizationMembershipFindMany = vi.fn();
const organizationMembershipCount = vi.fn();
const organizationMembershipFindFirst = vi.fn();
const auditEventGroupBy = vi.fn();
const auditEventFindMany = vi.fn();
const memberInviteCount = vi.fn();
const subscriptionFindFirst = vi.fn();
const organizationSmsSettingsFindUnique = vi.fn();
const orgMemberCount = vi.fn();
const smsMessageCount = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: {
      findMany: (...args: unknown[]) => organizationFindMany(...args),
      count: (...args: unknown[]) => organizationCount(...args),
      findUnique: (...args: unknown[]) => organizationFindUnique(...args),
    },
    organizationMembership: {
      groupBy: (...args: unknown[]) => organizationMembershipGroupBy(...args),
      findMany: (...args: unknown[]) => organizationMembershipFindMany(...args),
      count: (...args: unknown[]) => organizationMembershipCount(...args),
      findFirst: (...args: unknown[]) => organizationMembershipFindFirst(...args),
    },
    auditEvent: {
      groupBy: (...args: unknown[]) => auditEventGroupBy(...args),
      findMany: (...args: unknown[]) => auditEventFindMany(...args),
    },
    memberInvite: { count: (...args: unknown[]) => memberInviteCount(...args) },
    subscription: { findFirst: (...args: unknown[]) => subscriptionFindFirst(...args) },
    organizationSmsSettings: { findUnique: (...args: unknown[]) => organizationSmsSettingsFindUnique(...args) },
    orgMember: { count: (...args: unknown[]) => orgMemberCount(...args) },
    smsMessage: { count: (...args: unknown[]) => smsMessageCount(...args) },
  },
}));

describe("getOrganizationDetail — tenant-boundary safety", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null for an organization that doesn't exist, rather than throwing or exposing a partial record", async () => {
    organizationFindUnique.mockResolvedValueOnce(null);
    const { getOrganizationDetail } = await import("../organizations");
    const result = await getOrganizationDetail("does-not-exist");
    expect(result).toBeNull();
  });

  it("never queries any tenant business-data model (members, dues, contributions) — only platform-metadata models", async () => {
    organizationFindUnique.mockResolvedValueOnce({
      id: "org-1",
      name: "Acme",
      slug: "acme",
      organizationType: null,
      status: "active",
      plan: "essential",
      createdAt: new Date(),
      trialEndsAt: null,
    });
    organizationMembershipFindMany.mockResolvedValueOnce([]);
    memberInviteCount.mockResolvedValueOnce(0);
    organizationMembershipCount.mockResolvedValueOnce(0);
    subscriptionFindFirst.mockResolvedValueOnce(null);
    organizationSmsSettingsFindUnique.mockResolvedValueOnce(null);
    orgMemberCount.mockResolvedValueOnce(0);
    smsMessageCount.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    auditEventFindMany.mockResolvedValueOnce([]);
    organizationMembershipFindFirst.mockResolvedValueOnce(null);

    const { getOrganizationDetail } = await import("../organizations");
    const result = await getOrganizationDetail("org-1");

    expect(result).not.toBeNull();
    // orgMember.count is used only for an aggregate SMS-consent count, never
    // .findMany with member PII fields — confirming no per-member record leaks.
    expect(orgMemberCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-1" }) })
    );
  });

  it("surfaces billingExempt on the identity object so the UI can label an internal organization correctly", async () => {
    organizationFindUnique.mockResolvedValueOnce({
      id: "aph-org",
      name: "APH Technologies, LLC",
      slug: "aph-technologies",
      organizationType: "Platform",
      status: "active",
      plan: "free",
      createdAt: new Date(),
      trialEndsAt: null,
      billingExempt: true,
    });
    organizationMembershipFindMany.mockResolvedValueOnce([{ role: "ORG_OWNER", userId: "u1" }]);
    memberInviteCount.mockResolvedValueOnce(0);
    organizationMembershipCount.mockResolvedValueOnce(0);
    subscriptionFindFirst.mockResolvedValueOnce(null);
    organizationSmsSettingsFindUnique.mockResolvedValueOnce(null);
    orgMemberCount.mockResolvedValueOnce(0);
    smsMessageCount.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    auditEventFindMany.mockResolvedValueOnce([]);
    organizationMembershipFindFirst.mockResolvedValueOnce({ user: { id: "u1", email: "admin@example.com", displayName: null } });
    organizationMembershipGroupBy.mockResolvedValueOnce([{ userId: "u1", _count: { _all: 1 } }]);

    const { getOrganizationDetail } = await import("../organizations");
    const result = await getOrganizationDetail("aph-org");

    expect(result?.identity.billingExempt).toBe(true);
  });
});
