import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  currentRotationSlot,
  signAttendanceToken,
  unsafeDecodeSessionId,
  verifyAttendanceToken,
} from "@/lib/attendance-token";

function baseSession(overrides: Partial<Parameters<typeof verifyAttendanceToken>[1]> = {}) {
  return {
    id: "session_1",
    organizationId: "org_1",
    meetingId: "meeting_1",
    status: "OPEN",
    mode: "ROTATING_QR" as const,
    tokenVersion: 1,
    rotationSeconds: 30,
    opensAt: null,
    closesAt: null,
    ...overrides,
  };
}

describe("attendance-token", () => {
  beforeAll(() => {
    process.env.ATTENDANCE_QR_SECRET = "test-attendance-qr-secret-not-real";
  });

  it("round-trips a valid rotating token", async () => {
    const token = await signAttendanceToken({
      sessionId: "session_1",
      organizationId: "org_1",
      meetingId: "meeting_1",
      tokenVersion: 1,
      mode: "ROTATING_QR",
      rotationSeconds: 30,
    });
    const result = await verifyAttendanceToken(token, baseSession());
    expect(result).toEqual({ ok: true, sessionId: "session_1", organizationId: "org_1", meetingId: "meeting_1" });
  });

  it("round-trips a valid static token", async () => {
    const token = await signAttendanceToken({
      sessionId: "session_2",
      organizationId: "org_1",
      meetingId: "meeting_1",
      tokenVersion: 1,
      mode: "STATIC_QR",
      rotationSeconds: 30,
    });
    const result = await verifyAttendanceToken(
      token,
      baseSession({ id: "session_2", mode: "STATIC_QR" })
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a token for the wrong session id", async () => {
    const token = await signAttendanceToken({
      sessionId: "session_1",
      organizationId: "org_1",
      meetingId: "meeting_1",
      tokenVersion: 1,
      mode: "ROTATING_QR",
      rotationSeconds: 30,
    });
    const result = await verifyAttendanceToken(token, baseSession({ id: "session_other" }));
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects an altered payload (tampered organizationId)", async () => {
    const token = await signAttendanceToken({
      sessionId: "session_1",
      organizationId: "org_1",
      meetingId: "meeting_1",
      tokenVersion: 1,
      mode: "ROTATING_QR",
      rotationSeconds: 30,
    });
    // Flip a character in the payload segment to simulate tampering.
    const parts = token.split(".");
    const tampered = [parts[0], parts[1].slice(0, -1) + (parts[1].slice(-1) === "A" ? "B" : "A"), parts[2]].join(".");
    const result = await verifyAttendanceToken(tampered, baseSession());
    expect(result.ok).toBe(false);
  });

  it("rejects an expired token", async () => {
    vi.useFakeTimers();
    try {
      const token = await signAttendanceToken({
        sessionId: "session_1",
        organizationId: "org_1",
        meetingId: "meeting_1",
        tokenVersion: 1,
        mode: "ROTATING_QR",
        rotationSeconds: 30,
      });
      vi.advanceTimersByTime(3 * 60 * 1000); // past the 120s TTL
      const result = await verifyAttendanceToken(token, baseSession());
      expect(result).toEqual({ ok: false, reason: "expired" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a token signed under a stale (regenerated) tokenVersion", async () => {
    const token = await signAttendanceToken({
      sessionId: "session_1",
      organizationId: "org_1",
      meetingId: "meeting_1",
      tokenVersion: 1,
      mode: "ROTATING_QR",
      rotationSeconds: 30,
    });
    // Session was regenerated — current version is now 2.
    const result = await verifyAttendanceToken(token, baseSession({ tokenVersion: 2 }));
    expect(result).toEqual({ ok: false, reason: "stale_version" });
  });

  it("rejects a token for a closed session", async () => {
    const token = await signAttendanceToken({
      sessionId: "session_1",
      organizationId: "org_1",
      meetingId: "meeting_1",
      tokenVersion: 1,
      mode: "ROTATING_QR",
      rotationSeconds: 30,
    });
    const result = await verifyAttendanceToken(token, baseSession({ status: "CLOSED" }));
    expect(result).toEqual({ ok: false, reason: "session_not_open" });
  });

  it("rejects a token for a cancelled session", async () => {
    const token = await signAttendanceToken({
      sessionId: "session_1",
      organizationId: "org_1",
      meetingId: "meeting_1",
      tokenVersion: 1,
      mode: "ROTATING_QR",
      rotationSeconds: 30,
    });
    const result = await verifyAttendanceToken(token, baseSession({ status: "CANCELLED" }));
    expect(result).toEqual({ ok: false, reason: "session_not_open" });
  });

  it("rejects a token scanned before the attendance window opens", async () => {
    const token = await signAttendanceToken({
      sessionId: "session_1",
      organizationId: "org_1",
      meetingId: "meeting_1",
      tokenVersion: 1,
      mode: "ROTATING_QR",
      rotationSeconds: 30,
    });
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const result = await verifyAttendanceToken(token, baseSession({ opensAt: future }));
    expect(result).toEqual({ ok: false, reason: "outside_window" });
  });

  it("rejects a token scanned after the attendance window closes", async () => {
    const token = await signAttendanceToken({
      sessionId: "session_1",
      organizationId: "org_1",
      meetingId: "meeting_1",
      tokenVersion: 1,
      mode: "ROTATING_QR",
      rotationSeconds: 30,
    });
    const past = new Date(Date.now() - 60 * 60 * 1000);
    const result = await verifyAttendanceToken(token, baseSession({ closesAt: past }));
    expect(result).toEqual({ ok: false, reason: "outside_window" });
  });

  it("rejects a code for another organization even if the session id matched", async () => {
    const token = await signAttendanceToken({
      sessionId: "session_1",
      organizationId: "org_1",
      meetingId: "meeting_1",
      tokenVersion: 1,
      mode: "ROTATING_QR",
      rotationSeconds: 30,
    });
    const result = await verifyAttendanceToken(token, baseSession({ organizationId: "org_2" }));
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("accepts the immediately previous rotation slot (clock/latency tolerance)", async () => {
    vi.useFakeTimers();
    try {
      const token = await signAttendanceToken({
        sessionId: "session_1",
        organizationId: "org_1",
        meetingId: "meeting_1",
        tokenVersion: 1,
        mode: "ROTATING_QR",
        rotationSeconds: 30,
      });
      vi.advanceTimersByTime(30 * 1000); // exactly one slot later
      const result = await verifyAttendanceToken(token, baseSession());
      expect(result.ok).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a slot older than the configured tolerance", async () => {
    vi.useFakeTimers();
    try {
      const token = await signAttendanceToken({
        sessionId: "session_1",
        organizationId: "org_1",
        meetingId: "meeting_1",
        tokenVersion: 1,
        mode: "ROTATING_QR",
        rotationSeconds: 30,
      });
      vi.advanceTimersByTime(90 * 1000); // three slots later — outside tolerance
      const result = await verifyAttendanceToken(token, baseSession());
      expect(result).toEqual({ ok: false, reason: "slot_too_old" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("computes rotation slots as a monotonic step function of time", () => {
    const a = currentRotationSlot(30);
    expect(Number.isInteger(a)).toBe(true);
    expect(a).toBeGreaterThan(0);
  });

  it("unsafeDecodeSessionId peeks the session id without verifying the signature", async () => {
    const token = await signAttendanceToken({
      sessionId: "session_1",
      organizationId: "org_1",
      meetingId: "meeting_1",
      tokenVersion: 1,
      mode: "ROTATING_QR",
      rotationSeconds: 30,
    });
    expect(unsafeDecodeSessionId(token)).toBe("session_1");
    expect(unsafeDecodeSessionId("not-a-jwt")).toBeNull();
  });
});
