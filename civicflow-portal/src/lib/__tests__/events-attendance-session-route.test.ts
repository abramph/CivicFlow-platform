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

const findFirstEvent = vi.fn();
const findFirstSession = vi.fn();
const createSession = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    event: { findFirst: (...args: unknown[]) => findFirstEvent(...args) },
    meetingAttendanceSession: {
      findFirst: (...args: unknown[]) => findFirstSession(...args),
      create: (...args: unknown[]) => createSession(...args),
    },
  },
}));

import { GET, POST } from "@/app/api/events/[id]/attendance-session/route";

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}
function postReq(body: unknown = { mode: "ROTATING_QR" }) {
  return new Request("https://portal.test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

const authed = { session: { userId: "u1", userEmail: "a@org-a.com" }, organizationId: "org-a" };

describe("POST/GET /api/events/[id]/attendance-session", () => {
  beforeEach(() => {
    requirePermission.mockReset();
    findFirstEvent.mockReset();
    findFirstSession.mockReset();
    createSession.mockReset();
    createAuditEvent.mockClear();
  });

  it("404s when the event doesn't exist in this organization", async () => {
    requirePermission.mockResolvedValueOnce(authed);
    findFirstEvent.mockResolvedValueOnce(null);

    const response = await POST(postReq(), ctx("event-1"));

    expect(response.status).toBe(404);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("refuses to create a session when the event has no scheduled startAt", async () => {
    requirePermission.mockResolvedValueOnce(authed);
    findFirstEvent.mockResolvedValueOnce({ id: "event-1", organizationId: "org-a", startAt: null });

    const response = await POST(postReq(), ctx("event-1"));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toMatch(/scheduled start time/i);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("creates a new session keyed by eventId (not meetingId) when the event is eligible", async () => {
    requirePermission.mockResolvedValueOnce(authed);
    findFirstEvent.mockResolvedValueOnce({ id: "event-1", organizationId: "org-a", startAt: new Date("2026-08-01T18:00:00.000Z") });
    findFirstSession.mockResolvedValueOnce(null);
    createSession.mockResolvedValueOnce({ id: "session-1", organizationId: "org-a", eventId: "event-1", meetingId: null, status: "DRAFT", mode: "ROTATING_QR" });

    const response = await POST(postReq(), ctx("event-1"));
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.data.eventId).toBe("event-1");
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventId: "event-1", organizationId: "org-a" }) })
    );
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ metadata: { eventId: "event-1", mode: "ROTATING_QR" } }));
  });

  it("returns an existing DRAFT/OPEN session instead of creating a second one", async () => {
    requirePermission.mockResolvedValueOnce(authed);
    findFirstEvent.mockResolvedValueOnce({ id: "event-1", organizationId: "org-a", startAt: new Date("2026-08-01T18:00:00.000Z") });
    findFirstSession.mockResolvedValueOnce({ id: "existing-session", organizationId: "org-a", eventId: "event-1", status: "OPEN" });

    const response = await POST(postReq(), ctx("event-1"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data.id).toBe("existing-session");
    expect(createSession).not.toHaveBeenCalled();
  });

  it("GET scopes the lookup by eventId, not meetingId", async () => {
    requirePermission.mockResolvedValueOnce({ organizationId: "org-a" });
    findFirstSession.mockResolvedValueOnce({ id: "s1", eventId: "event-1" });

    await GET(new Request("https://portal.test"), ctx("event-1"));

    expect(findFirstSession).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-a", eventId: "event-1" } })
    );
  });
});
