import { withApiErrorHandling } from "@/lib/api-route";
import { requireHoaViolationWrite } from "@/lib/hoa/violations-guard";
import { issueViolation } from "@/lib/hoa/violations";
import { parseJsonBody, z } from "@/lib/validation";

const issueSchema = z.object({
  noticeBody: z.string().min(1).max(5000),
  cureByDate: z.string().datetime().nullable().optional(),
});

/** DRAFT -> ISSUED: the only transition that also sends the resident's
 * first notice — kept as its own route rather than folded into the
 * generic transition route below, since it requires the extra noticeBody
 * input the others don't. */
export async function POST(request: Request, { params }: { params: Promise<{ violationId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireHoaViolationWrite();
    const { violationId } = await params;
    const input = await parseJsonBody(request, issueSchema);
    const violation = await issueViolation({
      organizationId,
      violationId,
      noticeBody: input.noticeBody,
      cureByDate: input.cureByDate === undefined ? undefined : input.cureByDate ? new Date(input.cureByDate) : null,
      actorUserId: session.userId,
    });
    return Response.json({ ok: true, data: violation });
  });
}
