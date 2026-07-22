import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { createPtaHousehold, listPtaHouseholds } from "@/lib/labs/pta/households";
import { parseJsonBody, z } from "@/lib/validation";

const createSchema = z.object({
  displayName: z.string().min(1),
  schoolYear: z.string().min(1),
  status: z.enum(["ACTIVE", "INACTIVE", "PENDING"]).optional(),
  volunteerInterests: z.array(z.string()).optional(),
  notes: z.string().nullable().optional(),
});

export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePtaAccess("pta:directory:read");
    const url = new URL(request.url);
    const households = await listPtaHouseholds(organizationId, {
      schoolYear: url.searchParams.get("schoolYear") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
    });
    return Response.json({ ok: true, data: households });
  });
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:households:manage");
    const input = await parseJsonBody(request, createSchema);
    const household = await createPtaHousehold({ organizationId, actorUserId: session.userId, actorEmail: session.userEmail, ...input });
    return Response.json({ ok: true, data: household });
  });
}
