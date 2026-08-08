import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { parseJsonBody } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { createContribution, createContributionSchema } from "@/lib/contribution-mutations";

export async function GET() {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("contributions:read", "throw");

    const rows = await prisma.contribution.findMany({
      where: { organizationId },
      orderBy: [{ contributionDate: "desc" }, { createdAt: "desc" }],
      include: { member: true, campaign: true, event: true },
      take: 200,
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "list",
      entityType: "contribution",
      metadata: { count: rows.length },
    });

    return Response.json({ ok: true, data: rows });
  });
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:contributions:write",
      request,
      limit: 50,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session, organizationId } = await requirePermission("contributions:write", "throw");
    const input = await parseJsonBody(request, createContributionSchema);

    const result = await createContribution(organizationId, { userId: session.userId, userEmail: session.userEmail }, input);
    if (!result.ok) {
      return Response.json({ ok: false, error: result.error }, { status: result.status });
    }

    return Response.json({ ok: true, data: result.data }, { status: 201 });
  });
}
