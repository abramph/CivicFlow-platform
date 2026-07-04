import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileMembership } from "@/lib/mobile-auth";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/validation";

/**
 * GET /api/mobile/announcements?organizationId=...
 * Announcements and organization-wide alerts that were sent to this member,
 * newest first.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { organizationId: verifiedOrgId, memberId } = await requireMobileMembership(request, organizationId);

    const recipients = await prisma.communicationRecipient.findMany({
      where: {
        organizationId: verifiedOrgId,
        memberId,
        deliveryStatus: { in: ["SENT", "SKIPPED"] },
        campaign: { communicationType: { in: ["ANNOUNCEMENT", "GENERAL"] }, status: "SENT" },
      },
      orderBy: { sentAt: "desc" },
      include: { campaign: { select: { id: true, title: true, subject: true, body: true, deepLink: true, sentAt: true } } },
      take: 50,
    });

    const data = recipients.map((recipient) => ({
      id: recipient.campaign.id,
      title: recipient.campaign.title,
      subject: recipient.campaign.subject,
      body: recipient.campaign.body,
      deepLink: recipient.campaign.deepLink,
      sentAt: recipient.campaign.sentAt,
    }));

    return Response.json({ ok: true, data });
  });
}
