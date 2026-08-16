import { withApiErrorHandling } from "@/lib/api-route";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";
import { resolvePublicSubmissionOrgId } from "@/lib/member-intake/submissions";
import { verifySubmissionCode } from "@/lib/member-intake/verification";
import { applySubmission } from "@/lib/member-intake/update-engine";
import { MemberIntakeError } from "@/lib/member-intake/errors";
import type { PublicSubmitOutcome } from "../../submit/route";

const bodySchema = z.object({ submissionId: z.string().trim().min(1), code: z.string().trim().min(1).max(20) });

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "public:member-intake:verify-confirm", request, limit: 10, windowMs: 10 * 60_000 });
    if (rateLimited) return rateLimited;

    const { token } = await params;
    const { submissionId, code } = await parseJsonBody(request, bodySchema);

    const organizationId = await resolvePublicSubmissionOrgId(token, submissionId);
    if (!organizationId) throw new MemberIntakeError("MEMBER_INTAKE_SUBMISSION_NOT_FOUND", "Submission not found.");

    const result = await verifySubmissionCode(organizationId, submissionId, code);
    if (!result.ok) {
      return Response.json({ ok: false, error: result.error }, { status: 400 });
    }

    const applied = await applySubmission(organizationId, submissionId, { userId: null, userEmail: null });
    const outcome: PublicSubmitOutcome = applied.status === "REVIEW_REQUIRED" ? "REVIEW_REQUIRED" : "UPDATE_APPLIED";
    return Response.json({ ok: true, data: { outcome, submissionId } });
  });
}
