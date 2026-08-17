import { withApiErrorHandling } from "@/lib/api-route";
import { requireMemberIntakeView } from "@/lib/member-intake/forms";
import { getSubmissionDetail } from "@/lib/member-intake/review";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireMemberIntakeView();
    const { id } = await params;
    const detail = await getSubmissionDetail(organizationId, id);
    return Response.json({ ok: true, data: detail });
  });
}
