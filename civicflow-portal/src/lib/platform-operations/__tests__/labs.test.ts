import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueOrganization = vi.fn();
const findUniqueEnrollment = vi.fn();
const upsertEnrollment = vi.fn();
const countEnrollment = vi.fn();
const findManyEnrollment = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);
const findManyAuditEvent = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: (...args: unknown[]) => findUniqueOrganization(...args) },
    organizationLabFeature: {
      findUnique: (...args: unknown[]) => findUniqueEnrollment(...args),
      upsert: (...args: unknown[]) => upsertEnrollment(...args),
      count: (...args: unknown[]) => countEnrollment(...args),
      findMany: (...args: unknown[]) => findManyEnrollment(...args),
    },
    auditEvent: { findMany: (...args: unknown[]) => findManyAuditEvent(...args) },
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

beforeEach(() => {
  vi.clearAllMocks();
  createAuditEvent.mockResolvedValue(undefined);
});

describe("listLabFeatureDefinitions", () => {
  it("returns the full registry", async () => {
    const { listLabFeatureDefinitions } = await import("../labs");
    const features = listLabFeatureDefinitions();
    expect(features.some((f) => f.key === "labsFrameworkPreview")).toBe(true);
  });
});

describe("listLabEnrollments", () => {
  it("scopes by featureKey and organizationId filters when provided", async () => {
    countEnrollment.mockResolvedValueOnce(1);
    findManyEnrollment.mockResolvedValueOnce([
      {
        id: "enr-1",
        organizationId: "org-a",
        featureKey: "labsFrameworkPreview",
        status: "ENABLED",
        enabledAt: new Date("2026-01-01"),
        disabledAt: null,
        enrollmentSource: "seed",
        notes: null,
        updatedAt: new Date("2026-01-02"),
        organization: { name: "APH Technologies, LLC", slug: "aph-technologies" },
      },
    ]);

    const { listLabEnrollments } = await import("../labs");
    const result = await listLabEnrollments({ featureKey: "labsFrameworkPreview", organizationId: "org-a" }, { page: 1, pageSize: 25 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ organizationName: "APH Technologies, LLC", featureKey: "labsFrameworkPreview", status: "ENABLED" });
    expect(findManyEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({ where: { featureKey: "labsFrameworkPreview", organizationId: "org-a" } })
    );
  });

  it("returns an empty page rather than throwing when nothing matches", async () => {
    countEnrollment.mockResolvedValueOnce(0);
    findManyEnrollment.mockResolvedValueOnce([]);
    const { listLabEnrollments } = await import("../labs");
    const result = await listLabEnrollments({}, { page: 1, pageSize: 25 });
    expect(result.items).toEqual([]);
    expect(result.pagination.totalCount).toBe(0);
  });
});

describe("setOrganizationLabEnrollment", () => {
  it("rejects an unknown feature key before touching the database", async () => {
    const { setOrganizationLabEnrollment, LabEnrollmentValidationError } = await import("../labs");
    await expect(
      setOrganizationLabEnrollment({
        organizationId: "org-a",
        featureKey: "notARealFeature",
        status: "ENABLED",
        actorUserId: "user-1",
        actorEmail: "admin@example.com",
      })
    ).rejects.toBeInstanceOf(LabEnrollmentValidationError);
    expect(findUniqueOrganization).not.toHaveBeenCalled();
  });

  it("rejects a missing organization", async () => {
    findUniqueOrganization.mockResolvedValueOnce(null);
    const { setOrganizationLabEnrollment, LabEnrollmentValidationError } = await import("../labs");
    await expect(
      setOrganizationLabEnrollment({
        organizationId: "missing-org",
        featureKey: "labsFrameworkPreview",
        status: "ENABLED",
        actorUserId: "user-1",
        actorEmail: "admin@example.com",
      })
    ).rejects.toBeInstanceOf(LabEnrollmentValidationError);
    expect(upsertEnrollment).not.toHaveBeenCalled();
  });

  it("rejects enabling an internal-only feature for a non-billing-exempt organization", async () => {
    findUniqueOrganization.mockResolvedValueOnce({ id: "org-a", name: "Ordinary Org", slug: "ordinary-org", billingExempt: false });
    const { setOrganizationLabEnrollment, LabEnrollmentValidationError } = await import("../labs");
    await expect(
      setOrganizationLabEnrollment({
        organizationId: "org-a",
        featureKey: "labsFrameworkPreview",
        status: "ENABLED",
        actorUserId: "user-1",
        actorEmail: "admin@example.com",
      })
    ).rejects.toBeInstanceOf(LabEnrollmentValidationError);
    expect(upsertEnrollment).not.toHaveBeenCalled();
  });

  it("allows disabling/suspending an internal-only feature for a non-billing-exempt organization (cleanup path stays open)", async () => {
    findUniqueOrganization.mockResolvedValue({ id: "org-a", name: "Ordinary Org", slug: "ordinary-org", billingExempt: false });
    findUniqueEnrollment.mockResolvedValue({ status: "ENABLED" });
    upsertEnrollment.mockResolvedValue({
      id: "enr-1",
      organizationId: "org-a",
      featureKey: "labsFrameworkPreview",
      status: "DISABLED",
      enabledAt: null,
      disabledAt: new Date(),
      enrollmentSource: "operations_center",
      notes: null,
      updatedAt: new Date(),
      organization: { name: "Ordinary Org", slug: "ordinary-org" },
    });

    const { setOrganizationLabEnrollment } = await import("../labs");
    const result = await setOrganizationLabEnrollment({
      organizationId: "org-a",
      featureKey: "labsFrameworkPreview",
      status: "DISABLED",
      actorUserId: "user-1",
      actorEmail: "admin@example.com",
    });
    expect(result.status).toBe("DISABLED");
  });

  it("allows enabling an internal-only feature for a billing-exempt organization and audit-logs the change", async () => {
    findUniqueOrganization.mockResolvedValueOnce({ id: "aph-org", name: "APH Technologies, LLC", slug: "aph-technologies", billingExempt: true });
    findUniqueEnrollment.mockResolvedValueOnce(null);
    upsertEnrollment.mockResolvedValueOnce({
      id: "enr-1",
      organizationId: "aph-org",
      featureKey: "labsFrameworkPreview",
      status: "ENABLED",
      enabledAt: new Date(),
      disabledAt: null,
      enrollmentSource: "operations_center",
      notes: "test enrollment",
      updatedAt: new Date(),
      organization: { name: "APH Technologies, LLC", slug: "aph-technologies" },
    });

    const { setOrganizationLabEnrollment } = await import("../labs");
    const result = await setOrganizationLabEnrollment({
      organizationId: "aph-org",
      featureKey: "labsFrameworkPreview",
      status: "ENABLED",
      actorUserId: "user-1",
      actorEmail: "admin@example.com",
      notes: "test enrollment",
    });

    expect(result.status).toBe("ENABLED");
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "labs.enrollment.status_changed",
        organizationId: "aph-org",
        entityType: "organization_lab_feature",
        entityId: "enr-1",
        metadata: expect.objectContaining({ featureKey: "labsFrameworkPreview", previousStatus: null, newStatus: "ENABLED" }),
      })
    );
  });

  it("never touches Organization.plan, billingExempt as a write target, or any membership/RBAC row", async () => {
    findUniqueOrganization.mockResolvedValueOnce({ id: "aph-org", name: "APH Technologies, LLC", slug: "aph-technologies", billingExempt: true });
    findUniqueEnrollment.mockResolvedValueOnce(null);
    upsertEnrollment.mockResolvedValueOnce({
      id: "enr-1",
      organizationId: "aph-org",
      featureKey: "labsFrameworkPreview",
      status: "ENABLED",
      enabledAt: new Date(),
      disabledAt: null,
      enrollmentSource: "operations_center",
      notes: null,
      updatedAt: new Date(),
      organization: { name: "APH Technologies, LLC", slug: "aph-technologies" },
    });

    const { setOrganizationLabEnrollment } = await import("../labs");
    await setOrganizationLabEnrollment({
      organizationId: "aph-org",
      featureKey: "labsFrameworkPreview",
      status: "ENABLED",
      actorUserId: "user-1",
      actorEmail: "admin@example.com",
    });

    // Only organizationLabFeature.upsert is called to persist a change —
    // no organization.update, no membership/RBAC mutation is ever invoked
    // by this module (there's no such mock even wired up, so any attempt
    // would throw "not a function" and fail the test).
    expect(upsertEnrollment).toHaveBeenCalledTimes(1);
  });
});

describe("getLabEnrollmentHistory", () => {
  it("reads from AuditEvent scoped to the enrollment's resource/resourceId", async () => {
    findManyAuditEvent.mockResolvedValueOnce([
      { id: "audit-1", action: "labs.enrollment.status_changed", actorEmail: "admin@example.com", after: { newStatus: "ENABLED" }, createdAt: new Date("2026-01-01") },
    ]);
    const { getLabEnrollmentHistory } = await import("../labs");
    const history = await getLabEnrollmentHistory("enr-1");
    expect(history).toHaveLength(1);
    expect(findManyAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ where: { resource: "organization_lab_feature", resourceId: "enr-1" } })
    );
  });

  it("returns an empty history rather than throwing for an enrollment with no recorded events", async () => {
    findManyAuditEvent.mockResolvedValueOnce([]);
    const { getLabEnrollmentHistory } = await import("../labs");
    expect(await getLabEnrollmentHistory("enr-2")).toEqual([]);
  });
});
