import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return {
    ...actual,
    requireSuperAdmin: vi.fn(async () => ({ session: { userId: "admin-1", userEmail: "admin@unestra.example" } })),
    requireAuth: vi.fn(async () => ({ userId: "target-1", userEmail: "target@example.com" })),
  };
});

const findFirstMembership = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organizationMembership: { findFirst: (...a: unknown[]) => findFirstMembership(...a) },
  },
}));

const createAuditEvent = vi.fn();
vi.mock("@/lib/audit", () => ({
  createAuditEvent: (...a: unknown[]) => createAuditEvent(...a),
}));

const cookieStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => (cookieStore.has(name) ? { value: cookieStore.get(name) } : undefined),
      set: (name: string, value: string) => cookieStore.set(name, value),
      delete: (name: string) => cookieStore.delete(name),
    }),
}));

import { POST as startImpersonation } from "@/app/api/admin/impersonate/start/route";
import { POST as stopImpersonation } from "@/app/api/admin/impersonate/stop/route";
import { IMPERSONATION_COOKIE } from "@/lib/impersonation";
import { ACTIVE_ORG_COOKIE } from "@/lib/org-context";

function jsonRequest(url: string, body: unknown) {
  return new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(() => {
  cookieStore.clear();
  findFirstMembership.mockReset();
  createAuditEvent.mockReset();
});

describe("POST /api/admin/impersonate/start", () => {
  it("refuses to start against a user who isn't an active member of that organization", async () => {
    findFirstMembership.mockResolvedValueOnce(null);

    const res = await startImpersonation(
      jsonRequest("https://portal.test/api/admin/impersonate/start", { organizationId: "org-a", targetUserId: "target-1" })
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.ok).toBe(false);
    expect(cookieStore.has(IMPERSONATION_COOKIE)).toBe(false);
    expect(createAuditEvent).not.toHaveBeenCalled();
  });

  it("sets both cookies, preserving the admin's prior active org, and writes a started audit event", async () => {
    cookieStore.set(ACTIVE_ORG_COOKIE, "admins-own-org");
    findFirstMembership.mockResolvedValueOnce({
      organization: { name: "Pine Grove School PTA", status: "active" },
      user: { email: "sarah@pinegrovepta.example", displayName: "Sarah Mitchell" },
    });

    const res = await startImpersonation(
      jsonRequest("https://portal.test/api/admin/impersonate/start", {
        organizationId: "org-a",
        targetUserId: "target-1",
        reason: "demo for prospect",
      })
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);

    const payload = JSON.parse(cookieStore.get(IMPERSONATION_COOKIE)!);
    expect(payload).toMatchObject({
      actorUserId: "admin-1",
      targetUserId: "target-1",
      organizationId: "org-a",
      reason: "demo for prospect",
      priorActiveOrgId: "admins-own-org",
    });
    expect(cookieStore.get(ACTIVE_ORG_COOKIE)).toBe("org-a");

    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-a",
        actorUserId: "admin-1",
        action: "platform.impersonation.started",
        entityType: "impersonation_session",
      })
    );
  });
});

describe("POST /api/admin/impersonate/stop", () => {
  it("is a safe no-op when nothing is being impersonated", async () => {
    const res = await stopImpersonation(new Request("https://portal.test/api/admin/impersonate/stop", { method: "POST" }));
    const data = await res.json();
    expect(data).toMatchObject({ ok: true, wasImpersonating: false });
    expect(createAuditEvent).not.toHaveBeenCalled();
  });

  it("clears the impersonation cookie, restores the admin's prior org, and writes an ended audit event attributed to the REAL admin from the cookie — not to whoever the ambient session currently resolves to", async () => {
    cookieStore.set(
      IMPERSONATION_COOKIE,
      JSON.stringify({
        actorUserId: "admin-1",
        actorEmail: "admin@unestra.example",
        targetUserId: "target-1",
        organizationId: "org-a",
        sessionId: "session-1",
        startedAt: new Date(Date.now() - 60_000).toISOString(),
        reason: "demo for prospect",
        priorActiveOrgId: "admins-own-org",
      })
    );
    cookieStore.set(ACTIVE_ORG_COOKIE, "org-a");

    const res = await stopImpersonation(new Request("https://portal.test/api/admin/impersonate/stop", { method: "POST" }));
    const data = await res.json();

    expect(data).toMatchObject({ ok: true, wasImpersonating: true });
    expect(cookieStore.has(IMPERSONATION_COOKIE)).toBe(false);
    expect(cookieStore.get(ACTIVE_ORG_COOKIE)).toBe("admins-own-org");

    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-a",
        actorUserId: "admin-1",
        // Regression guard: the ended event must attribute the real admin's
        // email from the cookie, not "unknown admin" — found live during
        // the manual OrgPulse-report reproduction, where the impersonation
        // history page rendered "unknown admin" for every ended session
        // because actorEmail was never carried through from start() to
        // stop()'s audit event.
        actorEmail: "admin@unestra.example",
        action: "platform.impersonation.ended",
        entityType: "impersonation_session",
        entityId: "session-1",
      })
    );
    const call = createAuditEvent.mock.calls[0][0];
    expect((call.metadata as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(60_000);
  });
});
