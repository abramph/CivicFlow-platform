import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { parseJsonBody, z } from "@/lib/validation";

const optionalId = z.union([z.string().min(1), z.literal(""), z.null()]).optional();
const optionalText = (max: number) =>
  z.union([z.string().trim().max(max), z.literal(""), z.null()]).optional();

const updateCommunicationSchema = z.object({
  memberId: optionalId,
  campaignId: optionalId,
  eventId: optionalId,
  communicationType: z.enum(["EMAIL", "SMS", "PHONE_CALL", "VOICEMAIL", "IN_PERSON", "LETTER", "WHATSAPP", "OTHER"]).optional(),
  direction: z.enum(["OUTBOUND", "INBOUND", "INTERNAL_NOTE"]).optional(),
  subject: optionalText(255),
  message: optionalText(8000),
  body: optionalText(8000),
  outcome: optionalText(1000),
  followUpRequired: z.boolean().optional(),
  followUpDate: z.union([z.string().datetime(), z.literal(""), z.null()]).optional(),
  communicationDate: z.string().datetime().optional(),
});

function text(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("communications:read", "throw");
    const { id } = await params;
    const row = await prisma.communicationLog.findFirst({
      where: { id, organizationId },
      include: { member: true, campaign: true, event: true, createdBy: true },
    });
    if (!row) return Response.json({ ok: false, error: "Communication not found" }, { status: 404 });
    return Response.json({ ok: true, data: row });
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("communications:write", "throw");
    const { id } = await params;
    const input = await parseJsonBody(request, updateCommunicationSchema);

    const existing = await prisma.communicationLog.findFirst({ where: { id, organizationId } });
    if (!existing) return Response.json({ ok: false, error: "Communication not found" }, { status: 404 });

    const memberId = text(input.memberId);
    const campaignId = text(input.campaignId);
    const eventId = text(input.eventId);
    if (memberId && !(await prisma.orgMember.findFirst({ where: { id: memberId, organizationId }, select: { id: true } }))) {
      return Response.json({ ok: false, error: "Member not found in organization" }, { status: 404 });
    }
    if (campaignId && !(await prisma.campaign.findFirst({ where: { id: campaignId, organizationId }, select: { id: true } }))) {
      return Response.json({ ok: false, error: "Campaign not found in organization" }, { status: 404 });
    }
    if (eventId && !(await prisma.event.findFirst({ where: { id: eventId, organizationId }, select: { id: true } }))) {
      return Response.json({ ok: false, error: "Event not found in organization" }, { status: 404 });
    }

    const updated = await prisma.communicationLog.update({
      where: { id },
      data: {
        ...(input.memberId !== undefined ? { memberId } : {}),
        ...(input.campaignId !== undefined ? { campaignId } : {}),
        ...(input.eventId !== undefined ? { eventId } : {}),
        ...(input.communicationType !== undefined ? { communicationType: input.communicationType } : {}),
        ...(input.direction !== undefined ? { direction: input.direction } : {}),
        ...(input.subject !== undefined ? { subject: text(input.subject) } : {}),
        ...(input.message !== undefined || input.body !== undefined ? { message: text(input.message ?? input.body) } : {}),
        ...(input.outcome !== undefined ? { outcome: text(input.outcome) } : {}),
        ...(input.followUpRequired !== undefined ? { followUpRequired: input.followUpRequired } : {}),
        ...(input.followUpDate !== undefined ? { followUpDate: input.followUpDate ? new Date(input.followUpDate) : null } : {}),
        ...(input.communicationDate !== undefined ? { communicationDate: new Date(input.communicationDate) } : {}),
      },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "update",
      entityType: "communication_log",
      entityId: updated.id,
      metadata: { before: existing, after: updated },
    });

    return Response.json({ ok: true, data: updated });
  });
}
