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
const organizationUpdate = vi.fn();
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
const ptaHouseholdCount = vi.fn();
const ptaStudentCount = vi.fn();
const ptaVolunteerHourEntryCount = vi.fn();
const organizationLabFeatureFindUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: {
      findMany: (...args: unknown[]) => organizationFindMany(...args),
      count: (...args: unknown[]) => organizationCount(...args),
      findUnique: (...args: unknown[]) => organizationFindUnique(...args),
      update: (...args: unknown[]) => organizationUpdate(...args),
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
    ptaHousehold: { count: (...args: unknown[]) => ptaHouseholdCount(...args) },
    ptaStudent: { count: (...args: unknown[]) => ptaStudentCount(...args) },
    ptaVolunteerHourEntry: { count: (...args: unknown[]) => ptaVolunteerHourEntryCount(...args) },
    organizationLabFeature: { findUnique: (...args: unknown[]) => organizationLabFeatureFindUnique(...args) },
  },
}));

const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({
  createAuditEvent: (...args: unknown[]) => createAuditEvent(...args),
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

describe("previewPrimaryVerticalChange", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws for an organization that doesn't exist", async () => {
    organizationFindUnique.mockResolvedValueOnce(null);
    const { previewPrimaryVerticalChange, OrganizationVerticalChangeError } = await import("../organizations");
    await expect(previewPrimaryVerticalChange("missing", "COMMUNITY")).rejects.toThrow(OrganizationVerticalChangeError);
  });

  it("lists dormant PTA data only when moving away from PTA", async () => {
    organizationFindUnique.mockResolvedValueOnce({ primaryVertical: "PTA" });
    ptaHouseholdCount.mockResolvedValueOnce(4);
    ptaStudentCount.mockResolvedValueOnce(6);
    ptaVolunteerHourEntryCount.mockResolvedValueOnce(0);

    const { previewPrimaryVerticalChange } = await import("../organizations");
    const preview = await previewPrimaryVerticalChange("org-pta", "COMMUNITY");

    expect(preview.dormantOnChange).toEqual([
      { label: "Households", count: 4 },
      { label: "Students", count: 6 },
    ]);
  });

  it("reports no dormant data when the org was never PTA", async () => {
    organizationFindUnique.mockResolvedValueOnce({ primaryVertical: "COMMUNITY" });

    const { previewPrimaryVerticalChange } = await import("../organizations");
    const preview = await previewPrimaryVerticalChange("org-community", "UNION");

    expect(preview.dormantOnChange).toEqual([]);
    expect(ptaHouseholdCount).not.toHaveBeenCalled();
  });

  it("never consults Labs enrollment when moving to PTA (PR #40 — PTA is a first-class vertical, no Labs mismatch concept remains)", async () => {
    organizationFindUnique.mockResolvedValueOnce({ primaryVertical: "COMMUNITY" });

    const { previewPrimaryVerticalChange } = await import("../organizations");
    const preview = await previewPrimaryVerticalChange("org-1", "PTA");

    expect(preview.proposedVertical).toBe("PTA");
    expect(organizationLabFeatureFindUnique).not.toHaveBeenCalled();
  });
});

describe("changeOrganizationPrimaryVertical", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws for an organization that doesn't exist", async () => {
    organizationFindUnique.mockResolvedValueOnce(null);
    const { changeOrganizationPrimaryVertical, OrganizationVerticalChangeError } = await import("../organizations");
    await expect(
      changeOrganizationPrimaryVertical({ organizationId: "missing", newVertical: "COMMUNITY", actorUserId: "u1", actorEmail: "a@x.com", reason: "Test" })
    ).rejects.toThrow(OrganizationVerticalChangeError);
    expect(organizationUpdate).not.toHaveBeenCalled();
  });

  it("is a no-op (no write, no audit event) when the requested vertical matches the current one", async () => {
    organizationFindUnique.mockResolvedValueOnce({ primaryVertical: "COMMUNITY" });
    const { changeOrganizationPrimaryVertical } = await import("../organizations");

    const result = await changeOrganizationPrimaryVertical({
      organizationId: "org-1",
      newVertical: "COMMUNITY",
      actorUserId: "u1",
      actorEmail: "a@x.com",
      reason: "Test no-op",
    });

    expect(result).toEqual({ organizationId: "org-1", previousVertical: "COMMUNITY", newVertical: "COMMUNITY" });
    expect(organizationUpdate).not.toHaveBeenCalled();
    expect(createAuditEvent).not.toHaveBeenCalled();
  });

  it("updates only primaryVertical and records a before/after audit event", async () => {
    organizationFindUnique.mockResolvedValueOnce({ primaryVertical: "PTA" });
    organizationUpdate.mockResolvedValueOnce({});

    const { changeOrganizationPrimaryVertical } = await import("../organizations");
    const result = await changeOrganizationPrimaryVertical({
      organizationId: "org-1",
      newVertical: "COMMUNITY",
      actorUserId: "admin-1",
      actorEmail: "admin@aphtechnologies.example",
      reason: "Test reclassification",
    });

    expect(result).toEqual({ organizationId: "org-1", previousVertical: "PTA", newVertical: "COMMUNITY" });
    expect(organizationUpdate).toHaveBeenCalledWith({
      where: { id: "org-1" },
      data: { primaryVertical: "COMMUNITY" },
    });
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        actorUserId: "admin-1",
        action: "organization.primary_vertical_changed",
        metadata: expect.objectContaining({ previousVertical: "PTA", newVertical: "COMMUNITY", reason: "Test reclassification" }),
      })
    );
  });
});
