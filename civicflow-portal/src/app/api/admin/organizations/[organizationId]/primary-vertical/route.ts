import { requireSuperAdmin } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { requireRateLimit } from "@/lib/rate-limit";
import {
  OrganizationVerticalChangeError,
  changeOrganizationPrimaryVertical,
  previewPrimaryVerticalChange,
} from "@/lib/platform-operations/organizations";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";

const verticalEnum = z.enum(["COMMUNITY", "PTA", "UNION", "HOA", "CHURCH"]);

/** GET: read-only impact preview for a proposed vertical change (Phase 7's
 * "preview the impact before changing") — takes ?to=<vertical>. */
export async function GET(request: Request, { params }: { params: Promise<{ organizationId: string }> }) {
  return withApiErrorHandling(async () => {
    await requireSuperAdmin("throw");
    const { organizationId } = await params;
    const url = new URL(request.url);
    const parsed = verticalEnum.safeParse(url.searchParams.get("to"));
    if (!parsed.success) throw new ValidationError("A valid target vertical (?to=) is required.");

    try {
      const preview = await previewPrimaryVerticalChange(organizationId, parsed.data);
      return Response.json({ ok: true, data: preview });
    } catch (error) {
      if (error instanceof OrganizationVerticalChangeError) throw new ValidationError(error.message);
      throw error;
    }
  });
}

const bodySchema = z.object({
  newVertical: verticalEnum,
  /** Required — a vertical correction must always be explainable in the
   * audit trail (Phase 5: "Require a written reason"). Rejects an empty or
   * whitespace-only string rather than silently accepting it. */
  reason: z.string().trim().min(1, "A reason is required to correct an organization's type.").max(2000),
  /** Explicit confirmation flag the UI must send — mirrors the Labs
   * enrollment PUT route's pattern (see /api/admin/labs/enrollments). */
  confirm: z.literal(true),
});

/** PUT: super-admin change of an organization's primary vertical. Never
 * touches plan, billingExempt, Labs enrollment, or any PTA/Union/HOA data —
 * see changeOrganizationPrimaryVertical. */
export async function PUT(request: Request, { params }: { params: Promise<{ organizationId: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:admin:organizations:primary-vertical",
      request,
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session } = await requireSuperAdmin("throw");
    const { organizationId } = await params;
    const input = await parseJsonBody(request, bodySchema);

    try {
      const result = await changeOrganizationPrimaryVertical({
        organizationId,
        newVertical: input.newVertical,
        actorUserId: session.userId,
        actorEmail: session.userEmail,
        reason: input.reason,
      });
      return Response.json({ ok: true, data: result });
    } catch (error) {
      if (error instanceof OrganizationVerticalChangeError) throw new ValidationError(error.message);
      throw error;
    }
  });
}
