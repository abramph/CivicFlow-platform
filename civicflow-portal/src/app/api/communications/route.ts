import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { parseJsonBody, z } from "@/lib/validation";
import { createMemberTimelineEvent } from "@/lib/member-timeline";

const optionalId = z.union([z.string().min(1), z.literal(""), z.null()]).optional();
const optionalText = (max: number) =>
  z.union([z.string().trim().max(max), z.literal(""), z.null()]).optional();

const communicationSchema = z.object({
  memberId: optionalId,
  campaignId: optionalId,
  eventId: optionalId,
  communicationType: z.enum([
    "EMAIL",
    "SMS",
    "PHONE_CALL",
    "VOICEMAIL",
    "IN_PERSON",
    "LETTER",
    "WHATSAPP",
    "OTHER",
  ]),
  direction: z.enum(["OUTBOUND", "INBOUND", "INTERNAL_NOTE"]),
  subject: optionalText(255),
  message: optionalText(8000),
  body: optionalText(8000),
  outcome: optionalText(1000),
  followUpRequired: z.boolean().optional(),
  followUpDate: z.union([z.string().datetime(), z.literal(""), z.null()]).optional(),
  communicationDate: z.string().datetime(),
});

function text(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

async function ensureScopedReference(
  organizationId: string,
  type: "member" | "campaign" | "event",
  id: string | null | undefined
) {
  if (!id) return;
  const found =
    type === "member"
      ? await prisma.orgMember.findFirst({ where: { id, organizationId }, select: { id: true } })
      : type === "campaign"
        ? await prisma.campaign.findFirst({ where: { id, organizationId }, select: { id: true } })
        : await prisma.event.findFirst({ where: { id, organizationId }, select: { id: true } });

  if (!found) {
    throw new Error(`${type} not found in organization`);
  }
}

export async function GET() {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("communications:read", "throw");

    const rows = await prisma.communicationLog.findMany({
      where: { organizationId },
      orderBy: [{ communicationDate: "desc" }, { createdAt: "desc" }],
      include: { member: true, campaign: true, event: true },
      take: 200,
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "list",
      entityType: "communication_log",
      metadata: { count: rows.length },
    });

    return Response.json({ ok: true, data: rows });
  });
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("communications:write", "throw");
    const input = await parseJsonBody(request, communicationSchema);
    const memberId = text(input.memberId);
    const campaignId = text(input.campaignId);
    const eventId = text(input.eventId);

    await ensureScopedReference(organizationId, "member", memberId);
    await ensureScopedReference(organizationId, "campaign", campaignId);
    await ensureScopedReference(organizationId, "event", eventId);

    const row = await prisma.communicationLog.create({
      data: {
        organizationId,
        memberId,
        campaignId,
        eventId,
        createdByUserId: session.userId,
        communicationType: input.communicationType,
        direction: input.direction,
        subject: text(input.subject),
        message: text(input.message ?? input.body),
        outcome: text(input.outcome),
        followUpRequired: input.followUpRequired ?? false,
        followUpDate: input.followUpDate ? new Date(input.followUpDate) : null,
        communicationDate: new Date(input.communicationDate),
      },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "create",
      entityType: "communication_log",
      entityId: row.id,
      metadata: {
        communicationType: row.communicationType,
        direction: row.direction,
        memberId: row.memberId,
        followUpRequired: row.followUpRequired,
      },
    });

    if (row.memberId) {
      await createMemberTimelineEvent({
        organizationId,
        memberId: row.memberId,
        eventType: "COMMUNICATION_LOGGED",
        title: "Communication logged",
        description: row.subject,
        newValue: { communicationId: row.id, communicationType: row.communicationType, direction: row.direction },
        occurredAt: row.communicationDate,
        createdByUserId: session.userId,
      });
    }

    return Response.json({ ok: true, data: row }, { status: 201 });
  });
}
