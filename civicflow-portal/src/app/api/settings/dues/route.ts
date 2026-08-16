import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";

const updateDuesSettingsSchema = z.object({
  duesStartRule: z.enum(["JOIN_DATE", "FIRST_OF_NEXT_MONTH", "MANUAL"]),
  delinquentAfterMonths: z.number().int().min(1).max(120),
  delinquentAfterDays: z.union([z.number().int().min(1).max(3650), z.null()]).optional(),
  autoMarkDelinquent: z.boolean(),
  gracePeriodDays: z.number().int().min(0).max(365),
  autoSuspendAfterMonths: z.union([z.number().int().min(1).max(120), z.null()]).optional(),
  autoDeactivateAfterMonths: z.union([z.number().int().min(1).max(120), z.null()]).optional(),
  reminderFrequencyDays: z.union([z.number().int().min(1).max(365), z.null()]).optional(),
  financialEditWindowHours: z.number().int().min(0).max(8760),
  requireReasonForFinancialEdits: z.boolean(),
  allowFinanceCorrections: z.boolean(),
  lockReceiptsAfterIssue: z.boolean(),
  // UNION-WEB-DASH: presentation-only -- null means "unconfigured," never
  // guessed on the org's behalf (see schema.prisma's DuesCollectionMethod
  // doc comment).
  duesCollectionMethod: z.union([z.enum(["PAYROLL_DEDUCTION", "UNESTRA_DIRECT", "EXTERNAL", "MIXED", "NONE"]), z.null()]).optional(),
});

export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("dues:read", "throw");
    const settings = await prisma.orgSettings.upsert({
      where: { organizationId },
      update: {},
      create: { organizationId },
    });
    return Response.json({ ok: true, data: settings });
  });
}

export async function PATCH(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:settings:dues",
      request,
      limit: 20,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session, organizationId } = await requirePermission("org_settings:write", "throw");
    const input = await parseJsonBody(request, updateDuesSettingsSchema);
    const before = await prisma.orgSettings.upsert({
      where: { organizationId },
      update: {},
      create: { organizationId },
    });

    const settings = await prisma.orgSettings.update({
      where: { organizationId },
      data: input,
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "update",
      entityType: "dues_policy_settings",
      entityId: settings.id,
      metadata: { before, after: settings },
    });

    return Response.json({ ok: true, data: settings });
  });
}
