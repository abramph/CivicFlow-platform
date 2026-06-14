import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { parseJsonBody, z } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { requireRateLimit } from "@/lib/rate-limit";

const createReminderSchema = z.object({
  memberId: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
  reminderType: z.enum([
    "DUES_DELINQUENT",
    "DUES_UPCOMING",
    "CONTRIBUTION_RECEIPT",
    "MEMBERSHIP_RENEWAL",
  ]),
  recipientEmail: z.union([z.string().trim().email(), z.literal(""), z.null()]).optional(),
  subject: z.union([z.string().trim().max(255), z.literal(""), z.null()]).optional(),
  bodyPreview: z.union([z.string().trim().max(4000), z.literal(""), z.null()]).optional(),
  message: z.union([z.string().trim().max(4000), z.literal(""), z.null()]).optional(),
  status: z.enum(["QUEUED", "SENT", "FAILED", "SKIPPED"]).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

function normalizeOptionalText(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export async function GET() {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("reminders:read", "throw");

    const rows = await prisma.emailReminderLog.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: "desc" }],
      include: { member: true },
      take: 200,
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "list",
      entityType: "reminder_log",
      metadata: { count: rows.length },
    });

    return Response.json({ ok: true, data: rows });
  });
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:reminders:send",
      request,
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session, organizationId } = await requirePermission("reminders:send", "throw");
    const input = await parseJsonBody(request, createReminderSchema);
    const memberId = normalizeOptionalText(input.memberId);
    const recipientEmail = normalizeOptionalText(input.recipientEmail);
    const subject = normalizeOptionalText(input.subject);
    const bodyPreview = normalizeOptionalText(input.bodyPreview ?? input.message);

    if (memberId) {
      const member = await prisma.orgMember.findFirst({ where: { id: memberId, organizationId } });
      if (!member) {
        return Response.json({ ok: false, error: "Member not found in organization" }, { status: 404 });
      }
    }

    const row = await prisma.emailReminderLog.create({
      data: {
        organizationId,
        memberId,
        reminderType: input.reminderType,
        status: input.status ?? "QUEUED",
        recipientEmail,
        subject,
        bodyPreview,
        metadata: input.metadata as Prisma.InputJsonValue | undefined,
        createdByUserId: session.userId,
      },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "create",
      entityType: "reminder_log",
      entityId: row.id,
      metadata: {
        reminderType: row.reminderType,
        status: row.status,
        recipientEmail: row.recipientEmail,
      },
    });

    return Response.json({ ok: true, data: row }, { status: 201 });
  });
}
