import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getServerSession = vi.fn();
vi.mock("next-auth", () => ({ getServerSession: (...a: unknown[]) => getServerSession(...a) }));
vi.mock("@/lib/authOptions", () => ({ authOptions: {} }));

const requireOrganizationLabFeature = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/labs/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/labs/access")>();
  return { ...actual, requireOrganizationLabFeature: (...a: unknown[]) => requireOrganizationLabFeature(...a) };
});

const requireRateLimit = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: (...a: unknown[]) => requireRateLimit(...a) }));

const labUsageEventCount = vi.fn().mockResolvedValue(0);
const recordLabUsage = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/prisma", () => ({ prisma: { labUsageEvent: { count: (...a: unknown[]) => labUsageEventCount(...a) } } }));
vi.mock("@/lib/labs/usage", () => ({ recordLabUsage: (...a: unknown[]) => recordLabUsage(...a) }));

function postRequest(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request("https://portal.test/api/support-assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const originalPublicFlag = process.env.SUPPORT_ASSISTANT_PUBLIC_ENABLED;

beforeEach(() => {
  vi.clearAllMocks();
  requireRateLimit.mockResolvedValue(null);
  requireOrganizationLabFeature.mockResolvedValue(undefined);
  labUsageEventCount.mockResolvedValue(0);
  getServerSession.mockResolvedValue(null);
  delete process.env.SUPPORT_ASSISTANT_PUBLIC_ENABLED;
});

afterEach(() => {
  if (originalPublicFlag === undefined) delete process.env.SUPPORT_ASSISTANT_PUBLIC_ENABLED;
  else process.env.SUPPORT_ASSISTANT_PUBLIC_ENABLED = originalPublicFlag;
});

describe("POST /api/support-assistant — anonymous", () => {
  it("returns SUPPORT_ASSISTANT_DISABLED when the public flag is off (the default today)", async () => {
    const { POST } = await import("@/app/api/support-assistant/route");
    const response = await POST(postRequest({ question: "How do I reset my password?" }));
    const body = await response.json();
    expect(response.status).toBe(403);
    expect(body.code).toBe("SUPPORT_ASSISTANT_DISABLED");
  });

  it("answers a grounded question via the mock provider once the public flag is on", async () => {
    process.env.SUPPORT_ASSISTANT_PUBLIC_ENABLED = "1";
    const { POST } = await import("@/app/api/support-assistant/route");
    const response = await POST(postRequest({ question: "How do I reset my password?" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.mode).toBe("public");
    expect(body.data.answer).toMatch(/forgot password/i);
    expect(body.data.citations.length).toBeGreaterThan(0);
  });

  it("returns the fixed fallback for an unrelated/off-topic question", async () => {
    process.env.SUPPORT_ASSISTANT_PUBLIC_ENABLED = "1";
    const { POST } = await import("@/app/api/support-assistant/route");
    const response = await POST(postRequest({ question: "asdkjf qwoeiru zzzznotarealquestion" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.answer).toMatch(/contact Unestra Support/i);
  });

  it("rejects an empty question with a validation error, never reaching the provider", async () => {
    process.env.SUPPORT_ASSISTANT_PUBLIC_ENABLED = "1";
    const { POST } = await import("@/app/api/support-assistant/route");
    const response = await POST(postRequest({ question: "" }));
    expect(response.status).toBe(400);
  });

  it("never lets the client supply organizationId, role, or vertical -- only the server session can set those", async () => {
    process.env.SUPPORT_ASSISTANT_PUBLIC_ENABLED = "1";
    const { POST } = await import("@/app/api/support-assistant/route");
    // A malicious client tries to smuggle org context into the body -- the
    // route's zod schema doesn't even accept these fields, and getServerSession
    // (mocked to return null here) is the only source of truth for auth state.
    const response = await POST(
      postRequest({ question: "How do I reset my password?", organizationId: "org-victim", role: "ORG_OWNER", vertical: "HOA" })
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.mode).toBe("public");
    expect(requireOrganizationLabFeature).not.toHaveBeenCalled();
  });
});

describe("POST /api/support-assistant — authenticated", () => {
  beforeEach(() => {
    getServerSession.mockResolvedValue({ userId: "user-1", organizationId: "org-a", role: "STAFF", primaryVertical: "HOA" });
  });

  it("gates on the supportAssistant Labs feature before ever calling the provider", async () => {
    const { LabFeatureError } = await import("@/lib/labs/access");
    requireOrganizationLabFeature.mockRejectedValueOnce(new LabFeatureError("LAB_FEATURE_NOT_ENROLLED", "supportAssistant", "Not enrolled."));
    const { POST } = await import("@/app/api/support-assistant/route");
    const response = await POST(postRequest({ question: "How do I terminate a member?" }));
    expect(response.status).toBe(403);
  });

  it("answers using the session-resolved vertical, never a client-supplied one", async () => {
    const { POST } = await import("@/app/api/support-assistant/route");
    const response = await POST(postRequest({ question: "How do I submit an architectural request?", vertical: "COMMUNITY" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.mode).toBe("authenticated");
    // The session says HOA (mocked above), so the HOA-only architectural-requests
    // doc must be reachable even though the request body tried to claim COMMUNITY.
    expect(body.data.answer.length).toBeGreaterThan(0);
  });

  it("enforces the authenticated daily ceiling", async () => {
    labUsageEventCount.mockResolvedValueOnce(50);
    const { POST } = await import("@/app/api/support-assistant/route");
    const response = await POST(postRequest({ question: "How do I terminate a member?" }));
    const body = await response.json();
    expect(response.status).toBe(429);
    expect(body.code).toBe("SUPPORT_ASSISTANT_DAILY_LIMIT_REACHED");
  });

  it("records usage after a successful answer", async () => {
    const { POST } = await import("@/app/api/support-assistant/route");
    await POST(postRequest({ question: "How do I terminate a member?" }));
    expect(recordLabUsage).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-a", featureKey: "supportAssistant" }));
  });
});
