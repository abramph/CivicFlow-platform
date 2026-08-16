import { withApiErrorHandling } from "@/lib/api-route";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";
import { resolvePublicSubmissionOrgId } from "@/lib/member-intake/submissions";
import { requestVerification } from "@/lib/member-intake/verification";
import { MemberIntakeError } from "@/lib/member-intake/errors";

const bodySchema = z.object({ submissionId: z.string().trim().min(1) });

/** "Resend code" -- the initial code is already sent by the submit route;
 * this is the same operation, callable again for a lost/expired code. */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "public:member-intake:verify-request", request, limit: 5, windowMs: 10 * 60_000 });
    if (rateLimited) return rateLimited;

    const { token } = await params;
    const { submissionId } = await parseJsonBody(request, bodySchema);

    const organizationId = await resolvePublicSubmissionOrgId(token, submissionId);
    if (!organizationId) throw new MemberIntakeError("MEMBER_INTAKE_SUBMISSION_NOT_FOUND", "Submission not found.");

    const verification = await requestVerification(organizationId, submissionId);
    return Response.json({ ok: true, data: { channel: verification.channel, maskedDestination: verification.maskedDestination } });
  });
}
