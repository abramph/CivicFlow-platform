import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePermission = vi.fn();
vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return {
    ...actual,
    requirePermission: (...args: unknown[]) => requirePermission(...args),
  };
});

const findFirstSession = vi.fn();
const countOrgMember = vi.fn().mockResolvedValue(0);
const groupByAttendanceRecord = vi.fn().mockResolvedValue([]);
vi.mock("@/lib/prisma", () => ({
  prisma: {
    meetingAttendanceSession: { findFirst: (...args: unknown[]) => findFirstSession(...args) },
    orgMember: { count: (...args: unknown[]) => countOrgMember(...args) },
    attendanceRecord: { groupBy: (...args: unknown[]) => groupByAttendanceRecord(...args) },
  },
}));

import { GET } from "@/app/api/attendance-sessions/[id]/summary/route";

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/attendance-sessions/[id]/summary", () => {
  beforeEach(() => {
    requirePermission.mockReset();
    findFirstSession.mockReset();
    countOrgMember.mockClear();
    groupByAttendanceRecord.mockClear();
  });

  it("groups by meetingId for a meeting-backed session", async () => {
    requirePermission.mockResolvedValueOnce({ organizationId: "org-a" });
    findFirstSession.mockResolvedValueOnce({ id: "s1", organizationId: "org-a", meetingId: "meeting-1", eventId: null, status: "OPEN" });

    await GET(new Request("https://portal.test"), ctx("s1"));

    expect(groupByAttendanceRecord).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-a", meetingId: "meeting-1" } })
    );
  });

  it("groups by eventId for an event-backed session", async () => {
    requirePermission.mockResolvedValueOnce({ organizationId: "org-a" });
    findFirstSession.mockResolvedValueOnce({ id: "s2", organizationId: "org-a", meetingId: null, eventId: "event-1", status: "OPEN" });

    await GET(new Request("https://portal.test"), ctx("s2"));

    expect(groupByAttendanceRecord).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-a", eventId: "event-1" } })
    );
  });

  it("404s when the session doesn't exist in this organization", async () => {
    requirePermission.mockResolvedValueOnce({ organizationId: "org-a" });
    findFirstSession.mockResolvedValueOnce(null);

    const response = await GET(new Request("https://portal.test"), ctx("missing"));

    expect(response.status).toBe(404);
    expect(groupByAttendanceRecord).not.toHaveBeenCalled();
  });
});
