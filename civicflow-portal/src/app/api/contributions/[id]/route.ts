import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { parseJsonBody } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import { updateContribution, updateContributionSchema } from "@/lib/contribution-mutations";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("contributions:read", "throw");
    const { id } = await params;

    const contribution = await prisma.contribution.findFirst({
      where: { id, organizationId },
      include: {
        member: {
          select: { id: true, firstName: true, lastName: true, preferredName: true },
        },
        campaign: { select: { id: true, name: true } },
        event: { select: { id: true, title: true } },
        receipts: { orderBy: { createdAt: "desc" } },
      },
    });

    if (!contribution) {
      return Response.json({ error: "Contribution not found" }, { status: 404 });
    }

    return Response.json({ ok: true, data: contribution });
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("contributions:write", "throw");
    const { id } = await params;
    const input = await parseJsonBody(req, updateContributionSchema);

    const result = await updateContribution(organizationId, { userId: session.userId, userEmail: session.userEmail }, id, input);
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }

    return Response.json({ ok: true, data: result.data });
  });
}
