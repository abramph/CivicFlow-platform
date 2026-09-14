import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueOrganization = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: {
      findUnique: (...args: unknown[]) => findUniqueOrganization(...args),
    },
  },
}));

const sendPushToMember = vi.fn();
const sendPushToTokens = vi.fn();
vi.mock("@/lib/push", () => ({
  sendPushToMember: (...args: unknown[]) => sendPushToMember(...args),
  sendPushToTokens: (...args: unknown[]) => sendPushToTokens(...args),
}));

import { sendOrganizationMemberPush, sendOrganizationTokensPush } from "@/lib/notifications/send";

describe("organization-branded push wrappers", () => {
  beforeEach(() => {
    findUniqueOrganization.mockReset().mockResolvedValue({ name: "Riverside Community" });
    sendPushToMember.mockReset().mockResolvedValue({ sent: 1, failed: 0 });
    sendPushToTokens.mockReset().mockResolvedValue({ sent: 1, failed: 0 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sendOrganizationMemberPush titles with the org name and passes org id + category as reserved fields", async () => {
    await sendOrganizationMemberPush({
      organizationId: "org-1",
      memberId: "member-1",
      category: "DUES_REMINDER",
      body: "Your dues are due.",
      deepLink: "/dues",
      required: true,
    });

    // organizationId/category are explicit reserved fields (push.ts writes them
    // authoritatively into data); the wrapper carries no extra `data` here.
    expect(sendPushToMember).toHaveBeenCalledWith({
      organizationId: "org-1",
      memberId: "member-1",
      title: "Riverside Community",
      subtitle: "Payment reminder",
      body: "Your dues are due.",
      deepLink: "/dues",
      category: "DUES_REMINDER",
      data: undefined,
      required: true,
    });
  });

  it("sendOrganizationTokensPush passes reserved fields explicitly and keeps caller data separate", async () => {
    await sendOrganizationTokensPush({
      organizationId: "org-1",
      tokens: ["ExponentPushToken[a]", "ExponentPushToken[b]"],
      category: "ANNOUNCEMENT",
      body: "Meeting tonight.",
      deepLink: "/announcements/c1",
      data: { campaignId: "c1" },
    });

    expect(sendPushToTokens).toHaveBeenCalledWith(
      ["ExponentPushToken[a]", "ExponentPushToken[b]"],
      {
        title: "Riverside Community",
        subtitle: "Announcement",
        body: "Meeting tonight.",
        deepLink: "/announcements/c1",
        organizationId: "org-1",
        category: "ANNOUNCEMENT",
        data: { campaignId: "c1" },
      }
    );
  });

  it("falls back to the Unestra title and logs ONLY identifiers when the org can't be resolved", async () => {
    findUniqueOrganization.mockResolvedValueOnce(null);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await sendOrganizationMemberPush({
      organizationId: "ghost-org",
      memberId: "member-1",
      category: "ANNOUNCEMENT",
      body: "Sensitive body text that must never be logged.",
    });

    expect(sendPushToMember).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Unestra", organizationId: "ghost-org", category: "ANNOUNCEMENT" })
    );

    expect(warn).toHaveBeenCalledTimes(1);
    const logged = warn.mock.calls[0][0] as string;
    expect(logged).toContain("notification_org_unresolved");
    expect(logged).toContain("ghost-org");
    // Privacy: never the body, tokens, or member emails.
    expect(logged).not.toContain("Sensitive body text");
  });

  it("does NOT log the unresolved warning when there was no organizationId to resolve", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await sendOrganizationTokensPush({
      organizationId: "",
      tokens: ["ExponentPushToken[a]"],
      category: "PLATFORM_ALERT",
      body: "System notice.",
    });
    expect(warn).not.toHaveBeenCalled();
  });
});
