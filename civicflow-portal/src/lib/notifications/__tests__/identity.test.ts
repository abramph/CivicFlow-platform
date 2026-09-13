import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueOrganization = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: {
      findUnique: (...args: unknown[]) => findUniqueOrganization(...args),
    },
  },
}));

import {
  MAX_NOTIFICATION_TITLE_LENGTH,
  NOTIFICATION_CATEGORY_LABEL,
  PLATFORM_NOTIFICATION_TITLE,
  buildNotificationIdentity,
  campaignNotificationCategory,
  isOrganizationTitledCategory,
  normalizeName,
  safeTruncate,
} from "@/lib/notifications/identity";

describe("notification identity — pure helpers", () => {
  it("normalizeName collapses internal whitespace and trims", () => {
    expect(normalizeName("  Riverside   Community\nPTA ")).toBe("Riverside Community PTA");
  });

  it("safeTruncate leaves short strings unchanged", () => {
    expect(safeTruncate("Riverside PTA", 64)).toBe("Riverside PTA");
  });

  it("safeTruncate shortens long strings and appends an ellipsis", () => {
    const out = safeTruncate("A".repeat(100), 10);
    expect(Array.from(out)).toHaveLength(10);
    expect(out.endsWith("…")).toBe(true);
  });

  it("safeTruncate never splits a multi-byte code point (emoji/surrogate pair)", () => {
    // Each 😀 is a surrogate pair in UTF-16; truncation must count code points.
    const out = safeTruncate("😀".repeat(50), 5);
    expect(Array.from(out)).toHaveLength(5);
    // No lone surrogate leaked in — every kept char is a full emoji or the ellipsis.
    expect([...out].every((ch) => ch === "😀" || ch === "…")).toBe(true);
  });

  it("campaignNotificationCategory maps communication types to categories", () => {
    expect(campaignNotificationCategory("EVENT_NOTICE")).toBe("EVENT_REMINDER");
    expect(campaignNotificationCategory("MEETING_MINUTES")).toBe("MEETING_UPDATE");
    expect(campaignNotificationCategory("DUES_REMINDER")).toBe("DUES_REMINDER");
    expect(campaignNotificationCategory("ANNOUNCEMENT")).toBe("ANNOUNCEMENT");
    expect(campaignNotificationCategory("GENERAL")).toBe("ANNOUNCEMENT");
    expect(campaignNotificationCategory("anything-unknown")).toBe("ANNOUNCEMENT");
  });

  it("only PLATFORM_ALERT is not organization-titled", () => {
    expect(isOrganizationTitledCategory("PLATFORM_ALERT")).toBe(false);
    expect(isOrganizationTitledCategory("ANNOUNCEMENT")).toBe(true);
    expect(isOrganizationTitledCategory("DIRECT_MESSAGE")).toBe(true);
  });

  it("uses the spec's recommended subtitle wording", () => {
    expect(NOTIFICATION_CATEGORY_LABEL.ANNOUNCEMENT).toBe("Announcement");
    expect(NOTIFICATION_CATEGORY_LABEL.EVENT_REMINDER).toBe("Event reminder");
    expect(NOTIFICATION_CATEGORY_LABEL.MEETING_REMINDER).toBe("Meeting reminder");
    expect(NOTIFICATION_CATEGORY_LABEL.DUES_REMINDER).toBe("Payment reminder");
    expect(NOTIFICATION_CATEGORY_LABEL.VOLUNTEER_REMINDER).toBe("Volunteer reminder");
    expect(NOTIFICATION_CATEGORY_LABEL.PLATFORM_ALERT).toBeNull();
  });
});

describe("buildNotificationIdentity", () => {
  beforeEach(() => {
    findUniqueOrganization.mockReset().mockResolvedValue({ name: "Riverside Community" });
  });

  it("titles an announcement with the organization name and the category subtitle", async () => {
    const identity = await buildNotificationIdentity({ category: "ANNOUNCEMENT", organizationId: "org-1" });
    expect(identity).toEqual({
      title: "Riverside Community",
      subtitle: "Announcement",
      category: "ANNOUNCEMENT",
      organizationResolved: true,
    });
  });

  it("resolves the org name SERVER-side from the tenant id (never a client field)", async () => {
    await buildNotificationIdentity({ category: "EVENT_REMINDER", organizationId: "org-1" });
    expect(findUniqueOrganization).toHaveBeenCalledWith({ where: { id: "org-1" }, select: { name: true } });
  });

  it("ignores a spoofed sender/client name for a non-DM category — title stays the org name", async () => {
    const identity = await buildNotificationIdentity({
      category: "EVENT_REMINDER",
      organizationId: "org-1",
      // A malicious/incorrect client-supplied name must never become the title.
      senderName: "Totally Not This Org",
    });
    expect(identity.title).toBe("Riverside Community");
  });

  it("gives event / meeting / dues / volunteer reminders their spec subtitles", async () => {
    for (const [category, subtitle] of [
      ["EVENT_REMINDER", "Event reminder"],
      ["MEETING_REMINDER", "Meeting reminder"],
      ["DUES_REMINDER", "Payment reminder"],
      ["VOLUNTEER_REMINDER", "Volunteer reminder"],
    ] as const) {
      const identity = await buildNotificationIdentity({ category, organizationId: "org-1" });
      expect(identity).toMatchObject({ title: "Riverside Community", subtitle });
    }
  });

  it("PLATFORM_ALERT is always the Unestra platform identity and never queries the org", async () => {
    const identity = await buildNotificationIdentity({ category: "PLATFORM_ALERT", organizationId: "org-1" });
    expect(identity).toEqual({
      title: PLATFORM_NOTIFICATION_TITLE,
      subtitle: null,
      category: "PLATFORM_ALERT",
      organizationResolved: false,
    });
    expect(findUniqueOrganization).not.toHaveBeenCalled();
  });

  it("falls back to Unestra when the org is missing (deleted / unknown id)", async () => {
    findUniqueOrganization.mockResolvedValueOnce(null);
    const identity = await buildNotificationIdentity({ category: "ANNOUNCEMENT", organizationId: "gone" });
    expect(identity).toMatchObject({ title: "Unestra", organizationResolved: false });
  });

  it("falls back to Unestra when the org has an empty name", async () => {
    findUniqueOrganization.mockResolvedValueOnce({ name: "   " });
    const identity = await buildNotificationIdentity({ category: "ANNOUNCEMENT", organizationId: "org-1" });
    expect(identity).toMatchObject({ title: "Unestra", organizationResolved: false });
  });

  it("falls back to Unestra when no organizationId is supplied (and never queries)", async () => {
    const identity = await buildNotificationIdentity({ category: "ANNOUNCEMENT" });
    expect(identity).toMatchObject({ title: "Unestra", organizationResolved: false });
    expect(findUniqueOrganization).not.toHaveBeenCalled();
  });

  it("DIRECT_MESSAGE renders 'Sender · Organization'", async () => {
    const identity = await buildNotificationIdentity({
      category: "DIRECT_MESSAGE",
      organizationId: "org-1",
      senderName: "Officer Jane",
    });
    expect(identity).toMatchObject({ title: "Officer Jane · Riverside Community", subtitle: "Message" });
  });

  it("DIRECT_MESSAGE never surfaces an email address as the sender identity", async () => {
    const identity = await buildNotificationIdentity({
      category: "DIRECT_MESSAGE",
      organizationId: "org-1",
      senderName: "jane@example.com",
    });
    expect(identity.title).toBe("Riverside Community");
  });

  it("DIRECT_MESSAGE without a sender name uses the org name alone", async () => {
    const identity = await buildNotificationIdentity({ category: "DIRECT_MESSAGE", organizationId: "org-1" });
    expect(identity.title).toBe("Riverside Community");
  });

  it("truncates an over-long org name on a code-point boundary", async () => {
    findUniqueOrganization.mockResolvedValueOnce({ name: "Z".repeat(200) });
    const identity = await buildNotificationIdentity({ category: "ANNOUNCEMENT", organizationId: "org-1" });
    expect(Array.from(identity.title).length).toBeLessThanOrEqual(MAX_NOTIFICATION_TITLE_LENGTH);
    expect(identity.title.endsWith("…")).toBe(true);
  });
});
