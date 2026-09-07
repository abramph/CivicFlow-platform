import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { sendPtaHouseholdAdultInviteEmail } from "@/lib/labs/pta/household-adult-invites";
import { requireMobilePtaHouseholdsPermission } from "@/lib/mobile-admin-pta";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { PERMISSIONS } from "@/lib/rbac";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";

const inviteSchema = z.object({ organizationId: z.string().min(1) });

type RouteParams = { params: Promise<{ householdId: string; adultId: string }> };

/**
 * POST /api/mobile/admin/pta/households/[householdId]/adults/[adultId]/invite
 *
 * Mobile counterpart of the web officer-invite route
 * (src/app/api/labs/pta/households/[householdId]/adults/[adultId]/invite) —
 * same service (sendPtaHouseholdAdultInviteEmail), same single-use hashed
 * token, same audit action, so neither surface can drift. This is what lets
 * an administrator who is also a parent get their own household linked from
 * the app (Build 27 dual-role work): the adult accepts the emailed invite
 * through the existing PR #85 accept flow, which is the ONLY path that ever
 * sets PtaHouseholdAdult.userId — no email-match shortcut, no self-link.
 */
export async function POST(request: Request, { params }: RouteParams) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:mobile:admin:pta:households:adults:invite",
      request,
      limit: 20,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { householdId, adultId } = await params;
    const { organizationId } = await parseJsonBody(request, inviteSchema);
    const { userId, email } = await requireMobilePtaHouseholdsPermission(request, organizationId, PERMISSIONS.PTA_HOUSEHOLDS_MANAGE);

    const adult = await prisma.ptaHouseholdAdult.findFirst({ where: { id: adultId, householdId, organizationId } });
    if (!adult) {
      return Response.json({ ok: false, error: "Household adult not found" }, { status: 404 });
    }
    if (adult.userId) {
      throw new ValidationError("This person already has app login credentials.");
    }
    if (!adult.email) {
      throw new ValidationError("Add an email address for this person before sending an app invite.");
    }

    const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });

    await sendPtaHouseholdAdultInviteEmail({
      householdAdult: { id: adult.id, email: adult.email, name: adult.name },
      organizationId,
      organizationName: org?.name ?? null,
      createdByUserId: userId,
    });

    await createAuditEvent({
      organizationId,
      actorUserId: userId,
      actorEmail: email,
      action: "pta.household_adult.invited",
      entityType: "pta_household_adult",
      entityId: adult.id,
    });

    return Response.json({ ok: true });
  });
}
