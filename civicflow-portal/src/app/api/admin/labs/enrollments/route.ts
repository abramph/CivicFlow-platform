import { requireSuperAdmin } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { requireRateLimit } from "@/lib/rate-limit";
import {
  LabEnrollmentValidationError,
  setOrganizationLabEnrollment,
} from "@/lib/platform-operations/labs";
import { isLabFeatureKey } from "@/lib/labs/registry";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";

const bodySchema = z.object({
  organizationId: z.string().min(1),
  featureKey: z.string().min(1),
  status: z.enum(["ENABLED", "DISABLED", "PENDING", "SUSPENDED"]),
  notes: z.union([z.string().max(2000), z.literal(""), z.null()]).optional(),
  /** Explicit confirmation flag the UI must send — a stray/duplicate request without it is rejected rather than silently applied. */
  confirm: z.literal(true),
});

/**
 * PUT: super-admin management of a single organization's Labs enrollment.
 * Never touches Organization.plan, Stripe, Organization.billingExempt, or
 * any OrganizationMembership/RBAC row — see setOrganizationLabEnrollment.
 */
export async function PUT(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:admin:labs:enrollments",
      request,
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session } = await requireSuperAdmin("throw");
    const input = await parseJsonBody(request, bodySchema);

    if (!isLabFeatureKey(input.featureKey)) {
      throw new ValidationError(`Unknown Labs feature key: ${input.featureKey}`);
    }

    try {
      const result = await setOrganizationLabEnrollment({
        organizationId: input.organizationId,
        featureKey: input.featureKey,
        status: input.status,
        actorUserId: session.userId,
        actorEmail: session.userEmail,
        notes: input.notes ?? null,
      });
      return Response.json({ ok: true, data: result });
    } catch (error) {
      if (error instanceof LabEnrollmentValidationError) {
        throw new ValidationError(error.message);
      }
      throw error;
    }
  });
}
