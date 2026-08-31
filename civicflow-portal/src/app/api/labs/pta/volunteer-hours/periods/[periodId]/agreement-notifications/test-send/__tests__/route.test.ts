import { beforeEach, describe, expect, it, vi } from "vitest";

const requireVolunteerHoursAccess = vi.fn();
vi.mock("@/lib/labs/pta/volunteer-hours/guard", () => ({
  requireVolunteerHoursAccess: (...a: unknown[]) => requireVolunteerHoursAccess(...a),
}));

const sendTestAgreementNotification = vi.fn();
vi.mock("@/lib/labs/pta/volunteer-hours/agreements", () => ({
  sendTestAgreementNotification: (...a: unknown[]) => sendTestAgreementNotification(...a),
}));

const requireRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: (...a: unknown[]) => requireRateLimit(...a) }));

const params = Promise.resolve({ periodId: "period-1" });

function postRequest(body: unknown) {
  return new Request("https://x.test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireRateLimit.mockResolvedValue(null);
  requireVolunteerHoursAccess.mockResolvedValue({ organizationId: "org-1", session: { userId: "u1", userEmail: "officer@example.test" } });
  sendTestAgreementNotification.mockResolvedValue(undefined);
});

const VALID_BODY = { notificationType: "AGREEMENT_AVAILABLE", testRecipientEmail: "officer-test@example.test", confirmText: "SEND TEST" };

describe("POST .../periods/[periodId]/agreement-notifications/test-send", () => {
  it("is rate-limited BEFORE the guard/permission check runs", async () => {
    const { POST } = await import("../route");
    await POST(postRequest(VALID_BODY), { params });
    expect(requireRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "api:labs:pta:volunteer-hours:agreement-notifications:test-send", limit: 5, windowMs: 60_000 })
    );
  });

  it("short-circuits with the 429 response when rate-limited, never reaching the guard or a real send", async () => {
    const limited = Response.json({ ok: false, error: "Rate limit exceeded. Please retry later." }, { status: 429 });
    requireRateLimit.mockResolvedValueOnce(limited);
    const { POST } = await import("../route");
    const res = await POST(postRequest(VALID_BODY), { params });
    expect(res.status).toBe(429);
    expect(requireVolunteerHoursAccess).not.toHaveBeenCalled();
    expect(sendTestAgreementNotification).not.toHaveBeenCalled();
  });

  it("gates on the notifications capability and a dedicated notifications-manage permission -- NOT the requirements-manage permission preview uses", async () => {
    const { POST } = await import("../route");
    await POST(postRequest(VALID_BODY), { params });
    expect(requireVolunteerHoursAccess).toHaveBeenCalledWith("pta:volunteer-notifications:manage", "notifications");
  });

  it("with the org's notifications capability disabled, the guard rejection is propagated and no send is attempted -- fails closed even if requirements is on", async () => {
    const { PtaError } = await import("@/lib/labs/pta/errors");
    requireVolunteerHoursAccess.mockRejectedValue(new PtaError("PTA_VOLUNTEER_NOTIFICATIONS_DISABLED", "off"));
    const { POST } = await import("../route");
    const res = await POST(postRequest(VALID_BODY), { params });
    expect(res.status).not.toBe(200);
    expect(sendTestAgreementNotification).not.toHaveBeenCalled();
  });

  it("requires the exact typed confirmation phrase (case-insensitive, trimmed) before sending", async () => {
    const { POST } = await import("../route");

    const wrong = await POST(postRequest({ ...VALID_BODY, confirmText: "yes" }), { params });
    expect(wrong.status).not.toBe(200);
    expect(sendTestAgreementNotification).not.toHaveBeenCalled();

    const ok = await POST(postRequest({ ...VALID_BODY, confirmText: "  send test  " }), { params });
    expect(ok.status).toBe(200);
    expect(sendTestAgreementNotification).toHaveBeenCalledTimes(1);
  });

  it("calls sendTestAgreementNotification with the guard-resolved organizationId/actor and exactly the caller-supplied recipient -- never a household lookup", async () => {
    const { POST } = await import("../route");
    await POST(postRequest(VALID_BODY), { params });
    expect(sendTestAgreementNotification).toHaveBeenCalledWith("org-1", "period-1", "AGREEMENT_AVAILABLE", "officer-test@example.test", {
      userId: "u1",
      userEmail: "officer@example.test",
    });
  });

  it("requires an explicit, valid test-recipient email", async () => {
    const { POST } = await import("../route");
    const res = await POST(postRequest({ notificationType: "AGREEMENT_AVAILABLE", confirmText: "SEND TEST" }), { params });
    expect(res.status).not.toBe(200);
    expect(sendTestAgreementNotification).not.toHaveBeenCalled();

    const res2 = await POST(postRequest({ ...VALID_BODY, testRecipientEmail: "not-an-email" }), { params });
    expect(res2.status).not.toBe(200);
    expect(sendTestAgreementNotification).not.toHaveBeenCalled();
  });

  it("rejects an unrecognized notificationType", async () => {
    const { POST } = await import("../route");
    const res = await POST(postRequest({ ...VALID_BODY, notificationType: "SOMETHING_ELSE" }), { params });
    expect(res.status).not.toBe(200);
    expect(sendTestAgreementNotification).not.toHaveBeenCalled();
  });

  it("rejects a body with an unrecognized extra field (strict schema) -- e.g. an attempt to smuggle a real householdId through", async () => {
    const { POST } = await import("../route");
    const res = await POST(postRequest({ ...VALID_BODY, householdId: "someone-elses-household" }), { params });
    expect(res.status).not.toBe(200);
    expect(sendTestAgreementNotification).not.toHaveBeenCalled();
  });

  it("propagates a send failure as a real error response rather than a false ok", async () => {
    sendTestAgreementNotification.mockRejectedValueOnce(new Error("SMTP provider unavailable"));
    const { POST } = await import("../route");
    const res = await POST(postRequest(VALID_BODY), { params });
    expect(res.status).not.toBe(200);
  });
});
