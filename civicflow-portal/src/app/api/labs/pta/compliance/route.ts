import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { createComplianceRequirement, listComplianceRequirements } from "@/lib/labs/pta/compliance";
import { parseJsonBody, z } from "@/lib/validation";

/** GET /api/labs/pta/compliance — requirements with derived display status. */
export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePtaAccess("pta:board:view");
    const rows = await listComplianceRequirements(organizationId);
    return Response.json({ ok: true, data: rows });
  });
}

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).nullable().optional(),
  ownerName: z.string().max(120).nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  recurrence: z.enum(["NONE", "MONTHLY", "QUARTERLY", "ANNUAL"]).optional(),
  isApplicable: z.boolean().optional(),
  notes: z.string().max(4000).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
});

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:board:manage");
    const input = await parseJsonBody(request, createSchema);
    const requirement = await createComplianceRequirement({
      organizationId,
      ...input,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: requirement }, { status: 201 });
  });
}
