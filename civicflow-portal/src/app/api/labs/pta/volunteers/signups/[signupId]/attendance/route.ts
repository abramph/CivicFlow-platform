import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { setPtaVolunteerAttendanceStatus } from "@/lib/labs/pta/volunteers";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  status: z.enum(["ATTENDED", "PARTIAL", "NO_SHOW", "EXCUSED"]),
  manualMinutes: z.number().int().min(0).nullable().optional(),
  notes: z.string().nullable().optional(),
});

/** Marking ATTENDED/PARTIAL generates a PENDING volunteer-hours ledger entry; NO_SHOW/EXCUSED never do — see setPtaVolunteerAttendanceStatus()'s doc comment for the exact credit precedence. */
export async function POST(request: Request, { params }: { params: Promise<{ signupId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:volunteers:checkin");
    const { signupId } = await params;
    const { status, manualMinutes, notes } = await parseJsonBody(request, bodySchema);
    const result = await setPtaVolunteerAttendanceStatus(organizationId, signupId, status, session.userId, { manualMinutes, notes }, session.userEmail);
    return Response.json({ ok: true, data: result });
  });
}
