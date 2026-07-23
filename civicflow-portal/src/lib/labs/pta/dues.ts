import type { DuesPaymentMethod } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { recordDuesPayment } from "@/lib/dues-payments";
import { PtaError } from "./errors";

/**
 * PTA dues run entirely through the existing, unmodified dues pipeline
 * (DuesAccount/DuesCharge/DuesPayment) — every household's billing identity
 * is a real OrgMember row (see households.ts), so this module only ever
 * creates/reads rows scoped to that OrgMember and delegates actual payment
 * recording to the platform's own recordDuesPayment() (src/lib/dues-payments.ts)
 * rather than reimplementing balance math. PaymentLink creation (for an
 * online payment link) and PaymentReport (for a member-submitted manual
 * report) are the existing, unmodified paths already used platform-wide —
 * not duplicated here.
 *
 * Never mixes this with Organization subscription billing (Stripe
 * subscriptions/Organization.plan) — PTA dues are money the household pays
 * the PTA organization, an entirely separate concern from what the PTA
 * organization pays Unestra for its own subscription.
 */

async function getHouseholdOrgMemberId(organizationId: string, householdId: string): Promise<string> {
  const household = await prisma.ptaHousehold.findFirst({ where: { id: householdId, organizationId } });
  if (!household) throw new PtaError("PTA_HOUSEHOLD_NOT_FOUND", "Household not found in this organization.");
  if (!household.orgMemberId) {
    throw new PtaError("PTA_VALIDATION_ERROR", "This household has no billing identity — this should never happen for a household created via createPtaHousehold().");
  }
  return household.orgMemberId;
}

export interface CreateDuesChargeInput {
  organizationId: string;
  householdId: string;
  amountCents: number;
  schoolYear: string;
  periodStart: Date;
  periodEnd: Date;
  dueDate: Date;
  actorUserId: string;
  actorEmail?: string | null;
}

/** Creates (or reuses) the household's PTA DuesAccount, then a DuesCharge for the given school-year period. */
export async function createPtaDuesCharge(input: CreateDuesChargeInput) {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new PtaError("PTA_VALIDATION_ERROR", "Dues amount must be a positive integer number of cents.");
  }
  const memberId = await getHouseholdOrgMemberId(input.organizationId, input.householdId);

  let duesAccount = await prisma.duesAccount.findFirst({ where: { organizationId: input.organizationId, memberId, name: "PTA Membership Dues" } });
  if (!duesAccount) {
    duesAccount = await prisma.duesAccount.create({
      data: { organizationId: input.organizationId, memberId, name: "PTA Membership Dues", frequency: "annual", amountDefault: input.amountCents / 100 },
    });
  }

  const charge = await prisma.duesCharge.upsert({
    where: { organizationId_memberId_duesAccountId_periodStart_periodEnd: { organizationId: input.organizationId, memberId, duesAccountId: duesAccount.id, periodStart: input.periodStart, periodEnd: input.periodEnd } },
    create: {
      organizationId: input.organizationId,
      memberId,
      duesAccountId: duesAccount.id,
      amountDue: input.amountCents / 100,
      dueDate: input.dueDate,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
    },
    update: {},
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "pta.dues_charge.created",
    entityType: "pta_household",
    entityId: input.householdId,
    metadata: { schoolYear: input.schoolYear, amountCents: input.amountCents, duesChargeId: charge.id },
  });

  return charge;
}

export async function getPtaHouseholdDuesStatus(organizationId: string, householdId: string) {
  const household = await prisma.ptaHousehold.findFirst({ where: { id: householdId, organizationId } });
  if (!household) throw new PtaError("PTA_HOUSEHOLD_NOT_FOUND", "Household not found in this organization.");
  if (!household.orgMemberId) return { status: "PENDING" as const, charges: [] };

  const charges = await prisma.duesCharge.findMany({
    where: { organizationId, memberId: household.orgMemberId },
    orderBy: { periodStart: "desc" },
  });
  return { status: charges[0]?.status ?? ("PENDING" as const), charges };
}

export interface RecordManualPaymentInput {
  organizationId: string;
  householdId: string;
  duesChargeId: string;
  amountCents: number;
  method: DuesPaymentMethod;
  paymentDate: Date;
  reference?: string | null;
  notes?: string | null;
  actorUserId: string;
  actorEmail?: string | null;
}

/** Delegates to the platform's own recordDuesPayment() — no reimplemented balance math, so this always stays consistent with the same function every other dues-payment path in the app uses. */
export async function recordManualPtaDuesPayment(input: RecordManualPaymentInput) {
  const memberId = await getHouseholdOrgMemberId(input.organizationId, input.householdId);
  const charge = await prisma.duesCharge.findFirst({ where: { id: input.duesChargeId, organizationId: input.organizationId, memberId } });
  if (!charge) throw new PtaError("PTA_VALIDATION_ERROR", "Dues charge not found for this household.");

  const payment = await recordDuesPayment({
    organizationId: input.organizationId,
    memberId,
    duesChargeId: charge.id,
    duesAccountId: charge.duesAccountId,
    amount: input.amountCents / 100,
    paymentDate: input.paymentDate,
    method: input.method,
    reference: input.reference ?? null,
    notes: input.notes ?? null,
    charge: { id: charge.id, amountPaid: charge.amountPaid, amountDue: charge.amountDue },
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "pta.dues_payment.recorded",
    entityType: "pta_household",
    entityId: input.householdId,
    metadata: { amountCents: input.amountCents, method: input.method, duesChargeId: charge.id },
  });

  return payment;
}

export async function waivePtaDuesCharge(organizationId: string, householdId: string, duesChargeId: string, reason: string | null, actorUserId: string, actorEmail?: string | null) {
  const memberId = await getHouseholdOrgMemberId(organizationId, householdId);
  const charge = await prisma.duesCharge.findFirst({ where: { id: duesChargeId, organizationId, memberId } });
  if (!charge) throw new PtaError("PTA_VALIDATION_ERROR", "Dues charge not found for this household.");

  const updated = await prisma.duesCharge.update({ where: { id: charge.id }, data: { status: "WAIVED", notes: reason ?? charge.notes } });
  await prisma.duesAdjustment.create({
    data: { organizationId, memberId, duesChargeId: charge.id, adjustmentType: "WAIVER", amount: charge.amountDue, reason: reason ?? "PTA dues waived" },
  });

  await createAuditEvent({
    organizationId,
    actorUserId,
    actorEmail: actorEmail ?? null,
    action: "pta.dues_charge.waived",
    entityType: "pta_household",
    entityId: householdId,
    metadata: { duesChargeId: charge.id },
  });

  return updated;
}
