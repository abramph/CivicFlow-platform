import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstCampaign = vi.fn();
const findManyCampaign = vi.fn().mockResolvedValue([]);
const updateCampaign = vi.fn().mockResolvedValue(undefined);
const updateManyCampaign = vi.fn().mockResolvedValue({ count: 1 });
const findManyRecipient = vi.fn().mockResolvedValue([]);
const countRecipient = vi.fn().mockResolvedValue(0);
const updateRecipient = vi.fn().mockResolvedValue(undefined);
const findUniqueOrganization = vi.fn().mockResolvedValue({
  name: "ThrivePath Foundation",
  plan: "essential",
  trialEndsAt: null,
  billingExempt: false,
  seatLimit: null,
});
const findManyAttachment = vi.fn().mockResolvedValue([]);
const findManyDeviceToken = vi.fn().mockResolvedValue([]);
const createCommunicationLog = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    communicationCampaign: {
      findFirst: (...args: unknown[]) => findFirstCampaign(...args),
      findMany: (...args: unknown[]) => findManyCampaign(...args),
      update: (...args: unknown[]) => updateCampaign(...args),
      updateMany: (...args: unknown[]) => updateManyCampaign(...args),
    },
    communicationRecipient: {
      findMany: (...args: unknown[]) => findManyRecipient(...args),
      count: (...args: unknown[]) => countRecipient(...args),
      update: (...args: unknown[]) => updateRecipient(...args),
    },
    organization: {
      findUnique: (...args: unknown[]) => findUniqueOrganization(...args),
    },
    attachment: {
      findMany: (...args: unknown[]) => findManyAttachment(...args),
    },
    mobileDeviceToken: {
      findMany: (...args: unknown[]) => findManyDeviceToken(...args),
    },
    communicationLog: {
      create: (...args: unknown[]) => createCommunicationLog(...args),
    },
  },
}));

const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

// This suite tests campaign send/scheduling logic, not the subscription
// gate — defaults to "allowed", overridden per-test for the LAUNCH-BLOCKER
// billing-gate cases below.
const resolveOrganizationAccess = vi.fn();
vi.mock("@/lib/subscription-gate", () => ({
  resolveOrganizationAccess: (...args: unknown[]) => resolveOrganizationAccess(...args),
}));
const ALLOWED_ACCESS = { allowed: true, reason: null, trialEndsAt: null, subscriptionStatus: null, billingExempt: false } as const;

vi.mock("@/lib/member-timeline", () => ({ createMemberTimelineEvent: vi.fn().mockResolvedValue(undefined) }));

const sendEmail = vi.fn().mockResolvedValue({ sent: true, skipped: false });
vi.mock("@/lib/mail", () => ({ sendEmail: (...args: unknown[]) => sendEmail(...args) }));

const sendPushToTokens = vi.fn().mockResolvedValue({ sent: 0, failed: 0 });
vi.mock("@/lib/push", () => ({ sendPushToTokens: (...args: unknown[]) => sendPushToTokens(...args) }));

const sendMemberSms = vi.fn().mockResolvedValue({ status: "SENT" });
vi.mock("@/lib/sms-service", () => ({
  sendMemberSms: (...args: unknown[]) => sendMemberSms(...args),
  applySmsTemplateTokens: (body: string) => body,
}));

vi.mock("@/lib/storage", () => ({ getSignedObjectUrl: vi.fn().mockResolvedValue("https://signed.example/file") }));
vi.mock("@/lib/env", () => ({ getMobileAppWebBaseUrl: () => "https://app.getunestra.com" }));

const resolvePtaHouseholdAdultUserIdsBatch = vi.fn().mockResolvedValue(new Map());
vi.mock("@/lib/labs/pta/households", () => ({
  resolvePtaHouseholdAdultUserIdsBatch: (...args: unknown[]) => resolvePtaHouseholdAdultUserIdsBatch(...args),
}));

import { processScheduledCampaigns, sendCommunicationCampaign } from "@/lib/communication-campaigns";

function makeCampaign(overrides: Record<string, unknown> = {}) {
  return {
    id: "campaign-1",
    organizationId: "org-a",
    title: "Announcement",
    subject: "Subject",
    body: "Body",
    channel: "EMAIL",
    status: "READY",
    pushEnabled: false,
    deepLink: null,
    ...overrides,
  };
}

function makeRecipient(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    campaignId: "campaign-1",
    memberId: `member-${id}`,
    email: `${id}@example.com`,
    phone: null,
    member: null,
    ...overrides,
  };
}

describe("sendCommunicationCampaign", () => {
  beforeEach(() => {
    findFirstCampaign.mockReset();
    findManyCampaign.mockClear();
    updateCampaign.mockClear();
    updateManyCampaign.mockClear();
    updateManyCampaign.mockResolvedValue({ count: 1 });
    findManyRecipient.mockReset();
    countRecipient.mockReset();
    countRecipient.mockResolvedValue(0);
    updateRecipient.mockClear();
    findManyAttachment.mockClear();
    findManyAttachment.mockResolvedValue([]);
    findManyDeviceToken.mockClear();
    findManyDeviceToken.mockResolvedValue([]);
    createCommunicationLog.mockClear();
    createAuditEvent.mockClear();
    sendEmail.mockClear();
    sendEmail.mockResolvedValue({ sent: true, skipped: false });
    sendMemberSms.mockClear();
    sendPushToTokens.mockClear();
    resolvePtaHouseholdAdultUserIdsBatch.mockClear();
    resolvePtaHouseholdAdultUserIdsBatch.mockResolvedValue(new Map());
    resolveOrganizationAccess.mockReset();
    resolveOrganizationAccess.mockResolvedValue(ALLOWED_ACCESS);
  });

  it("LAUNCH-BLOCKER: marks a billing-inactive organization's campaign FAILED immediately, with an audit event, instead of sending or leaving it retryable forever", async () => {
    resolveOrganizationAccess.mockResolvedValueOnce({
      allowed: false,
      reason: "TRIAL_EXPIRED",
      trialEndsAt: null,
      subscriptionStatus: null,
      billingExempt: false,
    });
    findFirstCampaign.mockResolvedValueOnce(makeCampaign({ status: "READY" }));

    await expect(sendCommunicationCampaign({ organizationId: "org-a", campaignId: "campaign-1" })).rejects.toThrow(
      "This organization's Unestra subscription is not active."
    );

    expect(updateCampaign).toHaveBeenCalledWith({ where: { id: "campaign-1" }, data: { status: "FAILED" } });
    // Exactly one audit event for the failure — no duplicate, no
    // additional "attempted" or "succeeded" event alongside it.
    expect(createAuditEvent).toHaveBeenCalledTimes(1);
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "communication_campaign.blocked",
        entityId: "campaign-1",
        metadata: expect.objectContaining({ reason: "organization_subscription_required", accessReason: "TRIAL_EXPIRED" }),
      })
    );
    expect(findManyRecipient).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("E2E-6: does not retry a FAILED campaign indefinitely — a second call short-circuits before ever re-checking billing", async () => {
    findFirstCampaign.mockResolvedValueOnce(makeCampaign({ status: "FAILED" }));

    const result = await sendCommunicationCampaign({ organizationId: "org-a", campaignId: "campaign-1" });

    expect(result).toEqual({ sent: 0, skipped: 0, failed: 0, remainingPending: 0, complete: true });
    expect(resolveOrganizationAccess).not.toHaveBeenCalled();
    expect(updateCampaign).not.toHaveBeenCalled();
  });

  it("does not re-check organization access for a campaign that already short-circuits as SENT — the gate only matters for campaigns that would actually attempt to send", async () => {
    findFirstCampaign.mockResolvedValueOnce(makeCampaign({ status: "SENT" }));

    await sendCommunicationCampaign({ organizationId: "org-a", campaignId: "campaign-1" });

    expect(resolveOrganizationAccess).not.toHaveBeenCalled();
  });

  it("short-circuits without reprocessing when the campaign is already SENT", async () => {
    findFirstCampaign.mockResolvedValueOnce(makeCampaign({ status: "SENT" }));

    const result = await sendCommunicationCampaign({ organizationId: "org-a", campaignId: "campaign-1" });

    expect(result).toEqual({ sent: 0, skipped: 0, failed: 0, remainingPending: 0, complete: true });
    expect(findManyRecipient).not.toHaveBeenCalled();
  });

  it("queries recipients scoped to PENDING and capped at the batch size (not the whole recipient list)", async () => {
    findFirstCampaign.mockResolvedValueOnce(makeCampaign());
    findManyRecipient.mockResolvedValueOnce([]);
    countRecipient.mockResolvedValueOnce(0);

    await sendCommunicationCampaign({ organizationId: "org-a", campaignId: "campaign-1" });

    expect(findManyRecipient).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { campaignId: "campaign-1", deliveryStatus: "PENDING" },
        take: 300,
      })
    );
  });

  it("batch-fetches mobile device tokens once for every recipient instead of per-recipient", async () => {
    findFirstCampaign.mockResolvedValueOnce(makeCampaign({ pushEnabled: true }));
    findManyRecipient.mockResolvedValueOnce([
      makeRecipient("r1", { member: { userId: "user-1", commsPushEnabled: true, requiredNoticesOnly: false } }),
      makeRecipient("r2", { member: { userId: "user-2", commsPushEnabled: true, requiredNoticesOnly: false } }),
    ]);
    countRecipient.mockResolvedValueOnce(0);

    await sendCommunicationCampaign({ organizationId: "org-a", campaignId: "campaign-1" });

    expect(findManyDeviceToken).toHaveBeenCalledTimes(1);
    expect(findManyDeviceToken).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: { in: ["user-1", "user-2"] } } })
    );
  });

  it("falls back to a PTA household's linked adults for push when the recipient's own billing OrgMember has no userId — the real production gap this fixes", async () => {
    findFirstCampaign.mockResolvedValueOnce(makeCampaign({ pushEnabled: true }));
    findManyRecipient.mockResolvedValueOnce([
      makeRecipient("r1", { memberId: "household-member-1", member: { userId: null, commsPushEnabled: true, requiredNoticesOnly: false } }),
    ]);
    resolvePtaHouseholdAdultUserIdsBatch.mockResolvedValueOnce(new Map([["household-member-1", ["adult-user-1", "adult-user-2"]]]));
    findManyDeviceToken.mockResolvedValueOnce([
      { userId: "adult-user-1", token: "token-a" },
      { userId: "adult-user-2", token: "token-b" },
    ]);
    countRecipient.mockResolvedValueOnce(0);

    await sendCommunicationCampaign({ organizationId: "org-a", campaignId: "campaign-1" });

    expect(resolvePtaHouseholdAdultUserIdsBatch).toHaveBeenCalledWith("org-a", ["household-member-1"]);
    expect(findManyDeviceToken).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: { in: ["adult-user-1", "adult-user-2"] } } })
    );
    expect(sendPushToTokens).toHaveBeenCalledWith(expect.arrayContaining(["token-a", "token-b"]), expect.anything());
  });

  it("records an explicit skipped push outcome (not silence) when a recipient has no push target at all", async () => {
    findFirstCampaign.mockResolvedValueOnce(makeCampaign({ pushEnabled: true }));
    findManyRecipient.mockResolvedValueOnce([
      makeRecipient("r1", { memberId: "household-member-1", member: { userId: null, commsPushEnabled: true, requiredNoticesOnly: false } }),
    ]);
    resolvePtaHouseholdAdultUserIdsBatch.mockResolvedValueOnce(new Map()); // no adult has a linked login
    countRecipient.mockResolvedValueOnce(0);

    await sendCommunicationCampaign({ organizationId: "org-a", campaignId: "campaign-1" });

    expect(sendPushToTokens).not.toHaveBeenCalled();
    expect(createCommunicationLog).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ communicationType: "PUSH", outcome: "No linked mobile login" }) })
    );
  });

  it("never queries the household push fallback when the campaign doesn't have push enabled", async () => {
    findFirstCampaign.mockResolvedValueOnce(makeCampaign({ pushEnabled: false }));
    findManyRecipient.mockResolvedValueOnce([
      makeRecipient("r1", { memberId: "household-member-1", member: { userId: null, commsPushEnabled: true, requiredNoticesOnly: false } }),
    ]);
    countRecipient.mockResolvedValueOnce(0);

    await sendCommunicationCampaign({ organizationId: "org-a", campaignId: "campaign-1" });

    expect(resolvePtaHouseholdAdultUserIdsBatch).not.toHaveBeenCalled();
  });

  it("defaults the push deep link to the announcement's own detail screen when staff didn't set one", async () => {
    findFirstCampaign.mockResolvedValueOnce(
      makeCampaign({ pushEnabled: true, communicationType: "ANNOUNCEMENT", deepLink: null })
    );
    findManyRecipient.mockResolvedValueOnce([
      makeRecipient("r1", { member: { userId: "user-1", commsPushEnabled: true, requiredNoticesOnly: false } }),
    ]);
    findManyDeviceToken.mockResolvedValueOnce([{ userId: "user-1", token: "token-1" }]);
    countRecipient.mockResolvedValueOnce(0);

    await sendCommunicationCampaign({ organizationId: "org-a", campaignId: "campaign-1" });

    expect(sendPushToTokens).toHaveBeenCalledWith(["token-1"], expect.objectContaining({ deepLink: "/announcement/campaign-1" }));
  });

  it("keeps staff's explicit deep link instead of the announcement default when one is set", async () => {
    findFirstCampaign.mockResolvedValueOnce(
      makeCampaign({ pushEnabled: true, communicationType: "ANNOUNCEMENT", deepLink: "/dues" })
    );
    findManyRecipient.mockResolvedValueOnce([
      makeRecipient("r1", { member: { userId: "user-1", commsPushEnabled: true, requiredNoticesOnly: false } }),
    ]);
    findManyDeviceToken.mockResolvedValueOnce([{ userId: "user-1", token: "token-1" }]);
    countRecipient.mockResolvedValueOnce(0);

    await sendCommunicationCampaign({ organizationId: "org-a", campaignId: "campaign-1" });

    expect(sendPushToTokens).toHaveBeenCalledWith(["token-1"], expect.objectContaining({ deepLink: "/dues" }));
  });

  it("does not default a deep link for non-announcement campaign types", async () => {
    findFirstCampaign.mockResolvedValueOnce(
      makeCampaign({ pushEnabled: true, communicationType: "DUES_REMINDER", deepLink: null })
    );
    findManyRecipient.mockResolvedValueOnce([
      makeRecipient("r1", { member: { userId: "user-1", commsPushEnabled: true, requiredNoticesOnly: false } }),
    ]);
    findManyDeviceToken.mockResolvedValueOnce([{ userId: "user-1", token: "token-1" }]);
    countRecipient.mockResolvedValueOnce(0);

    await sendCommunicationCampaign({ organizationId: "org-a", campaignId: "campaign-1" });

    expect(sendPushToTokens).toHaveBeenCalledWith(["token-1"], expect.objectContaining({ deepLink: null }));
  });

  it("processes every pending recipient and finalizes the campaign as SENT with one audit event when none remain", async () => {
    findFirstCampaign.mockResolvedValueOnce(makeCampaign());
    findManyRecipient.mockResolvedValueOnce([makeRecipient("r1"), makeRecipient("r2"), makeRecipient("r3")]);
    countRecipient
      .mockResolvedValueOnce(0) // remainingPending check after the batch
      .mockResolvedValueOnce(3) // finalizeCampaign: SENT count
      .mockResolvedValueOnce(0) // SKIPPED count
      .mockResolvedValueOnce(0); // FAILED count

    const result = await sendCommunicationCampaign({ organizationId: "org-a", campaignId: "campaign-1" });

    expect(sendEmail).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ sent: 3, skipped: 0, failed: 0, remainingPending: 0, complete: true });
    expect(updateManyCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "SENT" }) })
    );
    expect(createAuditEvent).toHaveBeenCalledTimes(1);
  });

  it("leaves the campaign SENDING with no audit event when pending recipients remain after a batch", async () => {
    findFirstCampaign.mockResolvedValueOnce(makeCampaign());
    findManyRecipient.mockResolvedValueOnce([makeRecipient("r1")]);
    countRecipient.mockResolvedValueOnce(250); // still plenty pending

    const result = await sendCommunicationCampaign({ organizationId: "org-a", campaignId: "campaign-1" });

    expect(result.complete).toBe(false);
    expect(result.remainingPending).toBe(250);
    expect(createAuditEvent).not.toHaveBeenCalled();
    expect(updateManyCampaign).not.toHaveBeenCalled();
  });

  it("marks a recipient FAILED without throwing the whole batch when its send throws", async () => {
    findFirstCampaign.mockResolvedValueOnce(makeCampaign());
    findManyRecipient.mockResolvedValueOnce([makeRecipient("r1"), makeRecipient("r2")]);
    sendEmail.mockResolvedValueOnce({ sent: true, skipped: false }).mockRejectedValueOnce(new Error("SMTP down"));
    countRecipient.mockResolvedValueOnce(0).mockResolvedValueOnce(1).mockResolvedValueOnce(0).mockResolvedValueOnce(1);

    const result = await sendCommunicationCampaign({ organizationId: "org-a", campaignId: "campaign-1" });

    expect(result.sent + result.failed).toBe(2);
    expect(result.failed).toBeGreaterThanOrEqual(1);
  });

  it("skips email for a recipient who opted out via commsEmailEnabled, without ever calling sendEmail", async () => {
    findFirstCampaign.mockResolvedValueOnce(makeCampaign());
    findManyRecipient.mockResolvedValueOnce([
      makeRecipient("r1", { member: { commsEmailEnabled: false } }),
    ]);
    countRecipient.mockResolvedValueOnce(0).mockResolvedValueOnce(0).mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    const result = await sendCommunicationCampaign({ organizationId: "org-a", campaignId: "campaign-1" });

    expect(sendEmail).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(updateRecipient).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ errorMessage: "Member opted out of email notifications" }) })
    );
  });

  it("still sends email to a recipient with no linked member record (manual/non-member recipient)", async () => {
    findFirstCampaign.mockResolvedValueOnce(makeCampaign());
    findManyRecipient.mockResolvedValueOnce([makeRecipient("r1", { member: null })]);
    countRecipient.mockResolvedValueOnce(0).mockResolvedValueOnce(1).mockResolvedValueOnce(0).mockResolvedValueOnce(0);

    await sendCommunicationCampaign({ organizationId: "org-a", campaignId: "campaign-1" });

    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("blocks an EMAIL-channel send and marks the campaign FAILED (not retried) when the org has since been downgraded off emailCampaigns", async () => {
    findFirstCampaign.mockResolvedValueOnce(makeCampaign({ status: "READY" }));
    findUniqueOrganization.mockResolvedValueOnce({
      name: "ThrivePath Foundation",
      plan: "free",
      trialEndsAt: null,
      billingExempt: false,
      seatLimit: null,
    });

    await expect(
      sendCommunicationCampaign({ organizationId: "org-a", campaignId: "campaign-1" })
    ).rejects.toMatchObject({ code: "PLAN_FEATURE_REQUIRED", feature: "emailCampaigns" });

    expect(updateCampaign).toHaveBeenCalledWith({ where: { id: "campaign-1" }, data: { status: "FAILED" } });
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "communication_campaign.blocked",
        entityId: "campaign-1",
        metadata: { reason: "plan_feature_required", feature: "emailCampaigns" },
      })
    );
    // Never reached the recipient batch — nothing was (re)sent.
    expect(findManyRecipient).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("does not check emailCampaigns for an INTERNAL_LOG_ONLY channel campaign", async () => {
    findFirstCampaign.mockResolvedValueOnce(makeCampaign({ channel: "INTERNAL_LOG_ONLY" }));
    findManyRecipient.mockResolvedValueOnce([]);
    countRecipient.mockResolvedValueOnce(0);

    await sendCommunicationCampaign({ organizationId: "org-a", campaignId: "campaign-1" });

    expect(updateCampaign).not.toHaveBeenCalled();
  });
});

describe("processScheduledCampaigns", () => {
  beforeEach(() => {
    findManyCampaign.mockClear();
  });

  it("queries both newly-due READY campaigns and SENDING campaigns with leftover pending recipients", async () => {
    findManyCampaign.mockResolvedValueOnce([]);

    await processScheduledCampaigns(50);

    expect(findManyCampaign).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { status: "READY", scheduledFor: { lte: expect.any(Date) } },
            { status: "SENDING", recipients: { some: { deliveryStatus: "PENDING" } } },
          ],
        },
        take: 50,
      })
    );
  });

  it("logs a structured per-campaign failure (ids + error, no recipient data) when a scheduled send throws, and still processes the rest of the batch", async () => {
    findManyCampaign.mockResolvedValueOnce([{ id: "campaign-broken", organizationId: "org-broken" }]);
    findFirstCampaign.mockRejectedValueOnce(new Error("unexpected send error"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await processScheduledCampaigns(50);

    expect(result).toEqual({ processed: 1, sent: 0, failed: 1 });

    const failureLog = errorSpy.mock.calls.map((c) => JSON.parse(c[0] as string)).find((l) => l.event === "communication_campaign_scheduled_send_failed");
    expect(failureLog).toMatchObject({
      organizationId: "org-broken",
      campaignId: "campaign-broken",
      error: "unexpected send error",
    });

    const summaryLog = logSpy.mock.calls.map((c) => JSON.parse(c[0] as string)).find((l) => l.event === "communication_campaigns_cron_completed");
    expect(summaryLog).toEqual({ event: "communication_campaigns_cron_completed", processed: 1, sent: 0, failed: 1 });
  });
});
