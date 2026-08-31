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
  previewAgreementNotification.mockResolvedValue(undefined);
});

describe("POST .../periods/[periodId]/agreement-notifications/preview", () => {
  it("gates on the requirements capability -- mirrors the sibling volunteer-hours notification preview route's own documented reasoning (preview must work before the notifications flag is ever turned on)", async () => {
    const { POST } = await import("../route");
    await POST(postRequest({ notificationType: "AGREEMENT_AVAILABLE", testRecipientEmail: "test@example.test" }), { params });
    expect(requireVolunteerHoursAccess).toHaveBeenCalledWith("pta:volunteer-requirements:manage", "requirements");
  });

  it("calls previewAgreementNotification with the guard-resolved organizationId/actor, never anything client-supplied for those", async () => {
    const { POST } = await import("../route");
    await POST(postRequest({ notificationType: "CONTRACT_OFFER_EXPIRING", testRecipientEmail: "test@example.test" }), { params });
    expect(previewAgreementNotification).toHaveBeenCalledWith("org-1", "period-1", "CONTRACT_OFFER_EXPIRING", "test@example.test", {
      userId: "u1",
      userEmail: "officer@example.test",
    });
  });

  it("requires an explicit, valid test-recipient email -- never silently defaults to a household or any address the caller didn't supply", async () => {
    const { POST } = await import("../route");
    const res = await POST(postRequest({ notificationType: "AGREEMENT_AVAILABLE" }), { params });
    expect(res.status).not.toBe(200);
    expect(previewAgreementNotification).not.toHaveBeenCalled();

    const res2 = await POST(postRequest({ notificationType: "AGREEMENT_AVAILABLE", testRecipientEmail: "not-an-email" }), { params });
    expect(res2.status).not.toBe(200);
    expect(previewAgreementNotification).not.toHaveBeenCalled();
  });

  it("rejects an unrecognized notificationType", async () => {
    const { POST } = await import("../route");
    const res = await POST(postRequest({ notificationType: "SOMETHING_ELSE", testRecipientEmail: "test@example.test" }), { params });
    expect(res.status).not.toBe(200);
    expect(previewAgreementNotification).not.toHaveBeenCalled();
  });

  it("rejects a body with an unrecognized extra field (strict schema) -- e.g. an attempt to smuggle a real householdId through", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      postRequest({ notificationType: "AGREEMENT_AVAILABLE", testRecipientEmail: "test@example.test", householdId: "someone-elses-household" }),
      { params }
    );
    expect(res.status).not.toBe(200);
    expect(previewAgreementNotification).not.toHaveBeenCalled();
  });

  it("propagates a guard rejection (capability disabled) without ever sending anything", async () => {
    const { PtaError } = await import("@/lib/labs/pta/errors");
    requireVolunteerHoursAccess.mockRejectedValue(new PtaError("PTA_VOLUNTEER_REQUIREMENTS_DISABLED", "off"));
    const { POST } = await import("../route");
    const res = await POST(postRequest({ notificationType: "AGREEMENT_AVAILABLE", testRecipientEmail: "test@example.test" }), { params });
    expect(res.status).not.toBe(200);
    expect(previewAgreementNotification).not.toHaveBeenCalled();
  });
});
