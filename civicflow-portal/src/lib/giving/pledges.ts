import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { FinanceError } from "@/lib/finance-errors";
import { ensureContributionsEnabled } from "./module";

/**
 * CORE-GIVE-E — pledges (docs/core-contributions-giving.md §5). A pledge is
 * a STATED INTENTION: progress is computed live, one contribution credits at
 * most one pledge (§23 no-double-count by construction), and NOTHING here
 * can produce arrears, dues, or delinquency — "Remaining toward pledge" is
 * the only remaining-language this module knows.
 */

interface ActorInput {
  actorUserId: string;
  actorEmail?: string | null;
}

export async function createPledge(input: ActorInput & {
  organizationId: string;
  contributorUserId: string;
  memberId?: string | null;
  fundId: string;
  pledgedAmount: number;
  campaignId?: string | null;
  targetCompletionDate?: Date | null;
  allowPublicRecognition?: boolean;
  notes?: string | null;
}) {
  await ensureContributionsEnabled(input.organizationId);
  if (!Number.isFinite(input.pledgedAmount) || input.pledgedAmount <= 0) {
    throw new FinanceError("Pledged amount must be greater than zero.");
  }
  const fund = await prisma.fund.findFirst({ where: { id: input.fundId, organizationId: input.organizationId } });
  if (!fund) throw new FinanceError("Fund not found.", 404);
  if (fund.status !== "ACTIVE") throw new FinanceError(`"${fund.name}" is not currently active.`, 409);
  if (!fund.allowPledges) throw new FinanceError(`"${fund.name}" does not take pledges.`, 409);
  if (input.campaignId) {
    const campaign = await prisma.campaign.findFirst({ where: { id: input.campaignId, organizationId: input.organizationId } });
    if (!campaign) throw new FinanceError("Campaign not found.", 404);
  }

  const pledge = await prisma.pledge.create({
    data: {
      organizationId: input.organizationId,
      contributorUserId: input.contributorUserId,
      memberId: input.memberId ?? null,
      fundId: fund.id,
      campaignId: input.campaignId ?? null,
      pledgedAmount: new Prisma.Decimal(input.pledgedAmount.toFixed(2)),
      targetCompletionDate: input.targetCompletionDate ?? null,
      allowPublicRecognition: input.allowPublicRecognition ?? false,
      notes: input.notes?.trim() || null,
    },
  });
  const { createAuditEvent } = await import("@/lib/audit");
  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "giving.pledge_created",
    entityType: "pledge",
    entityId: pledge.id,
    metadata: { fundId: fund.id, pledgedAmount: input.pledgedAmount, selfService: input.actorUserId === input.contributorUserId },
  });
  return pledge;
}

/** Live progress: SUM of non-void contributions crediting this pledge. */
export async function pledgeProgress(organizationId: string, pledgeId: string): Promise<number> {
  const sum = await prisma.contribution.aggregate({
    where: { organizationId, pledgeId, voidedAt: null },
    _sum: { amount: true },
  });
  return Number(sum._sum.amount ?? 0);
}

export async function listMyPledges(organizationId: string, contributorUserId: string) {
  const pledges = await prisma.pledge.findMany({
    where: { organizationId, contributorUserId, status: { in: ["ACTIVE", "FULFILLED"] } },
    orderBy: { pledgeDate: "desc" },
    include: { fund: { select: { id: true, name: true } }, campaign: { select: { id: true, name: true } } },
  });
  return Promise.all(
    pledges.map(async (pledge) => {
      const contributed = await pledgeProgress(organizationId, pledge.id);
      const pledged = Number(pledge.pledgedAmount);
      return {
        id: pledge.id,
        fundId: pledge.fund.id,
        fundName: pledge.fund.name,
        campaignName: pledge.campaign?.name ?? null,
        pledged,
        contributed,
        /// The ONLY remaining-language: toward the stated goal, never owed.
        remainingTowardPledge: Math.max(0, pledged - contributed),
        progressPercent: pledged > 0 ? Math.min(100, Math.round((contributed / pledged) * 1000) / 10) : 0,
        status: pledge.status,
        targetCompletionDate: pledge.targetCompletionDate,
      };
    })
  );
}

/** Officer list (contributions:pledges:view). */
export async function listPledges(organizationId: string) {
  const pledges = await prisma.pledge.findMany({
    where: { organizationId },
    orderBy: { pledgeDate: "desc" },
    include: {
      fund: { select: { name: true } },
      campaign: { select: { name: true } },
      contributorUser: { select: { displayName: true, email: true } },
    },
    take: 300,
  });
  return Promise.all(
    pledges.map(async (pledge) => ({
      id: pledge.id,
      contributor: pledge.contributorUser.displayName || pledge.contributorUser.email,
      fundName: pledge.fund.name,
      campaignName: pledge.campaign?.name ?? null,
      pledged: Number(pledge.pledgedAmount),
      contributed: await pledgeProgress(organizationId, pledge.id),
      status: pledge.status,
      pledgeDate: pledge.pledgeDate,
    }))
  );
}

/** Checkout-time validation: the pledge must be the CALLER's, in this org,
 * ACTIVE, and designate the SAME fund. */
export async function validatePledgeForGiving(input: {
  organizationId: string;
  contributorUserId: string;
  pledgeId: string;
  fundId: string;
}) {
  const pledge = await prisma.pledge.findFirst({
    where: { id: input.pledgeId, organizationId: input.organizationId, contributorUserId: input.contributorUserId },
  });
  if (!pledge) throw new FinanceError("Pledge not found.", 404);
  if (pledge.status !== "ACTIVE") throw new FinanceError("This pledge is no longer active.", 409);
  if (pledge.fundId !== input.fundId) throw new FinanceError("That pledge belongs to a different fund.", 409);
  return pledge;
}

/** Webhook-side §50 re-verification. Returns the pledge id to stamp, or
 * null — a mismatched pledge NEVER blocks the contribution itself. */
export async function verifyPledgeLinkage(input: {
  organizationId: string;
  pledgeId: string;
  fundId: string;
  contributorUserId: string | null;
}): Promise<string | null> {
  const pledge = await prisma.pledge.findFirst({
    where: { id: input.pledgeId, organizationId: input.organizationId, fundId: input.fundId },
  });
  if (!pledge) return null;
  if (input.contributorUserId && pledge.contributorUserId !== input.contributorUserId) return null;
  return pledge.id;
}

/** After a credit lands: flip to FULFILLED exactly once when the live sum
 * crosses the pledged amount. Display always derives from the sum anyway. */
export async function markFulfilledIfComplete(organizationId: string, pledgeId: string) {
  const pledge = await prisma.pledge.findFirst({ where: { id: pledgeId, organizationId } });
  if (!pledge || pledge.status !== "ACTIVE") return;
  const contributed = await pledgeProgress(organizationId, pledgeId);
  if (contributed >= Number(pledge.pledgedAmount)) {
    await prisma.pledge.update({ where: { id: pledge.id }, data: { status: "FULFILLED" } });
    const { createAuditEvent } = await import("@/lib/audit");
    await createAuditEvent({
      organizationId,
      actorUserId: pledge.contributorUserId,
      action: "giving.pledge_fulfilled",
      entityType: "pledge",
      entityId: pledge.id,
      metadata: { pledged: Number(pledge.pledgedAmount), contributed },
    });
  }
}

/** Member cancels their OWN pledge (ownership in the query); officers with
 * pledges:manage use the same path with the member's id. */
export async function cancelPledge(input: ActorInput & { organizationId: string; contributorUserId: string; pledgeId: string }) {
  const pledge = await prisma.pledge.findFirst({
    where: { id: input.pledgeId, organizationId: input.organizationId, contributorUserId: input.contributorUserId },
  });
  if (!pledge) throw new FinanceError("Pledge not found.", 404);
  if (pledge.status === "CANCELLED") return pledge;
  const updated = await prisma.pledge.update({ where: { id: pledge.id }, data: { status: "CANCELLED" } });
  const { createAuditEvent } = await import("@/lib/audit");
  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "giving.pledge_cancelled",
    entityType: "pledge",
    entityId: pledge.id,
    metadata: {},
  });
  return updated;
}

/** §24 campaign totals — computed, never stored. */
export async function campaignPledgeTotals(organizationId: string, campaignId: string) {
  const [pledgedSum, receivedSum] = await Promise.all([
    prisma.pledge.aggregate({
      where: { organizationId, campaignId, status: { in: ["ACTIVE", "FULFILLED"] } },
      _sum: { pledgedAmount: true },
      _count: true,
    }),
    prisma.contribution.aggregate({
      where: { organizationId, voidedAt: null, pledge: { campaignId } },
      _sum: { amount: true },
    }),
  ]);
  return {
    pledgeCount: pledgedSum._count,
    totalPledged: Number(pledgedSum._sum.pledgedAmount ?? 0),
    receivedTowardPledges: Number(receivedSum._sum.amount ?? 0),
  };
}
