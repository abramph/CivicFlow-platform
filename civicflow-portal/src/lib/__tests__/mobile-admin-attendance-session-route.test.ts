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
const findFirstSession = vi.fn();
const createSession = vi.fn();
const findManyAttendanceRecord = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    event: { findFirst: (...a: unknown[]) => findFirstEvent(...a) },
    meetingAttendanceSession: { findFirst: (...a: unknown[]) => findFirstSession(...a), create: (...a: unknown[]) => createSession(...a) },
    attendanceRecord: { findMany: (...a: unknown[]) => findManyAttendanceRecord(...a) },
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));

import { GET as sessionGet, POST as sessionPost } from "@/app/api/mobile/admin/events/[eventId]/attendance-session/route";
import { GET as rosterGet } from "@/app/api/mobile/admin/events/[eventId]/attendance/route";

function params() {
  return { params: Promise.resolve({ eventId: "evt-1" }) };
}
function postRequest(body: Record<string, unknown>) {
  return new Request("https://portal.test/api/mobile/admin/events/evt-1/attendance-session", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
    body: JSON.stringify(body),
  });
}
function getRequest(path: string, qs = "organizationId=org-a") {
  return new Request(`https://portal.test${path}?${qs}`, { headers: { Authorization: "Bearer test-token" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileAuth.mockResolvedValue({ userId: "user-1", email: "officer@example.com" });
});

describe("POST /api/mobile/admin/events/[eventId]/attendance-session", () => {
  it("returns 403 without manageAttendance", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: false, role: null, adminCapabilities: [] });

    const response = await sessionPost(postRequest({ organizationId: "org-a" }), params());
    expect(response.status).toBe(403);
    expect(findFirstEvent).not.toHaveBeenCalled();
  });

  it("returns 400 when the event has no startAt set yet", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageAttendance"] });
    findFirstEvent.mockResolvedValueOnce({ id: "evt-1", organizationId: "org-a", startAt: null });

    const response = await sessionPost(postRequest({ organizationId: "org-a" }), params());
    expect(response.status).toBe(400);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("reuses an existing DRAFT/OPEN session instead of creating a second one", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageAttendance"] });
    findFirstEvent.mockResolvedValueOnce({ id: "evt-1", organizationId: "org-a", startAt: new Date() });
    findFirstSession.mockResolvedValueOnce({ id: "session-existing", status: "OPEN" });

    const response = await sessionPost(postRequest({ organizationId: "org-a" }), params());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.id).toBe("session-existing");
    expect(createSession).not.toHaveBeenCalled();
  });

  it("creates a new session when none is in progress", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageAttendance"] });
    findFirstEvent.mockResolvedValueOnce({ id: "evt-1", organizationId: "org-a", startAt: new Date() });
    findFirstSession.mockResolvedValueOnce(null);
    createSession.mockResolvedValueOnce({ id: "session-new", eventId: "evt-1", mode: "ROTATING_QR" });

    const response = await sessionPost(postRequest({ organizationId: "org-a" }), params());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.id).toBe("session-new");
  });
});

describe("GET /api/mobile/admin/events/[eventId]/attendance-session", () => {
  it("requires organizationId", async () => {
    const response = await sessionGet(new Request("https://portal.test/api/mobile/admin/events/evt-1/attendance-session"), params());
    expect(response.status).toBe(400);
  });
});

describe("GET /api/mobile/admin/events/[eventId]/attendance (roster)", () => {
  it("returns 403 without manageAttendance", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageEvents"] });

    const response = await rosterGet(getRequest("/api/mobile/admin/events/evt-1/attendance"), params());
    expect(response.status).toBe(403);
    expect(findManyAttendanceRecord).not.toHaveBeenCalled();
  });

  it("scopes the roster query to the requested event + organization", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageAttendance"] });
    findManyAttendanceRecord.mockResolvedValueOnce([]);

    await rosterGet(getRequest("/api/mobile/admin/events/evt-1/attendance", "organizationId=org-a"), params());

    expect(findManyAttendanceRecord).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-a", eventId: "evt-1" } })
    );
  });
});
