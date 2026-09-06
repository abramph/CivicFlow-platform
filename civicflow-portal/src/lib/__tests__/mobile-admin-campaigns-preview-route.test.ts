import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Build 27 — mobile recipient-count preview. Load-bearing properties: the
 * same manageCommunications gate as every campaign route, the same
 * resolveCommunicationRecipients() resolver the real create uses (so the
 * count can never drift from reality), and nothing persisted.
 */

const requireMobileAuth = vi.fn();
vi.mock("@/lib/mobile-auth", () => ({
  requireMobileAuth: (...args: unknown[]) => requireMobileAuth(...args),
  MobileAuthError: class MobileAuthError extends Error {
    status = 401;
  },
  MobileForbiddenError: class MobileForbiddenError extends Error {
    status = 403;
  },
}));

const requireMobileAdminAccess = vi.fn();
vi.mock("@/lib/mobile-admin", () => ({
  requireMobileAdminAccess: (...args: unknown[]) => requireMobileAdminAccess(...args),
}));

const resolveCommunicationRecipients = vi.fn();
vi.mock("@/lib/communication-campaigns", () => ({
  resolveCommunicationRecipients: (...a: unknown[]) => resolveCommunicationRecipients(...a),
}));

vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

import { POST } from "@/app/api/mobile/admin/campaigns/preview-recipients/route";

function request(body: Record<string, unknown>) {
  return new Request("https://portal.test/api/mobile/admin/campaigns/preview-recipients", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileAuth.mockResolvedValue({ userId: "user-1", email: "officer@example.com" });
  requireMobileAdminAccess.mockResolvedValue({ available: true, role: "STAFF", adminCapabilities: ["manageCommunications"] });
  resolveCommunicationRecipients.mockResolvedValue([{ id: "m1" }, { id: "m2" }, { id: "m3" }]);
});

describe("POST /api/mobile/admin/campaigns/preview-recipients", () => {
  it("returns the count from the same resolver the real create uses", async () => {
    const res = await POST(request({ organizationId: "org-a", recipientFilter: { selector: "pta_target", ptaRule: { type: "all" } }, channel: "EMAIL" }));
    const body = await res.json();

    expect(body).toEqual({ ok: true, data: { count: 3 } });
    expect(resolveCommunicationRecipients).toHaveBeenCalledWith("org-a", { selector: "pta_target", ptaRule: { type: "all" } }, "EMAIL");
  });

  it("403s without manageCommunications and never resolves anything", async () => {
    requireMobileAdminAccess.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageEvents"] });
    const res = await POST(request({ organizationId: "org-a", recipientFilter: { selector: "active_with_email" }, channel: "EMAIL" }));

    expect(res.status).toBe(403);
    expect(resolveCommunicationRecipients).not.toHaveBeenCalled();
  });

  it("resolves capability for the organization the request names — no cross-org preview", async () => {
    await POST(request({ organizationId: "org-victim", recipientFilter: { selector: "active_with_email" }, channel: "EMAIL" }));
    expect(requireMobileAdminAccess).toHaveBeenCalledWith("org-victim", "user-1");
  });
});
