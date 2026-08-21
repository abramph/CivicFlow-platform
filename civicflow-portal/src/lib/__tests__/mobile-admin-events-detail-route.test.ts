import { beforeEach, describe, expect, it, vi } from "vitest";

const requireMobileAuth = vi.fn();
vi.mock("@/lib/mobile-auth", () => ({
  requireMobileAuth: (...args: unknown[]) => requireMobileAuth(...args),
  MobileAuthError: class MobileAuthError extends Error {
    status = 401;
  },
  MobileForbiddenError: class MobileForbiddenError extends Error {
    status = 403;
  },
}));

const resolveMobileAdminCapabilities = vi.fn();
vi.mock("@/lib/mobile-admin", () => ({
  resolveMobileAdminCapabilities: (...args: unknown[]) => resolveMobileAdminCapabilities(...args),
  requireMobileAdminAccess: (...args: unknown[]) => resolveMobileAdminCapabilities(...args),
}));

const findFirstEvent = vi.fn();
const updateEventPrisma = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    event: { findFirst: (...a: unknown[]) => findFirstEvent(...a), update: (...a: unknown[]) => updateEventPrisma(...a) },
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

import { GET, PATCH } from "@/app/api/mobile/admin/events/[eventId]/route";

function getRequest(qs = "organizationId=org-a") {
  return new Request(`https://portal.test/api/mobile/admin/events/evt-1?${qs}`, { headers: { Authorization: "Bearer test-token" } });
}
function patchRequest(body: Record<string, unknown>) {
  return new Request("https://portal.test/api/mobile/admin/events/evt-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
    body: JSON.stringify(body),
  });
}
function params() {
  return { params: Promise.resolve({ eventId: "evt-1" }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileAuth.mockResolvedValue({ userId: "user-1", email: "officer@example.com" });
});

describe("GET /api/mobile/admin/events/[eventId]", () => {
  it("returns 404 for an event belonging to a different organization -- never leaks cross-tenant existence", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "ORG_ADMIN", adminCapabilities: ["manageEvents"] });
    findFirstEvent.mockResolvedValueOnce(null);

    const response = await GET(getRequest("organizationId=org-a"), params());
    expect(response.status).toBe(404);
    expect(findFirstEvent).toHaveBeenCalledWith({ where: { id: "evt-1", organizationId: "org-a" } });
  });

  it("returns the event scoped to the requested organization", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "ORG_ADMIN", adminCapabilities: ["manageEvents"] });
    findFirstEvent.mockResolvedValueOnce({ id: "evt-1", title: "Fall Festival" });

    const response = await GET(getRequest(), params());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.title).toBe("Fall Festival");
  });
});

describe("PATCH /api/mobile/admin/events/[eventId]", () => {
  it("rejects a crafted organizationId, resolved fresh per request", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: false, role: null, adminCapabilities: [] });

    const response = await PATCH(patchRequest({ organizationId: "org-victim", status: "cancelled" }), params());
    expect(response.status).toBe(403);
    expect(resolveMobileAdminCapabilities).toHaveBeenCalledWith("org-victim", "user-1");
    expect(updateEventPrisma).not.toHaveBeenCalled();
  });

  it("cancels an event via status:cancelled -- no separate cancel route, matching the web CancelEventButton pattern", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "ORG_ADMIN", adminCapabilities: ["manageEvents"] });
    findFirstEvent.mockResolvedValueOnce({ id: "evt-1", organizationId: "org-a", title: "Fall Festival", status: "upcoming", location: null });
    updateEventPrisma.mockResolvedValueOnce({ id: "evt-1", organizationId: "org-a", title: "Fall Festival", status: "cancelled", location: null });

    const response = await PATCH(patchRequest({ organizationId: "org-a", status: "cancelled" }), params());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("cancelled");
  });

  it("returns 404 when the event doesn't belong to the caller's organization", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "ORG_ADMIN", adminCapabilities: ["manageEvents"] });
    findFirstEvent.mockResolvedValueOnce(null);

    const response = await PATCH(patchRequest({ organizationId: "org-a", title: "New title" }), params());
    expect(response.status).toBe(404);
  });
});
