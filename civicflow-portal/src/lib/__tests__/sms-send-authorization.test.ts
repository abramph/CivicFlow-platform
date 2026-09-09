import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstOrgMember = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgMember: {
      findFirst: (...args: unknown[]) => findFirstOrgMember(...args),
    },
  },
}));

const isSmsConfigured = vi.fn();
vi.mock("@/lib/sms", () => ({ isSmsConfigured: () => isSmsConfigured() }));

const getSmsEntitlement = vi.fn();
vi.mock("@/lib/sms-entitlement", () => ({
  getSmsEntitlement: (...args: unknown[]) => getSmsEntitlement(...args),
}));

import { authorizeSmsSend } from "@/lib/sms-send-authorization";

const CONSENTED_MEMBER = { smsOptIn: true, commsSmsEnabled: true, smsOptedOutAt: null };

function baseInput(overrides: Partial<Parameters<typeof authorizeSmsSend>[0]> = {}) {
  return { organizationId: "org-a", memberId: "member-1", phone: "+15551234567", ...overrides };
}

describe("authorizeSmsSend", () => {
  beforeEach(() => {
    findFirstOrgMember.mockReset();
    isSmsConfigured.mockReset().mockReturnValue(true);
    getSmsEntitlement.mockReset().mockResolvedValue({ allowed: true, remaining: 500, limit: 1000 });
  });

  it("allows a consented, opted-in member of the organization and returns the normalized phone", async () => {
    findFirstOrgMember.mockResolvedValueOnce(CONSENTED_MEMBER);

    const result = await authorizeSmsSend(baseInput({ phone: "215-917-4391" }));

    expect(result).toEqual({ allowed: true, normalizedPhone: "+12159174391" });
  });

  it("denies when SMS is not configured, before touching entitlement or the member", async () => {
    isSmsConfigured.mockReturnValueOnce(false);

    const result = await authorizeSmsSend(baseInput());

    expect(result).toEqual({ allowed: false, reason: "SMS delivery is not configured." });
    expect(getSmsEntitlement).not.toHaveBeenCalled();
    expect(findFirstOrgMember).not.toHaveBeenCalled();
  });

  it("denies with the entitlement's own reason when the organization is not entitled (e.g. add-on revoked)", async () => {
    getSmsEntitlement.mockResolvedValueOnce({
      allowed: false,
      reason: "Your organization does not have the SMS add-on enabled.",
      remaining: 0,
      limit: 0,
    });

    const result = await authorizeSmsSend(baseInput());

    expect(result).toEqual({ allowed: false, reason: "Your organization does not have the SMS add-on enabled." });
    expect(findFirstOrgMember).not.toHaveBeenCalled();
  });

  it("denies an invalid phone number", async () => {
    const result = await authorizeSmsSend(baseInput({ phone: "not-a-phone" }));
    expect(result).toEqual({ allowed: false, reason: "Invalid phone number." });
  });

  it("scopes the member lookup to the organization (tenant isolation)", async () => {
    findFirstOrgMember.mockResolvedValueOnce(CONSENTED_MEMBER);

    await authorizeSmsSend(baseInput());

    expect(findFirstOrgMember).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "member-1", organizationId: "org-a" } })
    );
  });

  it("denies when the member no longer exists in the organization (removed or transferred)", async () => {
    findFirstOrgMember.mockResolvedValueOnce(null);

    const result = await authorizeSmsSend(baseInput());

    expect(result).toEqual({ allowed: false, reason: "Recipient is no longer a member of this organization." });
  });

  it("ALWAYS denies a null memberId — organization messages without a verifiable member never reach Twilio (initial sends and retries alike)", async () => {
    const result = await authorizeSmsSend(baseInput({ memberId: null }));

    expect(result).toEqual({ allowed: false, reason: "Recipient consent cannot be verified for this message." });
    expect(findFirstOrgMember).not.toHaveBeenCalled();
  });

  it("denies a member who has never opted in", async () => {
    findFirstOrgMember.mockResolvedValueOnce({ ...CONSENTED_MEMBER, smsOptIn: false });

    const result = await authorizeSmsSend(baseInput());

    expect(result).toEqual({ allowed: false, reason: "Member has not opted in to SMS." });
  });

  it("denies a member with a hard STOP opt-out", async () => {
    findFirstOrgMember.mockResolvedValueOnce({ ...CONSENTED_MEMBER, smsOptedOutAt: new Date() });

    const result = await authorizeSmsSend(baseInput());

    expect(result).toEqual({ allowed: false, reason: "Member opted out of SMS." });
  });

  it("required=true does NOT bypass a hard STOP opt-out", async () => {
    findFirstOrgMember.mockResolvedValueOnce({ ...CONSENTED_MEMBER, smsOptedOutAt: new Date() });

    const result = await authorizeSmsSend(baseInput({ required: true }));

    expect(result).toEqual({ allowed: false, reason: "Member opted out of SMS." });
  });

  it("required=true does NOT bypass missing opt-in consent", async () => {
    findFirstOrgMember.mockResolvedValueOnce({ ...CONSENTED_MEMBER, smsOptIn: false });

    const result = await authorizeSmsSend(baseInput({ required: true }));

    expect(result).toEqual({ allowed: false, reason: "Member has not opted in to SMS." });
  });

  it("denies when the preference toggle is off, unless required=true", async () => {
    findFirstOrgMember.mockResolvedValue({ ...CONSENTED_MEMBER, commsSmsEnabled: false });

    const blocked = await authorizeSmsSend(baseInput());
    expect(blocked).toEqual({ allowed: false, reason: "Member has SMS notifications turned off." });

    const bypassed = await authorizeSmsSend(baseInput({ required: true }));
    expect(bypassed).toEqual({ allowed: true, normalizedPhone: "+15551234567" });
  });
});
