import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { sendPtaHouseholdAdultInviteEmail } from "@/lib/labs/pta/household-adult-invites";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { ValidationError } from "@/lib/validation";

/**
 * Officer-initiated invite for a household adult to create Unestra
 * mobile/web login credentials. No open self-signup surface — only officers
 * with pta:households:manage can trigger this, scoped to one specific
 * household adult in the caller's own organization. Mirrors
 * /api/members/[id]/invite.
 */
export async function POST(request: Request, { params }: { params: Promise<{ householdId: string; adultId: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:labs:pta:households:adults:invite",
      request,
      limit: 20,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session, organizationId } = await requirePtaAccess("pta:households:manage");
    const { householdId, adultId } = await params;

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
      createdByUserId: session.userId,
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "pta.household_adult.invited",
      entityType: "pta_household_adult",
      entityId: adult.id,
    });

    return Response.json({ ok: true });
  });
}
