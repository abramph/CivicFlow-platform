import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { manuallyAssignPtaVolunteer } from "@/lib/labs/pta/volunteers";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  householdAdultId: z.string().min(1),
  overrideCapacity: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});

/** Officer-initiated assignment — capacity override, when used, is always audited (see manuallyAssignPtaVolunteer's own doc comment) and never silent. */
export async function POST(request: Request, { params }: { params: Promise<{ slotId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:volunteers:manage");
    const { slotId } = await params;
    const { householdAdultId, overrideCapacity, notes } = await parseJsonBody(request, bodySchema);
    const signup = await manuallyAssignPtaVolunteer(
      organizationId,
      slotId,
      householdAdultId,
      session.userId,
      { overrideCapacity, notes: notes ?? null },
      session.userEmail
    );
    return Response.json({ ok: true, data: signup });
  });
}
