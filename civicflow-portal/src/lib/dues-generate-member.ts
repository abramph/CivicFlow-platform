import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { generateMissingDuesChargesForMember } from "@/lib/dues-accrual";
import { evaluateMemberDelinquency } from "@/lib/member-delinquency";
import { z } from "@/lib/validation";

/**
 * Shared member-scoped "Generate Dues Charges" logic — used by the web
 * /api/dues/generate route (memberId branch) and the mobile admin
 * equivalent. Deliberately does NOT include the whole-organization
 * bulk-generate branch (src/lib/dues-accrual.ts's
 * generateMissingDuesChargesForOrganization) — that stays web-only for
 * now, out of scope for a single-tap mobile action.
 *
 * generateMissingDuesChargesForMember()/evaluateMemberDelinquency() look
 * the member up by bare id with no organizationId filter of their own —
 * the findFirst check below is the only checkpoint that stops a caller in
 * one org from generating charges or flipping delinquency status for a
 * member in another org. Never skip it.
 */

export const generateDuesForMemberSchema = z.object({
  memberId: z.string().min(1),
  startDate: z.union([z.string().datetime(), z.literal(""), z.null()]).optional(),
  endDate: z.union([z.string().datetime(), z.literal(""), z.null()]).optional(),
});
export type GenerateDuesForMemberInput = z.infer<typeof generateDuesForMemberSchema>;

export interface GenerateDuesActor {
  userId: string;
  userEmail?: string | null;
}

export type GenerateDuesForMemberResult =
  | { ok: true; data: { result: unknown; delinquencyResult: unknown } }
  | { ok: false; status: number; error: string };

export async function generateDuesForMember(
  organizationId: string,
  actor: GenerateDuesActor,
  input: GenerateDuesForMemberInput
): Promise<GenerateDuesForMemberResult> {
  const startDate = input.startDate ? new Date(input.startDate) : undefined;
  const endDate = input.endDate ? new Date(input.endDate) : new Date();
  if (startDate && startDate > endDate) {
    return { ok: false, status: 400, error: "Start date must be before end date." };
  }

  const member = await prisma.orgMember.findFirst({ where: { id: input.memberId, organizationId } });
  if (!member) return { ok: false, status: 404, error: "Member not found" };

  const result = await generateMissingDuesChargesForMember(input.memberId, endDate, startDate);
  const delinquencyResult = await evaluateMemberDelinquency(input.memberId, {
    actorUserId: actor.userId,
    actorEmail: actor.userEmail,
    asOfDate: endDate,
  });

  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.userEmail,
    action: "dues.generate",
    entityType: "dues_charge",
    metadata: {
      memberId: input.memberId,
      startDate: startDate?.toISOString() ?? null,
      endDate: endDate.toISOString(),
      result,
      delinquencyResult,
    },
  });

  return { ok: true, data: { result, delinquencyResult } };
}
