import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { generateMissingDuesChargesForOrganization } from "@/lib/dues-accrual";
import { evaluateOrganizationDelinquency } from "@/lib/member-delinquency";
import { generateDuesForMember } from "@/lib/dues-generate-member";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";

const generateDuesSchema = z.object({
  memberId: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
  startDate: z.union([z.string().datetime(), z.literal(""), z.null()]).optional(),
  endDate: z.union([z.string().datetime(), z.literal(""), z.null()]).optional(),
});

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:dues:generate",
      request,
      limit: 10,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session, organizationId } = await requirePermission("dues:write", "throw");
    const input = await parseJsonBody(request, generateDuesSchema);

    if (input.memberId) {
      const result = await generateDuesForMember(
        organizationId,
        { userId: session.userId, userEmail: session.userEmail },
        { memberId: input.memberId, startDate: input.startDate, endDate: input.endDate }
      );
      if (!result.ok) {
        return Response.json({ ok: false, error: result.error }, { status: result.status });
      }
      return Response.json({ ok: true, data: result.data });
    }

    const startDate = input.startDate ? new Date(input.startDate) : undefined;
    const endDate = input.endDate ? new Date(input.endDate) : new Date();
    if (startDate && startDate > endDate) {
      return Response.json({ ok: false, error: "Start date must be before end date." }, { status: 400 });
    }

    const result = await generateMissingDuesChargesForOrganization(organizationId, endDate, startDate);
    const delinquencyResult = await evaluateOrganizationDelinquency(organizationId, {
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      asOfDate: endDate,
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "dues.generate",
      entityType: "dues_charge",
      metadata: {
        memberId: null,
        startDate: startDate?.toISOString() ?? null,
        endDate: endDate.toISOString(),
        result,
        delinquencyResult,
      },
    });

    return Response.json({ ok: true, data: { result, delinquencyResult } });
  });
}
