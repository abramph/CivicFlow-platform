import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { getPtaVolunteerRequirement, upsertPtaVolunteerRequirement } from "@/lib/labs/pta/volunteers";
import { parseJsonBody, z } from "@/lib/validation";

export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePtaAccess("pta:directory:read");
    const url = new URL(request.url);
    const schoolYear = url.searchParams.get("schoolYear");
    if (!schoolYear) return Response.json({ ok: false, error: "schoolYear query parameter is required" }, { status: 400 });
    const requirement = await getPtaVolunteerRequirement(organizationId, schoolYear);
    return Response.json({ ok: true, data: requirement });
  });
}

const bodySchema = z.object({ schoolYear: z.string().min(1), requiredMinutes: z.number().int().min(0), active: z.boolean() });

/** Its mere absence means "this PTA doesn't use hour requirements" — see PtaVolunteerRequirement's schema doc comment. Every organization can leave this unconfigured. */
export async function PUT(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:volunteers:manage");
    const { schoolYear, requiredMinutes, active } = await parseJsonBody(request, bodySchema);
    const requirement = await upsertPtaVolunteerRequirement(organizationId, schoolYear, requiredMinutes, active, session.userId, session.userEmail);
    return Response.json({ ok: true, data: requirement });
  });
}
