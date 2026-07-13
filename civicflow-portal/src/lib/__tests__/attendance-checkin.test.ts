import { beforeEach, describe, expect, it, vi } from "vitest";

const createAttendanceRecord = vi.fn();
const findUniqueAttendanceRecord = vi.fn();
const findUniqueSession = vi.fn();

const { FakePrismaKnownError } = vi.hoisted(() => {
  class FakePrismaKnownError extends Error {
    code: string;
    constructor(code: string) {
      super("Prisma known request error");
      this.code = code;
    }
  }
  return { FakePrismaKnownError };
});

vi.mock("@prisma/client", () => ({
  Prisma: {
    PrismaClientKnownRequestError: FakePrismaKnownError,
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    attendanceRecord: {
      create: (...args: unknown[]) => createAttendanceRecord(...args),
      findUnique: (...args: unknown[]) => findUniqueAttendanceRecord(...args),
    },
    meetingAttendanceSession: {
      findUnique: (...args: unknown[]) => findUniqueSession(...args),
    },
  },
}));

const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({
  createAuditEvent: (...args: unknown[]) => createAuditEvent(...args),
}));

const sendPushToMember = vi.fn().mockResolvedValue({ sent: 0, failed: 0 });
vi.mock("@/lib/push", () => ({
  sendPushToMember: (...args: unknown[]) => sendPushToMember(...args),
}));

import { recordAttendanceCheckIn, resolveAttendanceSession } from "@/lib/attendance-checkin";
import { signAttendanceToken } from "@/lib/attendance-token";

function baseResolvedSession() {
  return {
    id: "session-1",
    organizationId: "org-a",
    meetingId: "meeting-1",
    meetingTitle: "Board Meeting",
    meetingDate: new Date("2026-01-01T18:00:00.000Z"),
    lateThresholdMinutes: 10,
  };
}

describe("recordAttendanceCheckIn", () => {
  beforeEach(() => {
    createAttendanceRecord.mockReset();
    findUniqueAttendanceRecord.mockReset();
    createAuditEvent.mockClear();
    sendPushToMember.mockClear();
    vi.useRealTimers();
  });

  it("records PRESENT when checking in before the late cutoff", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T18:05:00.000Z")); // 5 min after start, threshold is 10
    createAttendanceRecord.mockResolvedValueOnce({ id: "att-1" });

    const outcome = await recordAttendanceCheckIn({ session: baseResolvedSession(), memberId: "member-1", method: "QR_APP" });

    expect(outcome.alreadyCheckedIn).toBe(false);
    expect(outcome.attendanceStatus).toBe("PRESENT");
    expect(createAttendanceRecord).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ attendanceStatus: "PRESENT", method: "QR_APP" }) })
    );
    expect(createAuditEvent).toHaveBeenCalled();
  });

  it("records LATE when checking in after the grace period, computed server-side", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T18:20:00.000Z")); // 20 min after start, threshold is 10
    createAttendanceRecord.mockResolvedValueOnce({ id: "att-2" });

    const outcome = await recordAttendanceCheckIn({ session: baseResolvedSession(), memberId: "member-1", method: "QR_WEB" });

    expect(outcome.attendanceStatus).toBe("LATE");
  });

  it("is idempotent: a duplicate check-in returns the existing record instead of creating a second one", async () => {
    createAttendanceRecord.mockRejectedValueOnce(new FakePrismaKnownError("P2002"));
    findUniqueAttendanceRecord.mockResolvedValueOnce({
      id: "att-existing",
      attendanceStatus: "PRESENT",
      checkInTime: new Date("2026-01-01T18:01:00.000Z"),
      createdAt: new Date("2026-01-01T18:01:00.000Z"),
    });

    const outcome = await recordAttendanceCheckIn({ session: baseResolvedSession(), memberId: "member-1", method: "QR_APP" });

    expect(outcome.alreadyCheckedIn).toBe(true);
    expect(outcome.attendanceRecordId).toBe("att-existing");
    // Only one create attempt — the second "request" never inserts a second row.
    expect(createAttendanceRecord).toHaveBeenCalledTimes(1);
  });

  it("re-throws a genuinely unexpected error rather than swallowing it", async () => {
    createAttendanceRecord.mockRejectedValueOnce(new Error("connection reset"));

    await expect(
      recordAttendanceCheckIn({ session: baseResolvedSession(), memberId: "member-1", method: "QR_APP" })
    ).rejects.toThrow("connection reset");
  });
});

describe("resolveAttendanceSession", () => {
  beforeEach(() => {
    findUniqueSession.mockReset();
    process.env.ATTENDANCE_QR_SECRET = "test-secret-for-resolve";
  });

  it("rejects an invalid/undecodable token before ever touching the database", async () => {
    const result = await resolveAttendanceSession("not-a-real-token");
    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(findUniqueSession).not.toHaveBeenCalled();
  });

  it("rejects when the session referenced by the token no longer exists", async () => {
    const token = await signAttendanceToken({
      sessionId: "session-missing",
      organizationId: "org-a",
      meetingId: "meeting-1",
      tokenVersion: 1,
      mode: "ROTATING_QR",
      rotationSeconds: 30,
    });
    findUniqueSession.mockResolvedValueOnce(null);

    const result = await resolveAttendanceSession(token);
    expect(result).toEqual({ ok: false, reason: "session_not_found" });
  });

  it("resolves organizationId/meetingId from the database row, not the token payload", async () => {
    const token = await signAttendanceToken({
      sessionId: "session-1",
      organizationId: "org-a",
      meetingId: "meeting-1",
      tokenVersion: 1,
      mode: "ROTATING_QR",
      rotationSeconds: 30,
    });
    findUniqueSession.mockResolvedValueOnce({
      id: "session-1",
      organizationId: "org-a",
      meetingId: "meeting-1",
      status: "OPEN",
      mode: "ROTATING_QR",
      tokenVersion: 1,
      rotationSeconds: 30,
      lateThresholdMinutes: 10,
      opensAt: null,
      closesAt: null,
      meeting: { id: "meeting-1", title: "Board Meeting", meetingDate: new Date("2026-01-01T18:00:00.000Z") },
    });

    const result = await resolveAttendanceSession(token);
    expect(result).toEqual({
      ok: true,
      session: {
        id: "session-1",
        organizationId: "org-a",
        meetingId: "meeting-1",
        meetingTitle: "Board Meeting",
        meetingDate: new Date("2026-01-01T18:00:00.000Z"),
        lateThresholdMinutes: 10,
      },
    });
  });
});
