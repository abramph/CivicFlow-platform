import { withApiErrorHandling } from "@/lib/api-route";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";
import { resolvePublicSubmissionOrgId } from "@/lib/member-intake/submissions";
import { requestVerification } from "@/lib/member-intake/verification";
import { MemberIntakeError } from "@/lib/member-intake/errors";
import { resolveOrganizationAccess } from "@/lib/subscription-gate";

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

    // E2E-1/E2E-5 finding: this is the "resend code" action -- an anonymous
    // caller could trigger it repeatedly (rate-limited, but still a real
    // SMS/email send) with no billing check at all, unlike its sibling
    // submit/verify-confirm routes. Same collapse-to-not-found response as
    // those, so a billing-inactive org is never distinguishable from an
    // unknown submission to an anonymous caller.
    const access = await resolveOrganizationAccess(organizationId);
    if (!access.allowed) {
      throw new MemberIntakeError("MEMBER_INTAKE_SUBMISSION_NOT_FOUND", "Submission not found.");
    }

    const verification = await requestVerification(organizationId, submissionId);
    return Response.json({ ok: true, data: { channel: verification.channel, maskedDestination: verification.maskedDestination } });
  });
}
