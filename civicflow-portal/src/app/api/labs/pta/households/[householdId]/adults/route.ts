import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { addPtaHouseholdAdult } from "@/lib/labs/pta/households";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  name: z.string().min(1),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  relationshipLabel: z.string().nullable().optional(),
  makePrimaryContact: z.boolean().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ householdId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:households:manage");
    const { householdId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const adult = await addPtaHouseholdAdult({ organizationId, householdId, actorUserId: session.userId, actorEmail: session.userEmail, ...input });
    return Response.json({ ok: true, data: adult });
  });
}
