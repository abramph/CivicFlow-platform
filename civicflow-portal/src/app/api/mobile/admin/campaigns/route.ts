import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileAuth, MobileForbiddenError } from "@/lib/mobile-auth";
import { requireMobileAdminAccess } from "@/lib/mobile-admin";
import { prisma } from "@/lib/prisma";
import { ValidationError, parseJsonBody, z } from "@/lib/validation";
import { requireRateLimit } from "@/lib/rate-limit";
import { createCommunicationCampaign, createCampaignSchema } from "@/lib/communication-campaign-mutations";

const createMobileCampaignSchema = createCampaignSchema.extend({ organizationId: z.string().min(1) });

async function requireManageCommunications(request: Request, organizationId: string) {
  const { userId, email } = await requireMobileAuth(request);
  const admin = await requireMobileAdminAccess(organizationId, userId);
  if (!admin.available || !admin.adminCapabilities.includes("manageCommunications")) {
    throw new MobileForbiddenError("No mobile communications administration access for this organization");
  }
  return { userId, email };
}

/**
 * GET /api/mobile/admin/campaigns?organizationId=...
 * POST /api/mobile/admin/campaigns
 * Mirrors src/app/api/communications/campaigns/route.ts, delegating create
 * to the exact same createCommunicationCampaign() (entitlement gates,
 * recipient resolution, audit) the web form uses.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    await requireManageCommunications(request, organizationId);

    const rows = await prisma.communicationCampaign.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        title: true,
        communicationType: true,
        channel: true,
        status: true,
        scheduledFor: true,
        sentAt: true,
        createdAt: true,
        _count: { select: { recipients: true } },
      },
    });

    return Response.json({ ok: true, data: rows });
  });
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:mobile:admin:campaigns:write",
      request,
      limit: 20,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { organizationId, ...input } = await parseJsonBody(request, createMobileCampaignSchema);
    const { userId, email } = await requireManageCommunications(request, organizationId);

    // Build 27 duplicate-submission protection: a retried/double-tapped
    // create of the same content by the same admin within a short window is
    // answered with a conflict instead of a second campaign (and, when
    // sendNow was set, a second full send). Deliberately narrow — same
    // title AND subject AND body — so legitimately re-sending an updated
    // announcement is never blocked.
    const recentDuplicate = await prisma.communicationCampaign.findFirst({
      where: {
        organizationId,
        createdByUserId: userId,
        title: input.title.trim(),
        subject: input.subject.trim(),
        body: input.body.trim(),
        createdAt: { gte: new Date(Date.now() - 2 * 60_000) },
      },
      select: { id: true },
    });
    if (recentDuplicate) {
      return Response.json(
        { ok: false, error: "An identical announcement was just created. Check the campaign list before sending it again.", code: "DUPLICATE_CAMPAIGN" },
        { status: 409 }
      );
    }

    const campaign = await createCommunicationCampaign(organizationId, { userId, userEmail: email }, input);

    return Response.json({ ok: true, data: campaign }, { status: 201 });
  });
}
