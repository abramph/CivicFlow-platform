import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { updateProgram } from "@/lib/giving/programs";
import { parseJsonBody, z } from "@/lib/validation";

const patchSchema = z.object({
  fundId: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(160).optional(),
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
  status: z.enum(["DRAFT", "ACTIVE", "INACTIVE", "CLOSED", "ARCHIVED"]).optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ programId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePermission("contributions:programs:manage", "throw");
    const { programId } = await params;
    const input = await parseJsonBody(request, patchSchema);
    const program = await updateProgram({
      organizationId,
      programId,
      ...input,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: program });
  });
}
