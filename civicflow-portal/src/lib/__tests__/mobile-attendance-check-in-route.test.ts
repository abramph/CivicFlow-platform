import { beforeEach, describe, expect, it, vi } from "vitest";

const requireRateLimit = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/rate-limit", () => ({
  requireRateLimit: (...args: unknown[]) => requireRateLimit(...args),
}));

const resolveAttendanceSession = vi.fn();
const recordAttendanceCheckIn = vi.fn();
const checkInRejectionMessage = vi.fn((reason: string) => `rejected:${reason}`);
vi.mock("@/lib/attendance-checkin", () => ({
  resolveAttendanceSession: (...args: unknown[]) => resolveAttendanceSession(...args),
  recordAttendanceCheckIn: (...args: unknown[]) => recordAttendanceCheckIn(...args),
  checkInRejectionMessage: (reason: string) => checkInRejectionMessage(reason),
}));

const requireMobileMembership = vi.fn();
vi.mock("@/lib/mobile-auth", () => ({
  requireMobileMembership: (...args: unknown[]) => requireMobileMembership(...args),
  MobileForbiddenError: class MobileForbiddenError extends Error {
    status = 403;
  },
  MobileAuthError: class MobileAuthError extends Error {
    status = 401;
  },
}));

const findFirstOrgMember = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgMember: { findFirst: (...args: unknown[]) => findFirstOrgMember(...args) },
  },
}));

import { POST } from "@/app/api/mobile/attendance/check-in/route";

function request(body: unknown) {
  return new Request("https://portal.test/api/mobile/attendance/check-in", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/mobile/attendance/check-in", () => {
  beforeEach(() => {
    requireRateLimit.mockClear();
    resolveAttendanceSession.mockReset();
    recordAttendanceCheckIn.mockReset();
    requireMobileMembership.mockReset();
    findFirstOrgMember.mockReset();
  });

  it("rejects a code with an invalid/expired token before ever checking membership", async () => {
    resolveAttendanceSession.mockResolvedValueOnce({ ok: false, reason: "expired" });

    const response = await POST(request({ qrToken: "stale-token" }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.ok).toBe(false);
    expect(data.code).toBe("expired");
    expect(requireMobileMembership).not.toHaveBeenCalled();
  });

  it("derives organizationId only from the token's session, never from the request body", async () => {
    resolveAttendanceSession.mockResolvedValueOnce({
      ok: true,
      session: { id: "s1", organizationId: "org-real", meetingId: "m1", meetingTitle: "Board", meetingDate: new Date(), lateThresholdMinutes: 10 },
    });
    requireMobileMembership.mockResolvedValueOnce({ memberId: "member-1" });
    findFirstOrgMember.mockResolvedValueOnce({ membershipStatus: "active" });
    recordAttendanceCheckIn.mockResolvedValueOnce({ alreadyCheckedIn: false, attendanceRecordId: "att-1" });

    // Even if a caller tried to smuggle a different organizationId into the
    // body, there's no such field in the schema at all — it's simply ignored.
    await POST(request({ qrToken: "valid-token", organizationId: "org-attacker-supplied" }));

    expect(requireMobileMembership).toHaveBeenCalledWith(expect.anything(), "org-real");
  });

  it("rejects when the member's own org membership doesn't match the meeting's organization (cross-org)", async () => {
    resolveAttendanceSession.mockResolvedValueOnce({
      ok: true,
      session: { id: "s1", organizationId: "org-real", meetingId: "m1", meetingTitle: "Board", meetingDate: new Date(), lateThresholdMinutes: 10 },
    });
    const { MobileForbiddenError } = await import("@/lib/mobile-auth");
    requireMobileMembership.mockRejectedValueOnce(new MobileForbiddenError("No active membership for this organization"));

    const response = await POST(request({ qrToken: "valid-token" }));

    expect(response.status).toBe(403);
    expect(recordAttendanceCheckIn).not.toHaveBeenCalled();
  });

  it("rejects a suspended/inactive member even though they hold a real membership row", async () => {
    resolveAttendanceSession.mockResolvedValueOnce({
      ok: true,
      session: { id: "s1", organizationId: "org-real", meetingId: "m1", meetingTitle: "Board", meetingDate: new Date(), lateThresholdMinutes: 10 },
    });
    requireMobileMembership.mockResolvedValueOnce({ memberId: "member-1" });
    findFirstOrgMember.mockResolvedValueOnce({ membershipStatus: "inactive" });

    const response = await POST(request({ qrToken: "valid-token" }));
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.code).toBe("not_eligible");
    expect(recordAttendanceCheckIn).not.toHaveBeenCalled();
  });

  it("returns the idempotent 'already checked in' confirmation without erroring", async () => {
    resolveAttendanceSession.mockResolvedValueOnce({
      ok: true,
      session: { id: "s1", organizationId: "org-real", meetingId: "m1", meetingTitle: "Board", meetingDate: new Date(), lateThresholdMinutes: 10 },
    });
    requireMobileMembership.mockResolvedValueOnce({ memberId: "member-1" });
    findFirstOrgMember.mockResolvedValueOnce({ membershipStatus: "active" });
    recordAttendanceCheckIn.mockResolvedValueOnce({ alreadyCheckedIn: true, attendanceRecordId: "att-existing", attendanceStatus: "PRESENT" });

    const response = await POST(request({ qrToken: "valid-token" }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.data.alreadyCheckedIn).toBe(true);
  });

  it("rate-limits repeated check-in attempts", async () => {
    requireRateLimit.mockResolvedValueOnce(Response.json({ ok: false, error: "Rate limit exceeded" }, { status: 429 }));

    const response = await POST(request({ qrToken: "valid-token" }));

    expect(response.status).toBe(429);
    expect(resolveAttendanceSession).not.toHaveBeenCalled();
  });
});
