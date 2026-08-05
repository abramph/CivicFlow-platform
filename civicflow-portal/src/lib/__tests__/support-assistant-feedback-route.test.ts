import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getServerSession = vi.fn();
vi.mock("next-auth", () => ({ getServerSession: (...a: unknown[]) => getServerSession(...a) }));
vi.mock("@/lib/authOptions", () => ({ authOptions: {} }));

const requireRateLimit = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: (...a: unknown[]) => requireRateLimit(...a) }));

const getOrganizationLabAccess = vi.fn();
vi.mock("@/lib/labs/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/labs/access")>();
  return { ...actual, getOrganizationLabAccess: (...a: unknown[]) => getOrganizationLabAccess(...a) };
});

const create = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/prisma", () => ({ prisma: { supportAssistantFeedback: { create: (...a: unknown[]) => create(...a) } } }));

function postRequest(body: Record<string, unknown>) {
  return new Request("https://portal.test/api/support-assistant/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const originalFlag = process.env.SUPPORT_ASSISTANT_PUBLIC_ENABLED;

beforeEach(() => {
  vi.clearAllMocks();
  requireRateLimit.mockResolvedValue(null);
  getServerSession.mockResolvedValue(null);
  getOrganizationLabAccess.mockResolvedValue({ available: true });
  process.env.SUPPORT_ASSISTANT_PUBLIC_ENABLED = "1";
});

afterEach(() => {
  if (originalFlag === undefined) delete process.env.SUPPORT_ASSISTANT_PUBLIC_ENABLED;
  else process.env.SUPPORT_ASSISTANT_PUBLIC_ENABLED = originalFlag;
});

describe("POST /api/support-assistant/feedback", () => {
  it("returns SUPPORT_ASSISTANT_DISABLED for an anonymous submission when the public flag is off -- feedback is gated exactly like the main endpoint", async () => {
    delete process.env.SUPPORT_ASSISTANT_PUBLIC_ENABLED;
    const { POST } = await import("@/app/api/support-assistant/feedback/route");
    const response = await POST(postRequest({ questionCategory: "general", helpful: true }));
    expect(response.status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  it("returns SUPPORT_ASSISTANT_NOT_ENABLED for an authenticated org that isn't enrolled -- feedback is gated exactly like the main endpoint", async () => {
    getServerSession.mockResolvedValue({ userId: "user-1", organizationId: "org-a", role: "STAFF", primaryVertical: "HOA" });
    getOrganizationLabAccess.mockResolvedValueOnce({ available: false });
    const { POST } = await import("@/app/api/support-assistant/feedback/route");
    const response = await POST(postRequest({ questionCategory: "general", helpful: true }));
    expect(response.status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  it("records anonymous feedback with null organizationId/userId/vertical", async () => {
    const { POST } = await import("@/app/api/support-assistant/feedback/route");
    const response = await POST(postRequest({ questionCategory: "general", helpful: true }));
    expect(response.status).toBe(200);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ mode: "public", organizationId: null, userId: null, vertical: null, helpful: true, escalated: false }),
    });
  });

  it("records authenticated feedback with the session's org/user/vertical, and derives mode server-side -- never from the request body", async () => {
    getServerSession.mockResolvedValue({ userId: "user-1", organizationId: "org-a", role: "STAFF", primaryVertical: "HOA" });
    const { POST } = await import("@/app/api/support-assistant/feedback/route");
    const response = await POST(
      postRequest({ mode: "public", questionCategory: "member-administration", helpful: false, organizationId: "org-attacker" })
    );
    expect(response.status).toBe(200);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ mode: "authenticated", organizationId: "org-a", userId: "user-1", vertical: "HOA", helpful: false }),
    });
  });

  it("sanitizes an identifier out of currentPath before storing it", async () => {
    const { POST } = await import("@/app/api/support-assistant/feedback/route");
    await POST(postRequest({ questionCategory: "member-administration", currentPath: "/members/cmse0iux6000rz11wvwm91iae", helpful: true }));
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ currentPath: "/members/[id]" }) });
  });

  it("records an escalation (Contact Support click) without requiring a helpful/not-helpful rating", async () => {
    const { POST } = await import("@/app/api/support-assistant/feedback/route");
    const response = await POST(postRequest({ questionCategory: "general", escalated: true }));
    expect(response.status).toBe(200);
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ escalated: true, helpful: null }) });
  });

  it("rejects a request missing questionCategory", async () => {
    const { POST } = await import("@/app/api/support-assistant/feedback/route");
    const response = await POST(postRequest({}));
    expect(response.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
});
