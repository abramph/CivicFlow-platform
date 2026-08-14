import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { createProgram, listPrograms } from "@/lib/giving/programs";
import { parseJsonBody, z } from "@/lib/validation";

export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("contributions:summary:view", "throw");
    const { searchParams } = new URL(request.url);
    const programs = await listPrograms(organizationId, { includeNonActive: searchParams.get("all") === "1" });
    return Response.json({ ok: true, data: programs });
  });
}

const createSchema = z.object({
  fundId: z.string().min(1).max(64),
  name: z.string().min(1).max(160),
  description: z.string().max(2000).nullable().optional(),
  type: z
    .enum(["DUES", "VOLUNTARY_CONTRIBUTION", "SUGGESTED_CONTRIBUTION", "ONE_TIME_GIVING", "PLEDGE_CAMPAIGN", "FUNDRAISER", "SPECIAL_OFFERING", "SPONSORSHIP", "OTHER"])
    .optional(),
  obligationNature: z.enum(["REQUIRED", "VOLUNTARY"]).optional(),
  allowCustomAmount: z.boolean().optional(),
  suggestedAmounts: z.array(z.number().positive().max(1_000_000)).max(8).optional(),
  defaultAmount: z.number().positive().max(1_000_000).nullable().optional(),
  allowedFrequencies: z.array(z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "ANNUALLY"])).optional(),
  visibility: z.enum(["MEMBERS", "PUBLIC", "HIDDEN"]).optional(),
  receiptLanguage: z.string().max(2000).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
});

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePermission("contributions:programs:manage", "throw");
    const input = await parseJsonBody(request, createSchema);
    const program = await createProgram({
      organizationId,
      ...input,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: program }, { status: 201 });
  });
}
