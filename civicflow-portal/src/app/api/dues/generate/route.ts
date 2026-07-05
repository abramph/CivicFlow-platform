import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import {
  generateMissingDuesChargesForMember,
  generateMissingDuesChargesForOrganization,
} from "@/lib/dues-accrual";
import { evaluateMemberDelinquency, evaluateOrganizationDelinquency } from "@/lib/member-delinquency";
import { prisma } from "@/lib/prisma";
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
    const startDate = input.startDate ? new Date(input.startDate) : undefined;
    const endDate = input.endDate ? new Date(input.endDate) : new Date();
    if (startDate && startDate > endDate) {
      return Response.json({ ok: false, error: "Start date must be before end date." }, { status: 400 });
    }

    if (input.memberId) {
      // generateMissingDuesChargesForMember/evaluateMemberDelinquency look the
      // member up by bare id with no organizationId filter of their own — this
      // is the only checkpoint that stops a caller in one org from generating
      // charges or flipping delinquency status for a member in another org.
      const member = await prisma.orgMember.findFirst({ where: { id: input.memberId, organizationId } });
      if (!member) {
        return Response.json({ ok: false, error: "Member not found" }, { status: 404 });
      }
    }

    const result = input.memberId
      ? await generateMissingDuesChargesForMember(input.memberId, endDate, startDate)
      : await generateMissingDuesChargesForOrganization(organizationId, endDate, startDate);

    const delinquencyResult = input.memberId
      ? await evaluateMemberDelinquency(input.memberId, {
          actorUserId: session.userId,
          actorEmail: session.userEmail,
          asOfDate: endDate,
        })
      : await evaluateOrganizationDelinquency(organizationId, {
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
        memberId: input.memberId || null,
        startDate: startDate?.toISOString() ?? null,
        endDate: endDate.toISOString(),
        result,
        delinquencyResult,
      },
    });

    return Response.json({ ok: true, data: { result, delinquencyResult } });
  });
}
