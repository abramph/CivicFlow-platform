import { withApiErrorHandling } from "@/lib/api-route";
import { getClientIp, requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";
import { resolvePublicIntakeForm } from "@/lib/member-intake/forms";
import { recordSubmission } from "@/lib/member-intake/submissions";
import { requestVerification } from "@/lib/member-intake/verification";
import { applySubmission } from "@/lib/member-intake/update-engine";

const bodySchema = z.object({
  fieldValues: z.record(z.string(), z.unknown()),
  // Nullable, not just optional: the public form client always sends this
  // key (its `sourceToken` prop defaults to null for a direct/no-source
  // link, not undefined) -- z.string().optional() alone rejects an
  // explicit null, which made every direct-link submission (i.e. anyone
  // who didn't arrive via a QR source) 400 in production. Found live during
  // MEMBER-QR-L smoke testing.
  sourceToken: z.union([z.string().trim().min(1), z.null()]).optional(),
});

export type PublicSubmitOutcome = "NEW_MEMBER_CREATED" | "UPDATE_APPLIED" | "VERIFICATION_REQUIRED" | "REVIEW_REQUIRED";

/**
 * The single mutation entry point for the public form -- every failure mode
 * (unknown/inactive/expired token) collapses to the same 404 as
 * resolvePublicIntakeForm(), so this route never distinguishes "no such
 * form" from "form exists but isn't accepting submissions right now" to an
 * anonymous caller. Treats all input as hostile: rate-limited by IP,
 * organizationId/formId are ALWAYS resolved server-side from the token,
 * never accepted from the request body.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "public:member-intake:submit", request, limit: 10, windowMs: 10 * 60_000 });
    if (rateLimited) return rateLimited;

    const { token } = await params;
    const publicForm = await resolvePublicIntakeForm(token);
    if (!publicForm) return Response.json({ ok: false, error: "This form isn't available." }, { status: 404 });

    const input = await parseJsonBody(request, bodySchema);
    const recorded = await recordSubmission({
      formId: publicForm.id,
      sourceToken: input.sourceToken ?? null,
      fieldValues: input.fieldValues,
      ipAddress: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });

    if (recorded.status === "VERIFICATION_REQUIRED") {
      const verification = await requestVerification(publicForm.organizationId, recorded.submissionId);
      return Response.json({
        ok: true,
        data: {
          outcome: "VERIFICATION_REQUIRED" satisfies PublicSubmitOutcome,
          submissionId: recorded.submissionId,
          verification: { channel: verification.channel, maskedDestination: verification.maskedDestination },
        },
      });
    }

    if (recorded.status === "SUBMITTED") {
      const applied = await applySubmission(publicForm.organizationId, recorded.submissionId, { userId: null, userEmail: null });
      const outcome: PublicSubmitOutcome =
        applied.status === "REVIEW_REQUIRED" ? "REVIEW_REQUIRED" : recorded.matchedMemberId ? "UPDATE_APPLIED" : "NEW_MEMBER_CREATED";
      return Response.json({ ok: true, data: { outcome, submissionId: recorded.submissionId } });
    }

    // REVIEW_REQUIRED (possible/multiple match, or no-auto-create policy) --
    // nothing to apply yet; an admin resolves it from the review queue.
    return Response.json({ ok: true, data: { outcome: "REVIEW_REQUIRED" satisfies PublicSubmitOutcome, submissionId: recorded.submissionId } });
  });
}
