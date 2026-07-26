import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { updatePtaVolunteerSlot, deletePtaVolunteerSlot } from "@/lib/labs/pta/volunteers";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  label: z.string().nullable().optional(),
  startAt: z.coerce.date().nullable().optional(),
  endAt: z.coerce.date().nullable().optional(),
  capacity: z.number().int().min(1).optional(),
  minNeeded: z.number().int().min(0).nullable().optional(),
  defaultCreditedMinutes: z.number().int().min(0).nullable().optional(),
  locationOverride: z.string().nullable().optional(),
  status: z.enum(["OPEN", "CLOSED", "CANCELLED"]).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ slotId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:volunteers:manage");
    const { slotId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const slot = await updatePtaVolunteerSlot(organizationId, slotId, input, session.userId, session.userEmail);
    return Response.json({ ok: true, data: slot });
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ slotId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:volunteers:manage");
    const { slotId } = await params;
    await deletePtaVolunteerSlot(organizationId, slotId, session.userId, session.userEmail);
    return Response.json({ ok: true });
  });
}
