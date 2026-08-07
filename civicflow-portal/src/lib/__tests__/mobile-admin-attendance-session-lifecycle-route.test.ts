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
}));

const findFirstSession = vi.fn();
const updateSession = vi.fn();
const countOrgMember = vi.fn();
const groupByAttendanceRecord = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    meetingAttendanceSession: { findFirst: (...a: unknown[]) => findFirstSession(...a), update: (...a: unknown[]) => updateSession(...a) },
    orgMember: { count: (...a: unknown[]) => countOrgMember(...a) },
    attendanceRecord: { groupBy: (...a: unknown[]) => groupByAttendanceRecord(...a) },
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/env", () => ({ getMobileAppWebBaseUrl: () => "https://app.test" }));
vi.mock("@/lib/attendance-token", () => ({
  signAttendanceToken: vi.fn().mockResolvedValue("signed-token"),
  currentRotationSlot: vi.fn().mockReturnValue(42),
}));
vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,xyz") } }));

import { POST as openPost } from "@/app/api/mobile/admin/attendance-sessions/[sessionId]/open/route";
import { POST as closePost } from "@/app/api/mobile/admin/attendance-sessions/[sessionId]/close/route";
import { POST as regeneratePost } from "@/app/api/mobile/admin/attendance-sessions/[sessionId]/regenerate/route";
import { GET as qrGet } from "@/app/api/mobile/admin/attendance-sessions/[sessionId]/qr/route";
import { GET as summaryGet } from "@/app/api/mobile/admin/attendance-sessions/[sessionId]/summary/route";

function params() {
  return { params: Promise.resolve({ sessionId: "session-1" }) };
}
function postRequest(body: Record<string, unknown> = { organizationId: "org-a" }) {
  return new Request("https://portal.test/x", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
    body: JSON.stringify(body),
  });
}
function getRequest(qs = "organizationId=org-a") {
  return new Request(`https://portal.test/x?${qs}`, { headers: { Authorization: "Bearer test-token" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileAuth.mockResolvedValue({ userId: "user-1", email: "officer@example.com" });
});

describe("session lifecycle routes -- manageAttendance gating + tenant scoping", () => {
  it("open: returns 403 without manageAttendance, resolved for the request's own organizationId", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: false, role: null, adminCapabilities: [] });

    const response = await openPost(postRequest({ organizationId: "org-victim" }), params());
    expect(response.status).toBe(403);
    expect(resolveMobileAdminCapabilities).toHaveBeenCalledWith("org-victim", "user-1");
    expect(updateSession).not.toHaveBeenCalled();
  });

  it("open: returns 404 for a session belonging to a different organization", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageAttendance"] });
    findFirstSession.mockResolvedValueOnce(null);

    const response = await openPost(postRequest(), params());
    expect(response.status).toBe(404);
    expect(findFirstSession).toHaveBeenCalledWith({ where: { id: "session-1", organizationId: "org-a" } });
  });

  it("open: flips status to OPEN and records openedByUserId", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageAttendance"] });
    findFirstSession.mockResolvedValueOnce({ id: "session-1", organizationId: "org-a", status: "DRAFT", eventId: "evt-1" });
    updateSession.mockResolvedValueOnce({ id: "session-1", status: "OPEN" });

    const response = await openPost(postRequest(), params());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("OPEN");
    expect(updateSession).toHaveBeenCalledWith({ where: { id: "session-1" }, data: { status: "OPEN", openedByUserId: "user-1" } });
  });

  it("open: refuses to reopen a CANCELLED session", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageAttendance"] });
    findFirstSession.mockResolvedValueOnce({ id: "session-1", organizationId: "org-a", status: "CANCELLED" });

    const response = await openPost(postRequest(), params());
    expect(response.status).toBe(400);
    expect(updateSession).not.toHaveBeenCalled();
  });

  it("close: flips status to CLOSED and records closedByUserId", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageAttendance"] });
    findFirstSession.mockResolvedValueOnce({ id: "session-1", organizationId: "org-a", status: "OPEN", eventId: "evt-1" });
    updateSession.mockResolvedValueOnce({ id: "session-1", status: "CLOSED" });

    const response = await closePost(postRequest(), params());
    expect(response.status).toBe(200);
    expect(updateSession).toHaveBeenCalledWith({ where: { id: "session-1" }, data: { status: "CLOSED", closedByUserId: "user-1" } });
  });

  it("regenerate: bumps tokenVersion", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageAttendance"] });
    findFirstSession.mockResolvedValueOnce({ id: "session-1", organizationId: "org-a", tokenVersion: 1, eventId: "evt-1" });
    updateSession.mockResolvedValueOnce({ id: "session-1", tokenVersion: 2 });

    const response = await regeneratePost(postRequest(), params());
    expect(response.status).toBe(200);
    expect(updateSession).toHaveBeenCalledWith({ where: { id: "session-1" }, data: { tokenVersion: { increment: 1 } } });
  });

  it("qr: returns 400 when the session isn't OPEN", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageAttendance"] });
    findFirstSession.mockResolvedValueOnce({ id: "session-1", organizationId: "org-a", status: "DRAFT" });

    const response = await qrGet(getRequest(), params());
    expect(response.status).toBe(400);
  });

  it("qr: mints a checkInUrl + qrDataUrl for an OPEN session", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageAttendance"] });
    findFirstSession.mockResolvedValueOnce({
      id: "session-1",
      organizationId: "org-a",
      status: "OPEN",
      mode: "ROTATING_QR",
      rotationSeconds: 30,
      tokenVersion: 1,
      meetingId: null,
      eventId: "evt-1",
    });

    const response = await qrGet(getRequest(), params());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.checkInUrl).toContain("https://app.test/attendance/check-in?token=");
    expect(body.data.qrDataUrl).toMatch(/^data:image\/png/);
  });

  it("summary: returns 404 for a cross-org session id", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageAttendance"] });
    findFirstSession.mockResolvedValueOnce(null);

    const response = await summaryGet(getRequest(), params());
    expect(response.status).toBe(404);
  });

  it("summary: computes counts and attendancePercent", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageAttendance"] });
    findFirstSession.mockResolvedValueOnce({ id: "session-1", organizationId: "org-a", meetingId: null, eventId: "evt-1", status: "OPEN" });
    countOrgMember.mockResolvedValueOnce(10);
    groupByAttendanceRecord.mockResolvedValueOnce([
      { attendanceStatus: "PRESENT", _count: 4 },
      { attendanceStatus: "LATE", _count: 1 },
    ]);

    const response = await summaryGet(getRequest(), params());
    const body = await response.json();

    expect(body.data.eligibleCount).toBe(10);
    expect(body.data.checkedInCount).toBe(5);
    expect(body.data.attendancePercent).toBe(50);
  });
});
