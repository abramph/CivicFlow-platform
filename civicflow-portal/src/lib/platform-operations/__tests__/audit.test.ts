import { beforeEach, describe, expect, it, vi } from "vitest";

const auditEventFindMany = vi.fn();
const auditEventCount = vi.fn();
const auditEventFindUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    auditEvent: {
      findMany: (...args: unknown[]) => auditEventFindMany(...args),
      count: (...args: unknown[]) => auditEventCount(...args),
      findUnique: (...args: unknown[]) => auditEventFindUnique(...args),
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  auditEventCount.mockResolvedValue(0);
  auditEventFindMany.mockResolvedValue([]);
});

describe("listAuditEvents — platform-only default", () => {
  it("defaults to organizationId: null (platform-only) when no filters are given", async () => {
    const { listAuditEvents } = await import("../audit");
    await listAuditEvents({}, { page: 1, pageSize: 25 });
    const whereArg = (auditEventFindMany.mock.calls[0]?.[0] as { where?: { organizationId?: unknown } })?.where;
    expect(whereArg?.organizationId).toBeNull();
  });

  it("switches to a specific organization's events when organizationId is provided, even with platformOnly true", async () => {
    const { listAuditEvents } = await import("../audit");
    await listAuditEvents({ organizationId: "org-1", platformOnly: true }, { page: 1, pageSize: 25 });
    const whereArg = (auditEventFindMany.mock.calls[0]?.[0] as { where?: { organizationId?: unknown } })?.where;
    expect(whereArg?.organizationId).toBe("org-1");
  });

  it("includes organization-scoped events when platformOnly is explicitly false and no organizationId is given", async () => {
    const { listAuditEvents } = await import("../audit");
    await listAuditEvents({ platformOnly: false }, { page: 1, pageSize: 25 });
    const whereArg = (auditEventFindMany.mock.calls[0]?.[0] as { where?: { organizationId?: unknown } })?.where;
    expect(whereArg?.organizationId).toBeUndefined();
  });
});

describe("listAuditEvents — pagination", () => {
  it("applies skip/take from the normalized pagination input", async () => {
    const { listAuditEvents } = await import("../audit");
    await listAuditEvents({}, { page: 3, pageSize: 10 });
    const call = auditEventFindMany.mock.calls[0]?.[0] as { skip?: number; take?: number };
    expect(call.skip).toBe(20);
    expect(call.take).toBe(10);
  });
});

describe("getAuditEventDetail — redaction", () => {
  it("returns null for an unknown event id", async () => {
    auditEventFindUnique.mockResolvedValueOnce(null);
    const { getAuditEventDetail } = await import("../audit");
    expect(await getAuditEventDetail("missing")).toBeNull();
  });

  it("redacts sensitive fields in before/after before returning them", async () => {
    auditEventFindUnique.mockResolvedValueOnce({
      id: "evt-1",
      action: "platform_access.granted",
      resource: "platform_access",
      resourceId: "pa-1",
      actorEmail: "admin@example.com",
      organizationId: null,
      createdAt: new Date(),
      before: null,
      after: { userId: "u1", reason: "onboarding", accessToken: "leak-me" },
      ipAddress: "203.0.113.1",
    });
    const { getAuditEventDetail } = await import("../audit");
    const detail = await getAuditEventDetail("evt-1");
    expect(detail?.after).toEqual({ userId: "u1", reason: "onboarding", accessToken: "[redacted]" });
  });
});

describe("listDistinctPlatformActions", () => {
  it("only queries platform-level (organizationId: null) events", async () => {
    const { listDistinctPlatformActions } = await import("../audit");
    await listDistinctPlatformActions();
    const whereArg = (auditEventFindMany.mock.calls[0]?.[0] as { where?: { organizationId?: unknown } })?.where;
    expect(whereArg?.organizationId).toBeNull();
  });
});
