import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePermission = vi.fn();
const requireRole = vi.fn();
vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return {
    ...actual,
    requirePermission: (...args: unknown[]) => requirePermission(...args),
    requireRole: (...args: unknown[]) => requireRole(...args),
  };
});

const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({
  createAuditEvent: (...args: unknown[]) => createAuditEvent(...args),
}));

const findFirstSession = vi.fn();
const updateSession = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    meetingAttendanceSession: {
      findFirst: (...args: unknown[]) => findFirstSession(...args),
      update: (...args: unknown[]) => updateSession(...args),
    },
  },
}));

import { POST as openPOST } from "@/app/api/attendance-sessions/[id]/open/route";
import { POST as closePOST } from "@/app/api/attendance-sessions/[id]/close/route";
import { POST as reopenPOST } from "@/app/api/attendance-sessions/[id]/reopen/route";
import { POST as regeneratePOST } from "@/app/api/attendance-sessions/[id]/regenerate/route";

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}
function req() {
  return new Request("https://portal.test", { method: "POST" });
}

const authedAsOrgA = { session: { userId: "u1", userEmail: "a@org-a.com" }, organizationId: "org-a" };

describe("Attendance session admin routes — tenant isolation", () => {
  beforeEach(() => {
    requirePermission.mockReset();
    requireRole.mockReset();
    findFirstSession.mockReset();
    updateSession.mockReset();
    createAuditEvent.mockClear();
  });

  it("open: a session belonging to another organization 404s rather than opening it", async () => {
    requirePermission.mockResolvedValueOnce(authedAsOrgA);
    // findFirst is scoped by organizationId in its where clause — a session
    // that exists but belongs to org-b is correctly invisible to org-a.
    findFirstSession.mockResolvedValueOnce(null);

    const response = await openPOST(req(), ctx("session-owned-by-org-b"));

    expect(response.status).toBe(404);
    expect(findFirstSession).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "session-owned-by-org-b", organizationId: "org-a" } })
    );
    expect(updateSession).not.toHaveBeenCalled();
  });

  it("close: same tenant-scoped lookup, same 404 rather than leaking existence", async () => {
    requirePermission.mockResolvedValueOnce(authedAsOrgA);
    findFirstSession.mockResolvedValueOnce(null);

    const response = await closePOST(req(), ctx("session-owned-by-org-b"));

    expect(response.status).toBe(404);
    expect(updateSession).not.toHaveBeenCalled();
  });

  it("regenerate: same tenant-scoped lookup, same 404", async () => {
    requirePermission.mockResolvedValueOnce(authedAsOrgA);
    findFirstSession.mockResolvedValueOnce(null);

    const response = await regeneratePOST(req(), ctx("session-owned-by-org-b"));

    expect(response.status).toBe(404);
    expect(updateSession).not.toHaveBeenCalled();
  });

  it("reopen: requires an elevated role (ORG_ADMIN+), not just attendance:write", async () => {
    requireRole.mockResolvedValueOnce(authedAsOrgA);
    findFirstSession.mockResolvedValueOnce({ id: "s1", organizationId: "org-a", meetingId: "m1", status: "CLOSED" });
    updateSession.mockResolvedValueOnce({ id: "s1", status: "OPEN" });

    await reopenPOST(req(), ctx("s1"));

    expect(requireRole).toHaveBeenCalledWith("ORG_ADMIN", "throw");
  });

  it("reopen: still tenant-scoped even for the elevated-role path", async () => {
    requireRole.mockResolvedValueOnce(authedAsOrgA);
    findFirstSession.mockResolvedValueOnce(null);

    const response = await reopenPOST(req(), ctx("session-owned-by-org-b"));

    expect(response.status).toBe(404);
    expect(updateSession).not.toHaveBeenCalled();
  });

  it("open: succeeds and audits when the session really does belong to the caller's org", async () => {
    requirePermission.mockResolvedValueOnce(authedAsOrgA);
    findFirstSession.mockResolvedValueOnce({ id: "s1", organizationId: "org-a", meetingId: "m1", status: "DRAFT" });
    updateSession.mockResolvedValueOnce({ id: "s1", organizationId: "org-a", status: "OPEN" });

    const response = await openPOST(req(), ctx("s1"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data.status).toBe("OPEN");
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-a", action: "open" }));
  });
});
