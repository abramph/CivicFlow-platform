/**
 * Shared announcement-listing logic for mobile, used by BOTH the
 * conventional-member route (`/api/mobile/announcements`, resolves memberId
 * from a personal OrgMember via requireMobileMembership) and the PTA route
 * (`/api/mobile/pta/announcements`, resolves memberId from the household's
 * shared billing-identity OrgMember via requireMobilePtaHouseholdAccess).
 * The underlying query has always been the same — only how `memberId` gets
 * resolved differs — so it lives here once rather than twice.
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
}

export async function listAnnouncementsForMember(organizationId: string, memberId: string): Promise<MobileAnnouncement[]> {
  const recipients = await prisma.communicationRecipient.findMany({
    where: {
      organizationId,
      memberId,
      deliveryStatus: { in: ["SENT", "SKIPPED"] },
      campaign: { communicationType: { in: ["ANNOUNCEMENT", "GENERAL"] }, status: "SENT" },
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
  }));
}

export async function markAnnouncementReadForMember(organizationId: string, memberId: string, campaignId: string): Promise<void> {
  await prisma.communicationRecipient.updateMany({
    where: { organizationId, memberId, campaignId, readAt: null },
    data: { readAt: new Date() },
  });
}
