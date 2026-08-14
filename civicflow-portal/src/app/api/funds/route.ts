import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { createFund, listFunds } from "@/lib/giving/funds";
import { parseJsonBody, z } from "@/lib/validation";

export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("contributions:summary:view", "throw");
    const { searchParams } = new URL(request.url);
    const funds = await listFunds(organizationId, { includeNonActive: searchParams.get("all") === "1" });
    return Response.json({ ok: true, data: funds });
  });
}

const createSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(2000).nullable().optional(),
  shortCode: z.string().max(20).nullable().optional(),
  isPublic: z.boolean().optional(),
  allowOneTime: z.boolean().optional(),
  allowRecurring: z.boolean().optional(),
  allowPledges: z.boolean().optional(),
  suggestedAmounts: z.array(z.number().positive().max(1_000_000)).max(8).optional(),
  minimumAmount: z.number().min(0).max(1_000_000).nullable().optional(),
  maximumAmount: z.number().min(0).max(10_000_000).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
  accountingCode: z.string().max(64).nullable().optional(),
});

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePermission("contributions:funds:manage", "throw");
    const input = await parseJsonBody(request, createSchema);
    const fund = await createFund({
      organizationId,
      ...input,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: fund }, { status: 201 });
  });
}
