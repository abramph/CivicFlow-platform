import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return {
    ...actual,
    requirePermission: vi.fn().mockResolvedValue({
      session: { userId: "staff-1", userEmail: "staff@org-a.example.com" },
      organizationId: "org-a",
      role: "ORG_ADMIN",
    }),
  };
});

const findManyEvent = vi.fn();
const findFirstEvent = vi.fn();
const createEvent = vi.fn();
const updateEvent = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    event: {
      findMany: (...args: unknown[]) => findManyEvent(...args),
      findFirst: (...args: unknown[]) => findFirstEvent(...args),
      create: (...args: unknown[]) => createEvent(...args),
      update: (...args: unknown[]) => updateEvent(...args),
    },
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

import { GET, POST } from "@/app/api/events/route";
import { PATCH } from "@/app/api/events/[id]/route";

function postRequest(body: Record<string, unknown>) {
  return new Request("https://portal.test/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patchRequest(body: Record<string, unknown>) {
  return new Request("https://portal.test/api/events/event-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/events", () => {
  beforeEach(() => {
    findManyEvent.mockReset();
    createEvent.mockReset();
  });

  it("rejects an invalid/free-text status instead of silently accepting a typo", async () => {
    const response = await POST(postRequest({ title: "Fall Fun Run", status: "Cancelled-ish" }));
    expect(response.status).toBe(400);
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("creates an event with a valid canonical status", async () => {
    createEvent.mockResolvedValueOnce({ id: "event-1", title: "Fall Fun Run", status: "upcoming" });

    const response = await POST(postRequest({ title: "Fall Fun Run", status: "upcoming" }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ organizationId: "org-a", status: "upcoming" }) })
    );
  });

  it("rejects an end time before the start time", async () => {
    const response = await POST(
      postRequest({
        title: "Bad Event",
        status: "upcoming",
        startAt: "2026-08-01T18:00:00.000Z",
        endAt: "2026-08-01T17:00:00.000Z",
      })
    );
    expect(response.status).toBe(400);
    expect(createEvent).not.toHaveBeenCalled();
  });
});

describe("GET /api/events", () => {
  it("scopes the query to the caller's organization", async () => {
    findManyEvent.mockResolvedValueOnce([]);
    await GET();
    expect(findManyEvent).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "org-a" } }));
  });
});

describe("PATCH /api/events/[id]", () => {
  beforeEach(() => {
    findFirstEvent.mockReset();
    updateEvent.mockReset();
  });

  it("rejects an invalid status value (the original typo-tolerant free-text bug)", async () => {
    findFirstEvent.mockResolvedValueOnce({ id: "event-1", organizationId: "org-a", status: "upcoming", startAt: null, endAt: null });

    const response = await PATCH(patchRequest({ status: "Canceled" }), { params: Promise.resolve({ id: "event-1" }) });

    expect(response.status).toBe(400);
    expect(updateEvent).not.toHaveBeenCalled();
  });

  it("applies a valid cancellation status update", async () => {
    findFirstEvent.mockResolvedValueOnce({
      id: "event-1",
      organizationId: "org-a",
      title: "Fall Fun Run",
      status: "upcoming",
      location: null,
      startAt: null,
      endAt: null,
    });
    updateEvent.mockResolvedValueOnce({ id: "event-1", status: "cancelled" });

    const response = await PATCH(patchRequest({ status: "cancelled" }), { params: Promise.resolve({ id: "event-1" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(updateEvent).toHaveBeenCalledWith({
      where: { id: "event-1" },
      data: expect.objectContaining({ status: "cancelled" }),
    });
  });

  it("404s when the event doesn't belong to the caller's organization", async () => {
    findFirstEvent.mockResolvedValueOnce(null);

    const response = await PATCH(patchRequest({ status: "cancelled" }), { params: Promise.resolve({ id: "event-1" }) });

    expect(response.status).toBe(404);
    expect(updateEvent).not.toHaveBeenCalled();
  });
});
