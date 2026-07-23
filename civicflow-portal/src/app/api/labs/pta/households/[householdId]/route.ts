import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { getPtaHousehold, updatePtaHousehold, deactivatePtaHousehold } from "@/lib/labs/pta/households";
import { parseJsonBody, z } from "@/lib/validation";

export async function GET(_request: Request, { params }: { params: Promise<{ householdId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePtaAccess("pta:directory:read");
    const { householdId } = await params;
    const household = await getPtaHousehold(organizationId, householdId);
    return Response.json({ ok: true, data: household });
  });
}

const updateSchema = z.object({
  displayName: z.string().min(1).optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "PENDING"]).optional(),
  volunteerInterests: z.array(z.string()).optional(),
  notes: z.string().nullable().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ householdId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:households:manage");
    const { householdId } = await params;
    const input = await parseJsonBody(request, updateSchema);
    const household = await updatePtaHousehold({ organizationId, householdId, actorUserId: session.userId, actorEmail: session.userEmail, ...input });
    return Response.json({ ok: true, data: household });
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ householdId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:households:manage");
    const { householdId } = await params;
    const household = await deactivatePtaHousehold(organizationId, householdId, session.userId, session.userEmail);
    return Response.json({ ok: true, data: household });
  });
}
