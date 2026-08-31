import { beforeEach, describe, expect, it, vi } from "vitest";

const requireVolunteerHoursAccess = vi.fn();
vi.mock("@/lib/labs/pta/volunteer-hours/guard", () => ({
  requireVolunteerHoursAccess: (...a: unknown[]) => requireVolunteerHoursAccess(...a),
}));

const previewAgreementNotification = vi.fn();
vi.mock("@/lib/labs/pta/volunteer-hours/agreements", () => ({
  previewAgreementNotification: (...a: unknown[]) => previewAgreementNotification(...a),
}));

const params = Promise.resolve({ periodId: "period-1" });

function postRequest(body: unknown) {
  return new Request("https://x.test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireVolunteerHoursAccess.mockResolvedValue({ organizationId: "org-1", session: { userId: "u1", userEmail: "officer@example.test" } });
  previewAgreementNotification.mockResolvedValue({ subject: "rendered subject", text: "rendered text" });
});

describe("POST .../periods/[periodId]/agreement-notifications/preview", () => {
  it("gates on the requirements capability -- an admin must be able to preview what a template says before ever deciding to enable notifications", async () => {
    const { POST } = await import("../route");
    await POST(postRequest({ notificationType: "AGREEMENT_AVAILABLE" }), { params });
    expect(requireVolunteerHoursAccess).toHaveBeenCalledWith("pta:volunteer-requirements:manage", "requirements");
  });

  it("calls previewAgreementNotification with the guard-resolved organizationId/actor and returns the rendered content -- no recipient is ever accepted or forwarded here", async () => {
    const { POST } = await import("../route");
    const res = await POST(postRequest({ notificationType: "CONTRACT_OFFER_EXPIRING" }), { params });
    expect(previewAgreementNotification).toHaveBeenCalledWith("org-1", "period-1", "CONTRACT_OFFER_EXPIRING", {
      userId: "u1",
      userEmail: "officer@example.test",
    });
    const body = await res.json();
    expect(body).toEqual({ ok: true, preview: { subject: "rendered subject", text: "rendered text" } });
  });

  it("rejects an unrecognized notificationType", async () => {
    const { POST } = await import("../route");
    const res = await POST(postRequest({ notificationType: "SOMETHING_ELSE" }), { params });
    expect(res.status).not.toBe(200);
    expect(previewAgreementNotification).not.toHaveBeenCalled();
  });

  it("rejects a body with an unrecognized extra field (strict schema) -- e.g. an attempt to smuggle a real recipient/householdId through a preview call", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      postRequest({ notificationType: "AGREEMENT_AVAILABLE", testRecipientEmail: "attacker@example.test" }),
      { params }
    );
    expect(res.status).not.toBe(200);
    expect(previewAgreementNotification).not.toHaveBeenCalled();
  });

  it("propagates a guard rejection (capability disabled) without ever previewing anything", async () => {
    const { PtaError } = await import("@/lib/labs/pta/errors");
    requireVolunteerHoursAccess.mockRejectedValue(new PtaError("PTA_VOLUNTEER_REQUIREMENTS_DISABLED", "off"));
    const { POST } = await import("../route");
    const res = await POST(postRequest({ notificationType: "AGREEMENT_AVAILABLE" }), { params });
    expect(res.status).not.toBe(200);
    expect(previewAgreementNotification).not.toHaveBeenCalled();
  });
});
