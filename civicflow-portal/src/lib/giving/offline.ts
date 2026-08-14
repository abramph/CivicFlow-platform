import type { DuesPaymentMethod } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { FinanceError } from "@/lib/finance-errors";
import { ensureContributionsEnabled } from "./module";

/**
 * CORE-GIVE-F — admin-recorded offline contributions (§21) and
 * non-destructive corrections (§100). docs/core-contributions-giving.md §6.
 * Every entry is audited; corrections VOID + recreate (the existing
 * correction machinery) — settled financial history is never edited or
 * deleted in place.
 */

export const OFFLINE_METHODS: DuesPaymentMethod[] = ["CASH", "CHECK", "ACH", "ZELLE", "CASH_APP", "VENMO", "PAYPAL", "ZEFFY"];

interface ActorInput {
  actorUserId: string;
  actorEmail?: string | null;
}

export interface OfflineContributionInput extends ActorInput {
  organizationId: string;
  fundId: string;
  amount: number;
  method: DuesPaymentMethod;
  contributionDate: Date;
  memberId?: string | null;
  contributorName?: string | null;
  anonymous?: boolean;
  reference?: string | null;
  memo?: string | null;
  pledgeId?: string | null;
  programId?: string | null;
  source?: "MANUAL" | "IMPORT";
}

export async function recordOfflineContribution(input: OfflineContributionInput) {
  await ensureContributionsEnabled(input.organizationId);
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new FinanceError("Amount must be greater than zero.");
  if (!OFFLINE_METHODS.includes(input.method)) throw new FinanceError("That payment method is not an offline method.");
  if (!input.anonymous && !input.memberId && !input.contributorName?.trim()) {
    throw new FinanceError("Attribute the contribution to a member or a name, or mark it anonymous.");
  }

  const fund = await prisma.fund.findFirst({ where: { id: input.fundId, organizationId: input.organizationId } });
  if (!fund) throw new FinanceError("Fund not found.", 404);
  if (fund.status === "CLOSED" || fund.status === "ARCHIVED") {
    throw new FinanceError(`"${fund.name}" is ${fund.status.toLowerCase()} and cannot take new contributions.`, 409);
  }

  let member = null;
  if (input.memberId) {
    member = await prisma.orgMember.findFirst({ where: { id: input.memberId, organizationId: input.organizationId } });
    if (!member) throw new FinanceError("Member not found.", 404);
  }
  if (input.programId) {
    const program = await prisma.contributionProgram.findFirst({
      where: { id: input.programId, organizationId: input.organizationId, fundId: fund.id },
    });
    if (!program) throw new FinanceError("Program not found on that fund.", 404);
  }

  // Pledge credit: same linkage discipline as the webhook — the pledge must
  // live in this org on this fund; if a member is attributed, it must be
  // THAT member's pledge.
  let verifiedPledgeId: string | null = null;
  if (input.pledgeId) {
    const pledge = await prisma.pledge.findFirst({
      where: { id: input.pledgeId, organizationId: input.organizationId, fundId: fund.id },
    });
    if (!pledge) throw new FinanceError("Pledge not found on that fund.", 404);
    if (input.memberId && pledge.memberId && pledge.memberId !== input.memberId) {
      throw new FinanceError("That pledge belongs to a different member.", 409);
    }
    verifiedPledgeId = pledge.id;
  }

  const { withContributionNumber } = await import("./contribution-numbers");
  const contribution = await withContributionNumber(input.organizationId, (contributionNumber) =>
    prisma.contribution.create({
      data: {
        organizationId: input.organizationId,
        contributionNumber,
        fundId: fund.id,
        contributionProgramId: input.programId ?? null,
        memberId: input.memberId ?? null,
        pledgeId: verifiedPledgeId,
        amount: Math.round(input.amount * 100) / 100,
        currency: "USD",
        contributionDate: input.contributionDate,
        paymentMethod: input.method,
        source: input.source ?? "MANUAL",
        contributorName: input.anonymous
          ? null
          : (input.contributorName?.trim() || (member ? `${member.firstName} ${member.lastName}`.trim() : null)),
        anonymityMode: input.anonymous ? "PUBLICLY_ANONYMOUS" : "NONE",
        notes: [input.reference ? `Ref: ${input.reference.trim()}` : null, input.memo?.trim() || null].filter(Boolean).join(" — ") || null,
        createdByUserId: input.actorUserId,
        receiptRequested: false,
      },
    })
  );

  if (verifiedPledgeId) {
    const { markFulfilledIfComplete } = await import("./pledges");
    await markFulfilledIfComplete(input.organizationId, verifiedPledgeId);
  }

  const { createAuditEvent } = await import("@/lib/audit");
  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "giving.contribution_offline_recorded",
    entityType: "contribution",
    entityId: contribution.id,
    metadata: {
      contributionNumber: contribution.contributionNumber,
      fundId: fund.id,
      method: input.method,
      amount: Number(contribution.amount),
    },
  });
  return contribution;
}

/** §100 — correct by VOID + recreate, linked, both audited. The original
 * row survives with its void reason; pledge progress self-heals because it
 * sums non-void rows only. */
export async function correctOfflineContribution(input: ActorInput & {
  organizationId: string;
  contributionId: string;
  reason: string;
  corrected: Omit<OfflineContributionInput, keyof ActorInput | "organizationId">;
}) {
  await ensureContributionsEnabled(input.organizationId);
  const reason = input.reason.trim();
  if (!reason) throw new FinanceError("A correction reason is required.");

  const original = await prisma.contribution.findFirst({
    where: { id: input.contributionId, organizationId: input.organizationId },
  });
  if (!original) throw new FinanceError("Contribution not found.", 404);
  if (original.voidedAt) throw new FinanceError("This contribution is already voided.", 409);
  if (original.providerPaymentIntentId || original.providerInvoiceId) {
    throw new FinanceError("Provider-processed contributions are corrected through refunds, not offline correction.", 409);
  }

  const replacement = await recordOfflineContribution({
    ...input.corrected,
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
  });

  await prisma.contribution.update({
    where: { id: original.id },
    data: {
      voidedAt: new Date(),
      voidedByUserId: input.actorUserId,
      voidReason: reason,
      correctedById: replacement.id,
    },
  });
  await prisma.contribution.update({
    where: { id: replacement.id },
    data: { correctionOfId: original.id, revisionNumber: (original.revisionNumber ?? 1) + 1 },
  });

  // Pledge progress on the ORIGINAL's pledge may have shrunk — nothing to
  // do: sums are live. But a FULFILLED pledge may no longer be fulfilled;
  // leave status (display derives from the live sum) and note it in audit.
  const { createAuditEvent } = await import("@/lib/audit");
  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "giving.contribution_corrected",
    entityType: "contribution",
    entityId: original.id,
    metadata: { replacementId: replacement.id, reason },
  });
  return { original: { id: original.id }, replacement };
}
