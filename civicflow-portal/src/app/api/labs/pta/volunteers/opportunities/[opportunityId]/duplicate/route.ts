import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { duplicatePtaVolunteerOpportunity, repeatPtaVolunteerOpportunity } from "@/lib/labs/pta/volunteers";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  // PTA-G recurrence: when repeat options are present, dated OPEN repeats
  // are created (times carried, shifted). Without them, the original
  // undated-DRAFT template copy is preserved unchanged.
  offsetDays: z.number().int().min(1).max(90).optional(),
  count: z.number().int().min(1).max(12).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ opportunityId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:volunteers:manage");
    const { opportunityId } = await params;
    const input = request.headers.get("content-type")?.includes("application/json")
      ? await parseJsonBody(request, bodySchema)
      : {};
    if (input.offsetDays) {
      const clones = await repeatPtaVolunteerOpportunity(
        organizationId,
        opportunityId,
        { offsetDays: input.offsetDays, count: input.count ?? 1 },
        session.userId,
        session.userEmail
      );
      return Response.json({ ok: true, data: clones });
    }
    const clone = await duplicatePtaVolunteerOpportunity(organizationId, opportunityId, session.userId, session.userEmail);
    return Response.json({ ok: true, data: clone });
  });
}
