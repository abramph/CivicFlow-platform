import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { parseJsonBody, z, ValidationError } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { createMemberTimelineEvent } from "@/lib/member-timeline";

const createContributionSchema = z.object({
  memberId: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
  campaignId: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
  eventId: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
  amount: z.number().positive(),
  contributionDate: z.string().datetime(),
  paymentMethod: z
    .enum([
      "CASH",
      "CHECK",
      "CREDIT_CARD",
      "DEBIT_CARD",
      "CARD",
      "ACH",
      "ZELLE",
      "CASH_APP",
      "VENMO",
      "PAYPAL",
      "STRIPE",
      "OTHER",
    ])
    .optional(),
  source: z.enum(["MEMBER_PROFILE", "CAMPAIGN_PAGE", "EVENT_PAGE", "MANUAL", "IMPORT"]),
  receiptRequested: z.boolean().optional(),
  notes: z.union([z.string().max(4000), z.literal(""), z.null()]).optional(),
});

export async function GET() {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("contributions:read", "throw");

    const rows = await prisma.contribution.findMany({
      where: { organizationId },
      orderBy: [{ contributionDate: "desc" }, { createdAt: "desc" }],
      include: { member: true, campaign: true, event: true },
      take: 200,
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "list",
      entityType: "contribution",
      metadata: { count: rows.length },
    });

    return Response.json({ ok: true, data: rows });
  });
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:contributions:write",
      request,
      limit: 50,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session, organizationId } = await requirePermission("contributions:write", "throw");
    const input = await parseJsonBody(request, createContributionSchema);
    const memberId = input.memberId || null;
    const campaignId = input.campaignId || null;
    const eventId = input.eventId || null;
    const notes = typeof input.notes === "string" ? input.notes.trim() || null : input.notes ?? null;

    // Attribution rule:
    // - CAMPAIGN_PAGE / EVENT_PAGE / MEMBER_PROFILE must include memberId
    // - MANUAL / IMPORT may omit memberId (for external or unattributed entries)
    if ((input.source === "CAMPAIGN_PAGE" || input.source === "EVENT_PAGE" || input.source === "MEMBER_PROFILE") && !memberId) {
      throw new ValidationError("memberId is required for campaign/event/member-profile contributions");
    }

    if (memberId) {
      const member = await prisma.orgMember.findFirst({ where: { id: memberId, organizationId } });
      if (!member) {
        return Response.json({ ok: false, error: "Member not found in organization" }, { status: 404 });
      }
    }

    if (campaignId) {
      const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, organizationId } });
      if (!campaign) {
        return Response.json({ ok: false, error: "Campaign not found in organization" }, { status: 404 });
      }
    }

    if (eventId) {
      const event = await prisma.event.findFirst({ where: { id: eventId, organizationId } });
      if (!event) {
        return Response.json({ ok: false, error: "Event not found in organization" }, { status: 404 });
      }
    }

    const row = await prisma.contribution.create({
      data: {
        organizationId,
        memberId,
        campaignId,
        eventId,
        amount: input.amount,
        contributionDate: new Date(input.contributionDate),
        paymentMethod: input.paymentMethod ?? null,
        source: input.source,
        receiptRequested: input.receiptRequested ?? false,
        notes,
        createdByUserId: session.userId,
      },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "create",
      entityType: "contribution",
      entityId: row.id,
      metadata: {
        amount: row.amount.toString(),
        source: row.source,
        memberId: row.memberId,
        campaignId: row.campaignId,
        eventId: row.eventId,
        paymentMethod: row.paymentMethod,
        receiptRequested: row.receiptRequested,
      },
    });

    if (row.memberId) {
      await createMemberTimelineEvent({
        organizationId,
        memberId: row.memberId,
        eventType: "CONTRIBUTION_RECORDED",
        title: "Contribution recorded",
        newValue: { contributionId: row.id, amount: row.amount.toString(), paymentMethod: row.paymentMethod },
        occurredAt: row.contributionDate,
        createdByUserId: session.userId,
      });
    }

    return Response.json({ ok: true, data: row }, { status: 201 });
  });
}
