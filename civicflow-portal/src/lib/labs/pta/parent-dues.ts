import { prisma } from "@/lib/prisma";
import { createPaymentReportAndNotify, DUES_PAYMENT_METHODS } from "@/lib/payment-reports";
import { findActivePaymentLink } from "@/lib/payment-links";
import { PtaError } from "./errors";

/**
 * Parent-facing dues self-service — read-only summary plus a "report a
 * payment" action. Deliberately reuses the existing platform pipeline
 * end-to-end rather than building a parallel one:
 *   - Charges/payments/adjustments: the existing DuesCharge/DuesPayment/
 *     DuesAdjustment models, scoped to the household's billing-identity
 *     OrgMember (see households.ts) — zero new schema.
 *   - Online payment: the existing org-wide PaymentLink (linkType DUES) +
 *     its already-built Stripe Checkout flow (/pay/[slug]) — completely
 *     unmodified. See "Why no automatic payment reconciliation" below for
 *     why this module does NOT create its own Stripe session or touch the
 *     webhook.
 *   - "I already paid" reporting: the existing createPaymentReportAndNotify()
 *     (src/lib/payment-reports.ts) — the exact function the base product's
 *     own /m/report-payment already uses — called here with the household's
 *     OrgMember id instead of a personally-linked member id.
 *
 * Why no automatic payment reconciliation:
 * The existing PaymentLink → Stripe Checkout → webhook pipeline was
 * investigated in full before writing this module. Its metadata carries no
 * memberId or duesChargeId at all, and its checkout.session.completed
 * handler ALWAYS creates a generic, unlinked Contribution row — never a
 * DuesPayment, never a DuesCharge status update — for every PaymentLink
 * type, dues included. This is true platform-wide, not a PTA-specific gap.
 * Building automatic charge-specific reconciliation would mean adding new
 * Stripe metadata fields and new webhook branching logic — genuinely new
 * payment-processing infrastructure, which the task instructions for this
 * feature explicitly said only to add if the existing system is genuinely
 * incapable of the REQUIRED workflow. The required workflow ("a parent can
 * pay and the status is known") is fully satisfied by the existing
 * report → officer-approval path (recordDuesPayment() already updates the
 * charge), so that path is reused instead. This is documented in
 * docs/pta-parent-dues-self-service.md as a known limitation, not hidden.
 */

export type PtaParentDuesStatus = "NO_CHARGE" | "UNPAID" | "PARTIALLY_PAID" | "PAID" | "WAIVED" | "VOIDED" | "PENDING_REVIEW";

export interface PtaParentDuesChargeSummary {
  id: string;
  amountDueCents: number;
  amountPaidCents: number;
  remainingBalanceCents: number;
  dueDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  status: PtaParentDuesStatus;
  rawStatus: string;
  createdAt: string;
  payments: { id: string; amountCents: number; paymentDate: string; method: string; reference: string | null }[];
  adjustments: { id: string; type: string; amountCents: number; reason: string; createdAt: string }[];
  pendingReportCount: number;
}

export interface PtaParentDuesSummary {
  schoolOrPtaName: string | null;
  currentSchoolYear: string | null;
  membershipModel: string | null;
  defaultDuesAmountCents: number | null;
  hasBillingIdentity: boolean;
  currentCharge: PtaParentDuesChargeSummary | null;
  priorCharges: PtaParentDuesChargeSummary[];
  onlinePaymentLinkSlug: string | null;
}

function toCents(decimal: unknown): number {
  return Math.round(Number(decimal) * 100);
}

/** Never derives a status the underlying records don't actually support — there is no "refunded" DuesChargeStatus, so one is never fabricated here (see the module doc comment). Adjustments (including any officer-recorded write-off/credit that documents a real-world refund) are always returned alongside the status, not folded into it. */
function mapChargeStatus(rawStatus: string, pendingReportCount: number): PtaParentDuesStatus {
  if (rawStatus === "PAID") return "PAID";
  if (rawStatus === "WAIVED") return "WAIVED";
  if (rawStatus === "VOID") return "VOIDED";
  if (rawStatus === "PARTIAL") return "PARTIALLY_PAID";
  // PENDING
  return pendingReportCount > 0 ? "PENDING_REVIEW" : "UNPAID";
}

async function summarizeCharge(charge: {
  id: string;
  amountDue: unknown;
  amountPaid: unknown;
  dueDate: Date;
  periodStart: Date | null;
  periodEnd: Date | null;
  status: string;
  createdAt: Date;
  payments: { id: string; amount: unknown; paymentDate: Date; method: string; reference: string | null }[];
  adjustments: { id: string; adjustmentType: string; amount: unknown; reason: string; createdAt: Date }[];
  paymentReports: { status: string }[];
}): Promise<PtaParentDuesChargeSummary> {
  const pendingReportCount = charge.paymentReports.filter((r) => r.status === "pending").length;
  return {
    id: charge.id,
    amountDueCents: toCents(charge.amountDue),
    amountPaidCents: toCents(charge.amountPaid),
    remainingBalanceCents: Math.max(0, toCents(charge.amountDue) - toCents(charge.amountPaid)),
    dueDate: charge.dueDate.toISOString(),
    periodStart: charge.periodStart?.toISOString() ?? null,
    periodEnd: charge.periodEnd?.toISOString() ?? null,
    status: mapChargeStatus(charge.status, pendingReportCount),
    rawStatus: charge.status,
    createdAt: charge.createdAt.toISOString(),
    payments: charge.payments.map((p) => ({ id: p.id, amountCents: toCents(p.amount), paymentDate: p.paymentDate.toISOString(), method: p.method, reference: p.reference })),
    adjustments: charge.adjustments.map((a) => ({ id: a.id, type: a.adjustmentType, amountCents: toCents(a.amount), reason: a.reason, createdAt: a.createdAt.toISOString() })),
    pendingReportCount,
  };
}

/** Read-only — resolves everything from the household's billing-identity OrgMember, scoped by organizationId at every query. */
export async function getPtaParentDuesSummary(organizationId: string, householdId: string): Promise<PtaParentDuesSummary> {
  const [profile, household] = await Promise.all([
    prisma.ptaProfile.findUnique({ where: { organizationId } }),
    prisma.ptaHousehold.findFirst({ where: { id: householdId, organizationId } }),
  ]);
  if (!household) throw new PtaError("PTA_HOUSEHOLD_NOT_FOUND", "Household not found in this organization.");

  const base = {
    schoolOrPtaName: profile?.schoolOrPtaName ?? null,
    currentSchoolYear: profile?.currentSchoolYear ?? null,
    membershipModel: profile?.membershipModel ?? null,
    defaultDuesAmountCents: profile?.defaultDuesAmountCents ?? null,
  };

  if (!household.orgMemberId) {
    return { ...base, hasBillingIdentity: false, currentCharge: null, priorCharges: [], onlinePaymentLinkSlug: null };
  }

  const [charges, activeLink] = await Promise.all([
    prisma.duesCharge.findMany({
      where: { organizationId, memberId: household.orgMemberId },
      orderBy: { periodStart: "desc" },
      include: { payments: true, adjustments: true, paymentReports: { select: { status: true } } },
    }),
    findActivePaymentLink({ organizationId, linkType: "DUES" }),
  ]);

  const summarized = await Promise.all(charges.map(summarizeCharge));
  const currentCharge = summarized.find((c) => c.periodEnd === null || new Date(c.periodEnd) >= new Date()) ?? summarized[0] ?? null;
  const priorCharges = summarized.filter((c) => c.id !== currentCharge?.id);

  return {
    ...base,
    hasBillingIdentity: true,
    currentCharge,
    priorCharges,
    onlinePaymentLinkSlug: activeLink?.slug ?? null,
  };
}

export interface ReportPtaDuesPaymentInput {
  organizationId: string;
  householdId: string;
  actorUserId: string;
  duesChargeId?: string | null;
  amountCents: number;
  paymentMethod: (typeof DUES_PAYMENT_METHODS)[number];
  paymentDate: Date;
  referenceNumber?: string | null;
  note?: string | null;
}

/**
 * A parent's "I already paid" self-report — creates a `pending`
 * PaymentReport for an officer to review and approve, exactly the same
 * mechanism the base product's own member-portal report-payment flow
 * already uses (createPaymentReportAndNotify(), unmodified). Approving it
 * (existing, unmodified officer route) is what actually updates the
 * charge's status via the platform's own recordDuesPayment().
 */
export async function reportPtaDuesPayment(input: ReportPtaDuesPaymentInput) {
  if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) {
    throw new PtaError("PTA_VALIDATION_ERROR", "Amount must be a positive number.");
  }

  const household = await prisma.ptaHousehold.findFirst({ where: { id: input.householdId, organizationId: input.organizationId } });
  if (!household) throw new PtaError("PTA_HOUSEHOLD_NOT_FOUND", "Household not found in this organization.");
  if (!household.orgMemberId) {
    throw new PtaError("PTA_VALIDATION_ERROR", "This household has no billing identity yet — contact a PTA officer.");
  }

  if (input.duesChargeId) {
    const charge = await prisma.duesCharge.findFirst({ where: { id: input.duesChargeId, organizationId: input.organizationId, memberId: household.orgMemberId } });
    if (!charge) throw new PtaError("PTA_VALIDATION_ERROR", "That dues charge was not found for this household.");
    if (charge.status === "PAID" || charge.status === "WAIVED" || charge.status === "VOID") {
      throw new PtaError("PTA_VALIDATION_ERROR", `This charge is already ${charge.status.toLowerCase()} and cannot accept a new payment report.`);
    }
  }

  return createPaymentReportAndNotify({
    organizationId: input.organizationId,
    memberId: household.orgMemberId,
    amount: input.amountCents / 100,
    paymentMethod: input.paymentMethod,
    paymentDate: input.paymentDate,
    referenceNumber: input.referenceNumber ?? null,
    note: input.note ?? null,
    category: "MEMBERSHIP_DUES",
    duesChargeId: input.duesChargeId ?? null,
  });
}
