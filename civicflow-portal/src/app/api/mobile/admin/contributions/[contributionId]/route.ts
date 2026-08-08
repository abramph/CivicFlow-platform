import { withApiErrorHandling } from "@/lib/api-route";
import { prisma } from "@/lib/prisma";
import { requireMobilePaymentsPermission } from "@/lib/mobile-admin-payments";
import { PERMISSIONS } from "@/lib/rbac";
import { requireRateLimit } from "@/lib/rate-limit";
import { ValidationError, parseJsonBody, z } from "@/lib/validation";
import { updateContribution, updateContributionSchema } from "@/lib/contribution-mutations";

const updateMobileContributionSchema = updateContributionSchema.extend({ organizationId: z.string().min(1) });

export async function GET(request: Request, { params }: { params: Promise<{ contributionId: string }> }) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    await requireMobilePaymentsPermission(request, organizationId, "managePayments", PERMISSIONS.CONTRIBUTIONS_READ);
    const { contributionId } = await params;

    const contribution = await prisma.contribution.findFirst({
      where: { id: contributionId, organizationId },
      include: {
        member: { select: { id: true, firstName: true, lastName: true } },
        campaign: { select: { id: true, name: true } },
        event: { select: { id: true, title: true } },
        receipts: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!contribution) {
      return Response.json({ ok: false, error: "Contribution not found" }, { status: 404 });
    }

    return Response.json({ ok: true, data: contribution });
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ contributionId: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:mobile:admin:contributions:write",
      request,
      limit: 50,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { organizationId, ...input } = await parseJsonBody(request, updateMobileContributionSchema);
    const { userId, email } = await requireMobilePaymentsPermission(request, organizationId, "managePayments", PERMISSIONS.CONTRIBUTIONS_WRITE);
    const { contributionId } = await params;

    const result = await updateContribution(organizationId, { userId, userEmail: email }, contributionId, input);
    if (!result.ok) {
      return Response.json({ ok: false, error: result.error }, { status: result.status });
    }

    return Response.json({ ok: true, data: result.data });
  });
}
