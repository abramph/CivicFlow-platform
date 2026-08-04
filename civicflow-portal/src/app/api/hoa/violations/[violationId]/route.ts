import { withApiErrorHandling } from "@/lib/api-route";
import { requireHoaViolationRead, requireHoaViolationWrite } from "@/lib/hoa/violations-guard";
import { getViolationDetail, updateViolationDraft } from "@/lib/hoa/violations";
import { parseJsonBody, z } from "@/lib/validation";

export async function GET(_request: Request, { params }: { params: Promise<{ violationId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireHoaViolationRead();
    const { violationId } = await params;
    const violation = await getViolationDetail(organizationId, violationId);
    return Response.json({ ok: true, data: violation });
  });
}

const updateSchema = z.object({
  violationType: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(5000).optional(),
  cureByDate: z.string().datetime().nullable().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ violationId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireHoaViolationWrite();
    const { violationId } = await params;
    const input = await parseJsonBody(request, updateSchema);
    const violation = await updateViolationDraft({
      organizationId,
      violationId,
      violationType: input.violationType,
      description: input.description,
      cureByDate: input.cureByDate === undefined ? undefined : input.cureByDate ? new Date(input.cureByDate) : null,
    });
    return Response.json({ ok: true, data: violation });
  });
}
