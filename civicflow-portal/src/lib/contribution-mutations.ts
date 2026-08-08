import type { Contribution } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { createMemberTimelineEvent } from "@/lib/member-timeline";
import { z, ValidationError } from "@/lib/validation";

/**
 * Shared Contribution create/update/void business logic — used by both the
 * web portal routes (src/app/api/contributions/*) and the mobile admin
 * routes (src/app/api/mobile/admin/contributions/*). Extracted so neither
 * surface can drift from the other's validation, locking rules, or audit
 * behavior. Contribution is the only financial model in this codebase with
 * a real, tested void path — see docs/financial-edit-policy for why dues
 * payments/charges have no equivalent (never invent one here).
 */

const PAYMENT_METHOD_VALUES = [
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
] as const;

export const createContributionSchema = z.object({
  memberId: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
  campaignId: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
  eventId: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
  contributorName: z.union([z.string().max(500), z.literal(""), z.null()]).optional(),
  amount: z.number().positive(),
  contributionDate: z.string().datetime(),
  paymentMethod: z.enum(PAYMENT_METHOD_VALUES).optional(),
  source: z.enum(["MEMBER_PROFILE", "CAMPAIGN_PAGE", "EVENT_PAGE", "MANUAL", "IMPORT"]),
  receiptRequested: z.boolean().optional(),
  notes: z.union([z.string().max(4000), z.literal(""), z.null()]).optional(),
});
export type CreateContributionInput = z.infer<typeof createContributionSchema>;

export const updateContributionSchema = z.object({
  amount: z.number().positive().optional(),
  contributionDate: z.string().datetime().optional(),
  paymentMethod: z.enum(PAYMENT_METHOD_VALUES).nullable().optional(),
  notes: z.union([z.string().max(4000), z.literal(""), z.null()]).optional(),
  receiptRequested: z.boolean().optional(),
  editReason: z.string().max(500).optional(),
});
export type UpdateContributionInput = z.infer<typeof updateContributionSchema>;

export const voidContributionSchema = z.object({
  reason: z.string().max(500).optional(),
});
export type VoidContributionInput = z.infer<typeof voidContributionSchema>;

export interface ContributionMutationActor {
  userId: string;
  userEmail?: string | null;
}

export type ContributionMutationResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

export async function createContribution(
  organizationId: string,
  actor: ContributionMutationActor,
  input: CreateContributionInput
): Promise<ContributionMutationResult<Contribution>> {
  const memberId = input.memberId || null;
  const campaignId = input.campaignId || null;
  const eventId = input.eventId || null;
  const contributorName = typeof input.contributorName === "string" ? input.contributorName.trim() || null : null;
  const notes = typeof input.notes === "string" ? input.notes.trim() || null : (input.notes ?? null);

  if (!memberId && !campaignId && !eventId) {
    throw new ValidationError("Every contribution must be attributed to a member, campaign, or event.");
  }

  if (memberId) {
    const member = await prisma.orgMember.findFirst({ where: { id: memberId, organizationId } });
    if (!member) return { ok: false, status: 404, error: "Member not found in organization" };
  }
  if (campaignId) {
    const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, organizationId } });
    if (!campaign) return { ok: false, status: 404, error: "Campaign not found in organization" };
  }
  if (eventId) {
    const event = await prisma.event.findFirst({ where: { id: eventId, organizationId } });
    if (!event) return { ok: false, status: 404, error: "Event not found in organization" };
  }

  const row = await prisma.contribution.create({
    data: {
      organizationId,
      memberId,
      campaignId,
      eventId,
      contributorName: memberId ? null : contributorName,
      amount: input.amount,
      contributionDate: new Date(input.contributionDate),
      paymentMethod: input.paymentMethod ?? null,
      source: input.source,
      receiptRequested: input.receiptRequested ?? false,
      notes,
      createdByUserId: actor.userId,
    },
  });

  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.userEmail,
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
      createdByUserId: actor.userId,
    });
  }

  return { ok: true, data: row };
}

export async function updateContribution(
  organizationId: string,
  actor: ContributionMutationActor,
  contributionId: string,
  input: UpdateContributionInput
): Promise<ContributionMutationResult<Contribution>> {
  const existing = await prisma.contribution.findFirst({ where: { id: contributionId, organizationId } });
  if (!existing) return { ok: false, status: 404, error: "Contribution not found" };
  if (existing.voidedAt) return { ok: false, status: 400, error: "Cannot edit a voided contribution." };
  if (existing.lockedAt && (input.amount !== undefined || input.contributionDate !== undefined)) {
    return { ok: false, status: 400, error: "Amount and date cannot be changed on a locked contribution." };
  }

  const notes = input.notes !== undefined ? (typeof input.notes === "string" ? input.notes.trim() || null : null) : undefined;

  const updated = await prisma.contribution.update({
    where: { id: contributionId },
    data: {
      ...(input.amount !== undefined ? { amount: input.amount } : {}),
      ...(input.contributionDate !== undefined ? { contributionDate: new Date(input.contributionDate) } : {}),
      ...(input.paymentMethod !== undefined ? { paymentMethod: input.paymentMethod } : {}),
      ...(notes !== undefined ? { notes } : {}),
      ...(input.receiptRequested !== undefined ? { receiptRequested: input.receiptRequested } : {}),
      ...(input.editReason !== undefined ? { editReason: input.editReason.trim() || null } : {}),
      revisionNumber: { increment: 1 },
    },
  });

  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.userEmail,
    action: "update",
    entityType: "contribution",
    entityId: contributionId,
    metadata: {
      editReason: input.editReason ?? null,
      changes: Object.keys(input).filter((k) => k !== "editReason"),
    },
  });

  if (existing.memberId && (input.amount !== undefined || input.contributionDate !== undefined)) {
    await createMemberTimelineEvent({
      organizationId,
      memberId: existing.memberId,
      eventType: "CONTRIBUTION_RECORDED",
      title: "Contribution updated",
      newValue: { contributionId, amount: updated.amount.toString(), editReason: input.editReason ?? null },
      occurredAt: updated.contributionDate,
      createdByUserId: actor.userId,
    });
  }

  return { ok: true, data: updated };
}

export async function voidContribution(
  organizationId: string,
  actor: ContributionMutationActor,
  contributionId: string,
  input: VoidContributionInput
): Promise<ContributionMutationResult<Contribution>> {
  const contribution = await prisma.contribution.findFirst({ where: { id: contributionId, organizationId } });
  if (!contribution) return { ok: false, status: 404, error: "Contribution not found" };
  if (contribution.voidedAt) return { ok: false, status: 400, error: "Contribution is already voided." };
  if (contribution.lockedAt) {
    return { ok: false, status: 400, error: "This contribution is locked and cannot be voided. Contact a platform admin." };
  }

  const voided = await prisma.contribution.update({
    where: { id: contributionId },
    data: {
      voidedAt: new Date(),
      voidedByUserId: actor.userId,
      voidReason: input.reason?.trim() || null,
    },
  });

  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.userEmail,
    action: "void",
    entityType: "contribution",
    entityId: contributionId,
    metadata: { reason: input.reason ?? null, amount: contribution.amount.toString(), memberId: contribution.memberId },
  });

  if (contribution.memberId) {
    await createMemberTimelineEvent({
      organizationId,
      memberId: contribution.memberId,
      eventType: "CONTRIBUTION_RECORDED",
      title: "Contribution voided",
      newValue: { contributionId, amount: contribution.amount.toString(), reason: input.reason ?? null },
      occurredAt: new Date(),
      createdByUserId: actor.userId,
    });
  }

  return { ok: true, data: voided };
}
