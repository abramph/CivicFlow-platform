import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { createBudgetLine, getBudgetWithActuals } from "@/lib/budget";
import { parseJsonBody, z } from "@/lib/validation";

/** GET /api/budget?fiscalYear= — budget lines with live actuals/variance. */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("budget:read", "throw");
    const { searchParams } = new URL(request.url);
    const fiscalYear = searchParams.get("fiscalYear")?.trim();
    if (!fiscalYear) {
      return Response.json({ ok: false, error: "fiscalYear is required." }, { status: 400 });
    }
    const budget = await getBudgetWithActuals(organizationId, fiscalYear);
    return Response.json({ ok: true, data: budget });
  });
}

const createSchema = z.object({
  fiscalYear: z.string().min(1).max(40),
  name: z.string().min(1).max(160),
  categoryId: z.string().max(64).nullable().optional(),
  plannedAmount: z.number().min(0).max(100_000_000),
  notes: z.string().max(2000).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
});

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePermission("budget:manage", "throw");
    const input = await parseJsonBody(request, createSchema);
    const line = await createBudgetLine({
      organizationId,
      ...input,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: line }, { status: 201 });
  });
}
