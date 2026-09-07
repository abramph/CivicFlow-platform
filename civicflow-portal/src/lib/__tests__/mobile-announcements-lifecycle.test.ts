import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Build 27 communication lifecycle — the shared listing/archive logic both
 * announcement routes ride. Load-bearing properties: withdrawn campaigns
 * never reach a member-facing list (either view), the caller's archive
 * state selects between the two views, and the archive write can only ever
 * touch the caller's own recipient row.
 */

const findManyRecipient = vi.fn();
const updateManyRecipient = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    communicationRecipient: {
      findMany: (...a: unknown[]) => findManyRecipient(...a),
      updateMany: (...a: unknown[]) => updateManyRecipient(...a),
    },
  },
}));

import { listAnnouncementsForMember, setAnnouncementArchivedForMember } from "../mobile-announcements";

beforeEach(() => {
  vi.clearAllMocks();
  findManyRecipient.mockResolvedValue([]);
  updateManyRecipient.mockResolvedValue({ count: 1 });
});

describe("listAnnouncementsForMember (Build 27 lifecycle)", () => {
  it("excludes withdrawn campaigns and the caller's archived items from the default view", async () => {
    await listAnnouncementsForMember("org-a", "member-1");

    const where = findManyRecipient.mock.calls[0][0].where;
    expect(where.archivedAt).toBeNull();
    expect(where.campaign).toEqual(expect.objectContaining({ withdrawnAt: null }));
  });

  it("the archived view lists exactly the caller's archived items — withdrawn campaigns are still excluded", async () => {
    await listAnnouncementsForMember("org-a", "member-1", { archived: true });

    const where = findManyRecipient.mock.calls[0][0].where;
    expect(where.archivedAt).toEqual({ not: null });
    expect(where.campaign).toEqual(expect.objectContaining({ withdrawnAt: null }));
  });

  it("returns the archive state on every row", async () => {
    findManyRecipient.mockResolvedValueOnce([
      {
        readAt: null,
        archivedAt: new Date(),
        campaign: { id: "camp-1", title: "T", subject: "S", body: "B", deepLink: null, sentAt: new Date() },
      },
    ]);
    const [row] = await listAnnouncementsForMember("org-a", "member-1", { archived: true });
    expect(row.isArchived).toBe(true);
    expect(row.isRead).toBe(false);
  });
});

describe("setAnnouncementArchivedForMember", () => {
  it("archives ONLY the caller's own recipient row for that campaign", async () => {
    await setAnnouncementArchivedForMember("org-a", "member-1", "camp-1", true);

    expect(updateManyRecipient).toHaveBeenCalledWith({
      where: { organizationId: "org-a", memberId: "member-1", campaignId: "camp-1" },
      data: { archivedAt: expect.any(Date) },
    });
  });

  it("restore clears the caller's own archive stamp", async () => {
    await setAnnouncementArchivedForMember("org-a", "member-1", "camp-1", false);

    expect(updateManyRecipient).toHaveBeenCalledWith({
      where: { organizationId: "org-a", memberId: "member-1", campaignId: "camp-1" },
      data: { archivedAt: null },
    });
  });
});
