import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { createPtaDuesCharge, getPtaHouseholdDuesStatus } from "@/lib/labs/pta/dues";
import { parseJsonBody, z } from "@/lib/validation";

export async function GET(_request: Request, { params }: { params: Promise<{ householdId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePtaAccess("pta:dues:manage");
    const { householdId } = await params;
    const status = await getPtaHouseholdDuesStatus(organizationId, householdId);
    return Response.json({ ok: true, data: status });
  });
}

const bodySchema = z.object({
  amountCents: z.number().int().positive(),
  schoolYear: z.string().min(1),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  dueDate: z.coerce.date(),
});

export async function POST(request: Request, { params }: { params: Promise<{ householdId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:dues:manage");
    const { householdId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const charge = await createPtaDuesCharge({ organizationId, householdId, actorUserId: session.userId, actorEmail: session.userEmail, ...input });
    return Response.json({ ok: true, data: charge });
  });
}
