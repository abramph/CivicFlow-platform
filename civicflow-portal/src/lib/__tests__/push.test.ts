import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstOrgMember = vi.fn();
const findManyMobileDeviceToken = vi.fn().mockResolvedValue([]);
const createCommunicationLog = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgMember: {
      findFirst: (...args: unknown[]) => findFirstOrgMember(...args),
    },
    mobileDeviceToken: {
      findMany: (...args: unknown[]) => findManyMobileDeviceToken(...args),
      deleteMany: vi.fn().mockResolvedValue(undefined),
    },
    communicationLog: {
      create: (...args: unknown[]) => createCommunicationLog(...args),
    },
  },
}));

vi.mock("@/lib/deep-links", () => ({ validateDeepLink: vi.fn(() => null) }));

const resolvePtaHouseholdAdultUserIds = vi.fn().mockResolvedValue([]);
vi.mock("@/lib/labs/pta/households", () => ({
  resolvePtaHouseholdAdultUserIds: (...args: unknown[]) => resolvePtaHouseholdAdultUserIds(...args),
}));

let sendPushNotificationsAsyncImpl = async () => [] as unknown[];
vi.mock("expo-server-sdk", () => ({
  Expo: class {
    static isExpoPushToken() {
      return true;
    }
    chunkPushNotifications(messages: unknown[]) {
      return [messages];
    }
    async sendPushNotificationsAsync(...args: unknown[]) {
      return sendPushNotificationsAsyncImpl(...(args as []));
    }
  },
}));

import { sendPushToMember, sendPushToTokens } from "@/lib/push";

describe("sendPushToMember opt-out gating", () => {
  beforeEach(() => {
    findFirstOrgMember.mockReset();
    findManyMobileDeviceToken.mockClear();
    createCommunicationLog.mockClear();
    resolvePtaHouseholdAdultUserIds.mockReset().mockResolvedValue([]);
    sendPushNotificationsAsyncImpl = async () => [];
  });

  it("skips sending when the member has opted out of push entirely", async () => {
    findFirstOrgMember.mockResolvedValueOnce({ userId: "user-1", commsPushEnabled: false, requiredNoticesOnly: false });

    const result = await sendPushToMember({
      organizationId: "org-a",
      memberId: "member-1",
      title: "Announcement",
      body: "Hello",
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/opted out/);
    expect(findManyMobileDeviceToken).not.toHaveBeenCalled();
  });

  it("skips a non-required send when the member wants required notices only", async () => {
    findFirstOrgMember.mockResolvedValueOnce({ userId: "user-1", commsPushEnabled: true, requiredNoticesOnly: true });

    const result = await sendPushToMember({
      organizationId: "org-a",
      memberId: "member-1",
      title: "Announcement",
      body: "Hello",
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/required notices only/);
    expect(findManyMobileDeviceToken).not.toHaveBeenCalled();
  });

  it("still sends a required notice even when the member wants required notices only", async () => {
    findFirstOrgMember.mockResolvedValueOnce({ userId: "user-1", commsPushEnabled: true, requiredNoticesOnly: true });
    findManyMobileDeviceToken.mockResolvedValueOnce([{ token: "ExponentPushToken[abc]" }]);

    const result = await sendPushToMember({
      organizationId: "org-a",
      memberId: "member-1",
      title: "Membership Status Update",
      body: "Your status changed.",
      required: true,
    });

    expect(result.skipped).toBe(false);
    expect(findManyMobileDeviceToken).toHaveBeenCalled();
  });

  it("still sends a required notice even when the member fully opted out of push", async () => {
    findFirstOrgMember.mockResolvedValueOnce({ userId: "user-1", commsPushEnabled: false, requiredNoticesOnly: false });
    findManyMobileDeviceToken.mockResolvedValueOnce([{ token: "ExponentPushToken[abc]" }]);

    const result = await sendPushToMember({
      organizationId: "org-a",
      memberId: "member-1",
      title: "Membership Status Update",
      body: "Your status changed.",
      required: true,
    });

    expect(result.skipped).toBe(false);
    expect(findManyMobileDeviceToken).toHaveBeenCalled();
  });

  it("sends normally when the member allows push and hasn't restricted to required-only", async () => {
    findFirstOrgMember.mockResolvedValueOnce({ userId: "user-1", commsPushEnabled: true, requiredNoticesOnly: false });
    findManyMobileDeviceToken.mockResolvedValueOnce([{ token: "ExponentPushToken[abc]" }]);

    const result = await sendPushToMember({
      organizationId: "org-a",
      memberId: "member-1",
      title: "Announcement",
      body: "Hello",
    });

    expect(result.skipped).toBe(false);
  });

  it("skips cleanly when the member has no linked mobile login and isn't a PTA household either", async () => {
    findFirstOrgMember.mockResolvedValueOnce({ userId: null, commsPushEnabled: true, requiredNoticesOnly: false });
    resolvePtaHouseholdAdultUserIds.mockResolvedValueOnce([]);

    const result = await sendPushToMember({
      organizationId: "org-a",
      memberId: "member-1",
      title: "Announcement",
      body: "Hello",
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/No linked mobile login/);
  });

  describe("PTA household billing-identity fallback", () => {
    it("falls back to every linked household adult's userId when the member has no userId of its own", async () => {
      findFirstOrgMember.mockResolvedValueOnce({ userId: null, commsPushEnabled: true, requiredNoticesOnly: false });
      resolvePtaHouseholdAdultUserIds.mockResolvedValueOnce(["adult-1", "adult-2"]);
      findManyMobileDeviceToken.mockResolvedValueOnce([{ token: "ExponentPushToken[a]" }, { token: "ExponentPushToken[b]" }]);

      const result = await sendPushToMember({
        organizationId: "org-a",
        memberId: "household-member-1",
        title: "Welcome to Pine Grove PTA!",
        body: "Hello",
      });

      expect(resolvePtaHouseholdAdultUserIds).toHaveBeenCalledWith("org-a", "household-member-1");
      expect(findManyMobileDeviceToken).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: { in: ["adult-1", "adult-2"] } } })
      );
      expect(result.skipped).toBe(false);
    });

    it("still respects the household's shared push opt-out for the fallback path", async () => {
      findFirstOrgMember.mockResolvedValueOnce({ userId: null, commsPushEnabled: false, requiredNoticesOnly: false });
      resolvePtaHouseholdAdultUserIds.mockResolvedValueOnce(["adult-1"]);

      const result = await sendPushToMember({
        organizationId: "org-a",
        memberId: "household-member-1",
        title: "Welcome to Pine Grove PTA!",
        body: "Hello",
      });

      expect(result.skipped).toBe(true);
      expect(result.reason).toMatch(/opted out/);
      expect(findManyMobileDeviceToken).not.toHaveBeenCalled();
    });

    it("does not call the household resolver at all when the member already has its own userId", async () => {
      findFirstOrgMember.mockResolvedValueOnce({ userId: "user-1", commsPushEnabled: true, requiredNoticesOnly: false });
      findManyMobileDeviceToken.mockResolvedValueOnce([{ token: "ExponentPushToken[abc]" }]);

      await sendPushToMember({
        organizationId: "org-a",
        memberId: "member-1",
        title: "Announcement",
        body: "Hello",
      });

      expect(resolvePtaHouseholdAdultUserIds).not.toHaveBeenCalled();
    });
  });
});

describe("sendPushToTokens failure logging", () => {
  it("logs a structured failure event when the Expo API call throws, without leaking the token", async () => {
    sendPushNotificationsAsyncImpl = async () => {
      throw new Error("Expo service unavailable");
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await sendPushToTokens(["ExponentPushToken[super-secret-device-id]"], { title: "Hi", body: "There" });

    expect(result.failed).toBe(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(logged.event).toBe("push_send_failed");
    expect(logged.chunkSize).toBe(1);
    expect(logged.error).toBe("Expo service unavailable");
    expect(JSON.stringify(logged)).not.toMatch(/super-secret-device-id/);
  });

  it("does not log anything when every push in the chunk succeeds", async () => {
    sendPushNotificationsAsyncImpl = async () => [{ status: "ok" }];
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await sendPushToTokens(["ExponentPushToken[abc]"], { title: "Hi", body: "There" });

    expect(result.sent).toBe(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
