import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { requireSuperAdmin, UnauthenticatedError } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { requireRateLimit } from "@/lib/rate-limit";
import {
  InternalTrialError,
  checkInternalTrialEligibility,
  grantInternalOrganizationTrial,
} from "@/lib/platform-operations/internal-trial";
import { parseJsonBody, z } from "@/lib/validation";

/** requireSuperAdmin("throw") alone always throws ForbiddenError (403), even
 * with zero session — collapsing "not authenticated" and "authenticated but
 * not platform admin" into one status. This route's spec calls for the two
 * to be distinguishable (401 vs 403), so an explicit session check runs
 * first; requireSuperAdmin still does the real role enforcement after. */
async function requireAuthenticatedSuperAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.userId) {
    throw new UnauthenticatedError();
  }
  return requireSuperAdmin("throw");
}

/** GET: read-only eligibility preview for the admin UI's pre-confirmation
 * panel — never mutates. Mirrors the primary-vertical route's GET preview. */
export async function GET(request: Request, { params }: { params: Promise<{ organizationId: string }> }) {
  return withApiErrorHandling(async () => {
    await requireAuthenticatedSuperAdmin();
    const { organizationId } = await params;

    try {
      const eligibility = await checkInternalTrialEligibility(organizationId);
      return Response.json({ ok: true, data: eligibility });
    } catch (error) {
      // Preserve the precise status (404 not-found, etc.) rather than
      // collapsing every InternalTrialError to 400 — this preview is read
      // by the admin UI to decide whether to show the grant control at all.
      if (error instanceof InternalTrialError) {
        return Response.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
      }
      throw error;
    }
  });
}

const bodySchema = z.object({
  /** Required — every internal trial grant must be explainable in the audit
   * trail. Duration, start, and end are deliberately NOT accepted here —
   * the server always computes a fixed 30-day window
   * (INTERNAL_TRIAL_DURATION_DAYS in internal-trial.ts). */
  reason: z.string().trim().min(1, "A reason is required to grant an internal trial.").max(2000),
  /** Explicit confirmation flag the UI must send — mirrors the primary-vertical
   * and Labs-enrollment routes' irreversibility-confirmation pattern. */
  confirm: z.literal(true),
});

/** POST: platform-admin grant of a one-time, 30-day, Stripe-free internal
 * trial. All eligibility/atomicity/anti-stacking/audit enforcement lives in
 * grantInternalOrganizationTrial() — this route only authenticates,
 * authorizes, rate-limits, validates, and translates errors to responses. */
export async function POST(request: Request, { params }: { params: Promise<{ organizationId: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:admin:organizations:internal-trial",
      request,
      limit: 10,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session } = await requireAuthenticatedSuperAdmin();
    const { organizationId } = await params;
    const input = await parseJsonBody(request, bodySchema);

    try {
      const result = await grantInternalOrganizationTrial({
        organizationId,
        actorUserId: session.userId,
        actorEmail: session.userEmail,
        actorRole: "SUPER_ADMIN",
        reason: input.reason,
      });
      return Response.json({ ok: true, data: result }, { status: 201 });
    } catch (error) {
      if (error instanceof InternalTrialError) {
        return Response.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
      }
      throw error;
    }
  });
}
