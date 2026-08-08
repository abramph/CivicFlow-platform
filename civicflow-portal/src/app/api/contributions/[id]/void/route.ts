import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { parseJsonBody } from "@/lib/validation";
import { voidContribution, voidContributionSchema } from "@/lib/contribution-mutations";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("contributions:write", "throw");
    const { id } = await params;
    const input = await parseJsonBody(req, voidContributionSchema);

    const result = await voidContribution(organizationId, { userId: session.userId, userEmail: session.userEmail }, id, input);
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }

    return Response.json({ ok: true, data: result.data });
  });
}
