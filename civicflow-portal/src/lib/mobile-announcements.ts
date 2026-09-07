/**
 * Shared announcement-listing logic for mobile, used by BOTH the
 * conventional-member route (`/api/mobile/announcements`, resolves memberId
 * from a personal OrgMember via requireMobileMembership) and the PTA route
 * (`/api/mobile/pta/announcements`, resolves memberId from the household's
 * shared billing-identity OrgMember via requireMobilePtaHouseholdAccess).
 * The underlying query has always been the same — only how `memberId` gets
 * resolved differs — so it lives here once rather than twice.
 *
 * Build 27 lifecycle rules enforced here for every caller at once:
 *  - a WITHDRAWN campaign (campaign.withdrawnAt set) never appears in a
 *    member-facing list, archived view included — withdrawal is the
 *    administrative "recall" and outranks personal state;
 *  - a recipient's own archivedAt hides an item from their default view
 *    only; the archived view lists exactly those rows, and nothing about
 *    either state is visible to any other recipient.
 */
import { prisma } from "@/lib/prisma";

export interface MobileAnnouncement {
  id: string;
  title: string;
  subject: string;
  body: string;
  deepLink: string | null;
  sentAt: Date | null;
  isRead: boolean;
  isArchived: boolean;
}

export async function listAnnouncementsForMember(
  organizationId: string,
  memberId: string,
  options: { archived?: boolean } = {}
): Promise<MobileAnnouncement[]> {
  const recipients = await prisma.communicationRecipient.findMany({
    where: {
      organizationId,
      memberId,
      deliveryStatus: { in: ["SENT", "SKIPPED"] },
      archivedAt: options.archived ? { not: null } : null,
      campaign: { communicationType: { in: ["ANNOUNCEMENT", "GENERAL"] }, status: "SENT", withdrawnAt: null },
    },
    orderBy: { sentAt: "desc" },
    include: { campaign: { select: { id: true, title: true, subject: true, body: true, deepLink: true, sentAt: true } } },
    take: 50,
  });

  return recipients.map((recipient) => ({
    id: recipient.campaign.id,
    title: recipient.campaign.title,
    subject: recipient.campaign.subject,
    body: recipient.campaign.body,
    deepLink: recipient.campaign.deepLink,
    sentAt: recipient.campaign.sentAt,
    isRead: recipient.readAt !== null,
    isArchived: recipient.archivedAt !== null,
  }));
}

export async function markAnnouncementReadForMember(organizationId: string, memberId: string, campaignId: string): Promise<void> {
  await prisma.communicationRecipient.updateMany({
    where: { organizationId, memberId, campaignId, readAt: null },
    data: { readAt: new Date() },
  });
}

/** Archives (or restores) the caller's OWN recipient row — the same
 * own-row-only updateMany shape as mark-read, so there is no way to touch
 * any other recipient's view. Idempotent in both directions. */
export async function setAnnouncementArchivedForMember(
  organizationId: string,
  memberId: string,
  campaignId: string,
  archived: boolean
): Promise<void> {
  await prisma.communicationRecipient.updateMany({
    where: { organizationId, memberId, campaignId },
    data: { archivedAt: archived ? new Date() : null },
  });
}
