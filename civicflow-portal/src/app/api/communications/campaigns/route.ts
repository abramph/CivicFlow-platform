import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { prisma } from "@/lib/prisma";
import { parseJsonBody } from "@/lib/validation";
import { createCommunicationCampaign, createCampaignSchema } from "@/lib/communication-campaign-mutations";

export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("communications:read", "throw");
    const rows = await prisma.communicationCampaign.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, include: { _count: { select: { recipients: true } } }, take: 100 });
    return Response.json({ ok: true, data: rows });
  });
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("communications:write", "throw");
    const input = await parseJsonBody(request, createCampaignSchema);

    const campaign = await createCommunicationCampaign(organizationId, { userId: session.userId, userEmail: session.userEmail }, input);

    return Response.json({ ok: true, data: campaign }, { status: 201 });
  });
}
