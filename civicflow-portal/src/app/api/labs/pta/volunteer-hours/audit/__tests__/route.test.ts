import { beforeEach, describe, expect, it, vi } from "vitest";

const requireVolunteerHoursAuditAccess = vi.fn();
vi.mock("@/lib/labs/pta/volunteer-hours/guard", () => ({
  requireVolunteerHoursAuditAccess: (...a: unknown[]) => requireVolunteerHoursAuditAccess(...a),
}));

const findManyAuditEvent = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { auditEvent: { findMany: (...a: unknown[]) => findManyAuditEvent(...a) } } }));

beforeEach(() => {
  vi.clearAllMocks();
  requireVolunteerHoursAuditAccess.mockResolvedValue({ organizationId: "org-1" });
  findManyAuditEvent.mockResolvedValue([]);
});

describe("GET .../volunteer-hours/audit", () => {
  it("uses the audit-specific guard (survives 'requirements' being disabled), not the ordinary capability-gated guard", async () => {
    const { GET } = await import("../route");
    await GET(new Request("https://x.test"));
    expect(requireVolunteerHoursAuditAccess).toHaveBeenCalledWith("pta:volunteer-audit:view");
  });

  it("scopes to this organization and every pta.volunteer_hours.* action, including agreement events", async () => {
    const { GET } = await import("../route");
    await GET(new Request("https://x.test"));
    expect(findManyAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-1", action: { startsWith: "pta.volunteer_hours." } } })
    );
  });

  it("propagates a guard rejection without ever querying audit events", async () => {
    const { PtaError } = await import("@/lib/labs/pta/errors");
    requireVolunteerHoursAuditAccess.mockRejectedValue(new PtaError("PTA_VOLUNTEER_HOURS_PLATFORM_DISABLED", "off"));
    const { GET } = await import("../route");
    const res = await GET(new Request("https://x.test"));
    expect(res.status).not.toBe(200);
    expect(findManyAuditEvent).not.toHaveBeenCalled();
  });

  it("clamps the take parameter to [1, 500]", async () => {
    const { GET } = await import("../route");
    await GET(new Request("https://x.test?take=99999"));
    expect(findManyAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ take: 500 }));

    await GET(new Request("https://x.test?take=-5"));
    expect(findManyAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ take: 1 }));
  });
});
