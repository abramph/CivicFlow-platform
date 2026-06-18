import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { parseJsonBody, z, ValidationError } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";

const schema = z.object({
  amountCents: z.number().int().min(0),
  date: z.string().nullable().optional(),
});

export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("org_settings:read", "throw");
    const settings = await prisma.orgSettings.findUnique({
      where: { organizationId },
      select: { openingBalanceCents: true, openingBalanceDate: true },
    });
    return Response.json({
      ok: true,
      data: {
        amountCents: settings?.openingBalanceCents ?? 0,
        date: settings?.openingBalanceDate?.toISOString().slice(0, 10) ?? null,
      },
    });
  });
}

export async function PATCH(request: Request) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("org_settings:write", "throw");
    const input = await parseJsonBody(request, schema);

    if (input.amountCents < 0) throw new ValidationError("Opening balance cannot be negative.");

    const date = input.date ? new Date(input.date) : null;

    await prisma.orgSettings.upsert({
      where: { organizationId },
      create: {
        organizationId,
        openingBalanceCents: input.amountCents,
        openingBalanceDate: date,
      },
      update: {
        openingBalanceCents: input.amountCents,
        openingBalanceDate: date,
      },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "update",
      entityType: "org_settings",
      metadata: { field: "openingBalance", amountCents: input.amountCents, date: input.date },
    });

    return Response.json({ ok: true });
  });
}
