import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const getServerSession = vi.fn();
vi.mock("next-auth", () => ({ getServerSession: (...a: unknown[]) => getServerSession(...a) }));
vi.mock("@/lib/authOptions", () => ({ authOptions: {} }));

const getOrganizationLabAccess = vi.fn();
vi.mock("@/lib/labs/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/labs/access")>();
  return { ...actual, getOrganizationLabAccess: (...a: unknown[]) => getOrganizationLabAccess(...a) };
});

const originalFlag = process.env.SUPPORT_ASSISTANT_PUBLIC_ENABLED;

beforeEach(() => {
  vi.clearAllMocks();
  getServerSession.mockResolvedValue(null);
  delete process.env.SUPPORT_ASSISTANT_PUBLIC_ENABLED;
});

afterAll(() => {
  if (originalFlag === undefined) delete process.env.SUPPORT_ASSISTANT_PUBLIC_ENABLED;
  else process.env.SUPPORT_ASSISTANT_PUBLIC_ENABLED = originalFlag;
});

describe("GET /api/support-assistant/availability", () => {
  it("is unavailable for an anonymous visitor when the public flag is off", async () => {
    const { GET } = await import("@/app/api/support-assistant/availability/route");
    const response = await GET();
    const body = await response.json();
    expect(body.data).toEqual({ available: false, mode: "public" });
  });

  it("is available for an anonymous visitor when the public flag is on", async () => {
    process.env.SUPPORT_ASSISTANT_PUBLIC_ENABLED = "1";
    const { GET } = await import("@/app/api/support-assistant/availability/route");
    const response = await GET();
    const body = await response.json();
    expect(body.data).toEqual({ available: true, mode: "public" });
  });

  it("reflects the org's real Labs enrollment state for an authenticated user, not just 'logged in'", async () => {
    getServerSession.mockResolvedValue({ userId: "user-1", organizationId: "org-a", role: "STAFF" });
    getOrganizationLabAccess.mockResolvedValueOnce({ available: false });
    const { GET } = await import("@/app/api/support-assistant/availability/route");
    const response = await GET();
    const body = await response.json();
    expect(body.data).toEqual({ available: false, mode: "authenticated" });
    expect(getOrganizationLabAccess).toHaveBeenCalledWith("org-a", "supportAssistant");
  });

  it("is available for an authenticated, enrolled organization", async () => {
    getServerSession.mockResolvedValue({ userId: "user-1", organizationId: "org-a", role: "STAFF" });
    getOrganizationLabAccess.mockResolvedValueOnce({ available: true });
    const { GET } = await import("@/app/api/support-assistant/availability/route");
    const response = await GET();
    const body = await response.json();
    expect(body.data).toEqual({ available: true, mode: "authenticated" });
  });

  it("treats a session with an org but no role as unauthenticated -- must match POST /api/support-assistant's isAuthenticated check exactly (independent review regression)", async () => {
    getServerSession.mockResolvedValue({ userId: "user-1", organizationId: "org-a" });
    const { GET } = await import("@/app/api/support-assistant/availability/route");
    const response = await GET();
    const body = await response.json();
    expect(body.data.mode).toBe("public");
    expect(getOrganizationLabAccess).not.toHaveBeenCalled();
  });
});
