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

/** `.strict()` — an unknown property (duration, trialEndsAt, billingExempt, a
 * Stripe identifier, anything) fails validation with 400 rather than being
 * silently dropped. The server remains the only source of trial duration
 * and timestamps; this schema has no field a client could use to influence
 * either, so there is nothing to strip, only unknown keys to reject. */
const bodySchema = z
  .object({
    /** Required — every internal trial grant must be explainable in the
     * audit trail. A short min length rejects placeholder/noise input
     * ("x", "n/a") without being so strict it rejects genuine short
     * reasons; max length keeps the audit metadata bounded. */
    reason: z
      .string()
      .trim()
      .min(10, "A meaningful reason (at least 10 characters) is required to grant an internal trial.")
      .max(500, "Reason must be 500 characters or fewer."),
    /** Explicit confirmation flag the UI must send — mirrors the primary-vertical
     * and Labs-enrollment routes' irreversibility-confirmation pattern. */
    confirm: z.literal(true),
  })
  .strict();

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
