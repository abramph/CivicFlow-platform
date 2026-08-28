import { withApiErrorHandling } from "@/lib/api-route";
import { reverseHourEntry } from "@/lib/labs/pta/volunteer-hours/corrections";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  minuteAdjustment: z.number().int(),
  reason: z.string().min(1).max(2000),
});

/** POST — corrects/reverses an already-approved hour entry. If an
 * assessment was already posted for this family, the correction still
 * proceeds but is flagged for review (spec §21) — never auto-charges. */
export async function POST(request: Request, { params }: { params: Promise<{ entryId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireVolunteerHoursAccess("pta:volunteer-requirements:adjust-family", "requirements");
    const { entryId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const result = await reverseHourEntry(organizationId, entryId, input.minuteAdjustment, input.reason, {
      userId: session.userId,
      userEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: result });
  });
}
