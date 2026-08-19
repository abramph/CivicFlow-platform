import { requireSuperAdmin } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { requireRateLimit } from "@/lib/rate-limit";
import { getAdminSeatOverrideDetail } from "@/lib/admin-seat-override";
import { setAdminSeatOverride, removeAdminSeatOverride } from "@/lib/admin-seat-override";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";

/** GET: platform-admin read of an organization's full admin-seat detail,
 * including who/when/why the current override (if any) was set. */
export async function GET(_request: Request, { params }: { params: Promise<{ organizationId: string }> }) {
  return withApiErrorHandling(async () => {
    await requireSuperAdmin("throw");
    const { organizationId } = await params;
    const detail = await getAdminSeatOverrideDetail(organizationId);
    return Response.json({ ok: true, data: detail });
  });
}

const putSchema = z.object({
  newOverride: z.number().int().min(0).max(10_000),
  reason: z.string().trim().min(1, "A reason is required.").max(2000),
  /** Date-only or full ISO string; null clears any expiration (permanent). */
  expiresAt: z.string().trim().min(1).nullable(),
});

/** PUT: platform-admin grant/change of an organization's admin-seat
 * override. Never reachable from any org-facing route — org admins cannot
 * edit their own org's override, by construction (no org-scoped route calls
 * setAdminSeatOverride at all). */
export async function PUT(request: Request, { params }: { params: Promise<{ organizationId: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:admin:organizations:admin-seats",
      request,
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session } = await requireSuperAdmin("throw");
    const { organizationId } = await params;
    const input = await parseJsonBody(request, putSchema);

    let expiresAt: Date | null = null;
    if (input.expiresAt) {
      const parsed = new Date(input.expiresAt);
      if (Number.isNaN(parsed.getTime())) throw new ValidationError("expiresAt must be a valid date.");
      expiresAt = parsed;
    }

    const result = await setAdminSeatOverride({
      organizationId,
      newOverride: input.newOverride,
      reason: input.reason,
      expiresAt,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: result });
  });
}

const deleteSchema = z.object({
  reason: z.string().trim().min(1, "A reason is required.").max(2000),
});

/** DELETE: platform-admin removal of an organization's admin-seat override
 * (back to 0, base included seats only). */
export async function DELETE(request: Request, { params }: { params: Promise<{ organizationId: string }> }) {
  return withApiErrorHandling(async () => {
    const { session } = await requireSuperAdmin("throw");
    const { organizationId } = await params;
    const input = await parseJsonBody(request, deleteSchema);

    const result = await removeAdminSeatOverride({
      organizationId,
      reason: input.reason,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: result });
  });
}
