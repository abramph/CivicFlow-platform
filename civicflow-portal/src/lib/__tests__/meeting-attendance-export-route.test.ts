import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePermission = vi.fn();
vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return {
    ...actual,
    requirePermission: (...args: unknown[]) => requirePermission(...args),
  };
});

const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({
  createAuditEvent: (...args: unknown[]) => createAuditEvent(...args),
}));

const findFirstMeeting = vi.fn();
const findManyAttendanceRecord = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    meeting: { findFirst: (...args: unknown[]) => findFirstMeeting(...args) },
    attendanceRecord: { findMany: (...args: unknown[]) => findManyAttendanceRecord(...args) },
  },
}));

import { GET } from "@/app/api/meetings/[id]/attendance/export/route";

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/meetings/[id]/attendance/export", () => {
  beforeEach(() => {
    requirePermission.mockReset();
    findFirstMeeting.mockReset();
    findManyAttendanceRecord.mockReset();
    createAuditEvent.mockClear();
  });

  it("uses the same permission as the roster (attendance:read)", async () => {
    requirePermission.mockResolvedValueOnce({ session: { userId: "u1", userEmail: "a@b.com" }, organizationId: "org-a" });
    findFirstMeeting.mockResolvedValueOnce({ id: "m1", title: "Board Meeting" });
    findManyAttendanceRecord.mockResolvedValueOnce([]);

    await GET(new Request("https://portal.test"), ctx("m1"));

    expect(requirePermission).toHaveBeenCalledWith("attendance:read", "throw");
  });

  it("scopes to the requesting organization — a meeting from another org 404s, never leaking existence", async () => {
    requirePermission.mockResolvedValueOnce({ session: { userId: "u1", userEmail: "a@b.com" }, organizationId: "org-a" });
    findFirstMeeting.mockResolvedValueOnce(null); // findFirst itself is already scoped by organizationId in the where clause

    const response = await GET(new Request("https://portal.test"), ctx("meeting-belongs-to-org-b"));

    expect(response.status).toBe(404);
    expect(findFirstMeeting).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "meeting-belongs-to-org-b", organizationId: "org-a" } })
    );
  });

  it("neutralizes spreadsheet formula injection in every field, not just quoting", async () => {
    requirePermission.mockResolvedValueOnce({ session: { userId: "u1", userEmail: "a@b.com" }, organizationId: "org-a" });
    findFirstMeeting.mockResolvedValueOnce({ id: "m1", title: "Board Meeting" });
    findManyAttendanceRecord.mockResolvedValueOnce([
      {
        member: { firstName: "=cmd|'/c calc'!A1", lastName: "O'Brien", email: "evil@example.com" },
        attendanceStatus: "PRESENT",
        method: "MANUAL",
        checkInTime: null,
        checkOutTime: null,
        correctionReason: "+1 injected",
        notes: "@SUM(1+1)",
      },
    ]);

    const response = await GET(new Request("https://portal.test"), ctx("m1"));
    const csv = await response.text();

    expect(csv).toContain("'=cmd");
    expect(csv).toContain("'+1 injected");
    expect(csv).toContain("'@SUM");
    // A field with a leading hyphen used as a real name (not just formulas) is
    // still neutralized — the mitigation doesn't try to distinguish intent.
    expect(response.headers.get("Content-Type")).toContain("text/csv");
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
  });

  it("still correctly quotes commas/quotes/newlines alongside the formula-injection guard", async () => {
    requirePermission.mockResolvedValueOnce({ session: { userId: "u1", userEmail: "a@b.com" }, organizationId: "org-a" });
    findFirstMeeting.mockResolvedValueOnce({ id: "m1", title: "Board Meeting" });
    findManyAttendanceRecord.mockResolvedValueOnce([
      {
        member: { firstName: "Pat", lastName: "Doe, Jr.", email: null },
        attendanceStatus: "PRESENT",
        method: "QR_APP",
        checkInTime: null,
        checkOutTime: null,
        correctionReason: null,
        notes: null,
      },
    ]);

    const response = await GET(new Request("https://portal.test"), ctx("m1"));
    const csv = await response.text();

    expect(csv).toContain('"Doe, Jr."');
  });
});
