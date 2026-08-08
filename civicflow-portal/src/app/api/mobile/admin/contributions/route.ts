import { withApiErrorHandling } from "@/lib/api-route";
import { prisma } from "@/lib/prisma";
import { requireMobilePaymentsPermission } from "@/lib/mobile-admin-payments";
import { PERMISSIONS } from "@/lib/rbac";
import { requireRateLimit } from "@/lib/rate-limit";
import { ValidationError, parseJsonBody, z } from "@/lib/validation";
import { createContribution, createContributionSchema } from "@/lib/contribution-mutations";

const createMobileContributionSchema = createContributionSchema.extend({ organizationId: z.string().min(1) });

/**
 * GET /api/mobile/admin/contributions?organizationId=...
 * POST /api/mobile/admin/contributions
 * Mirrors src/app/api/contributions/route.ts, delegating create to the
 * shared createContribution().
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    await requireMobilePaymentsPermission(request, organizationId, "managePayments", PERMISSIONS.CONTRIBUTIONS_READ);

    const rows = await prisma.contribution.findMany({
      where: { organizationId },
      orderBy: [{ contributionDate: "desc" }, { createdAt: "desc" }],
      take: 100,
      select: {
        id: true,
        amount: true,
        contributionDate: true,
        source: true,
        paymentMethod: true,
        voidedAt: true,
        member: { select: { id: true, firstName: true, lastName: true } },
        campaign: { select: { id: true, name: true } },
        event: { select: { id: true, title: true } },
      },
    });

    return Response.json({ ok: true, data: rows });
  });
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:mobile:admin:contributions:write",
      request,
      limit: 50,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { organizationId, ...input } = await parseJsonBody(request, createMobileContributionSchema);
    const { userId, email } = await requireMobilePaymentsPermission(request, organizationId, "managePayments", PERMISSIONS.CONTRIBUTIONS_WRITE);

    const result = await createContribution(organizationId, { userId, userEmail: email }, input);
    if (!result.ok) {
      return Response.json({ ok: false, error: result.error }, { status: result.status });
    }

    return Response.json({ ok: true, data: result.data }, { status: 201 });
  });
}
