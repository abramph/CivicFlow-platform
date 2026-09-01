import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { FinanceError } from "@/lib/finance-errors";

/**
 * feature/pta-treasurer-expenditure-experience — shared expenditure-ledger
 * logic, used by both the generic `/expenditures` routes and the PTA
 * Treasurer's nested `/labs/pta/finance/expenditures` routes, so the two UI
 * surfaces never carry two copies of the same query or mutation. Ordinary
 * create/update stay inline in the API route handlers (`/api/expenditures*`)
 * — both UI surfaces already share those same routes via the reused
 * `ExpenditureForm` client component, so there's nothing to factor out
 * there. voidExpenditure is the one mutation pulled out to its own function,
 * mirroring reimbursements.ts's markPaid/correctPaidReimbursement: it's the
 * one financial write with real concurrency semantics (a CAS guard against
 * double-void) worth a dedicated, independently-testable unit rather than
 * inline route logic.
 */

export interface ExpenditureListFilters {
  dateFrom?: string;
  dateTo?: string;
  categoryId?: string;
  paymentMethodId?: string;
  committeeId?: string;
  /** ACTIVE = not voided (the default ledger view); VOIDED = voided only;
   * omitted = both. */
  status?: "ACTIVE" | "VOIDED";
  /** Case-insensitive substring match against vendor/payee. */
  vendor?: string;
  /** DIRECT = no linked ReimbursementRequest; REIMBURSEMENT = created by a
   * paid reimbursement. Omitted = both. */
  origin?: "DIRECT" | "REIMBURSEMENT";
}

function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const clone = { ...value };
  delete clone[key];
  return clone;
}

/**
 * feature/pta-treasurer-expenditure-experience (E3 follow-up) — the
 * snapshot exists so a committee rename or deletion is "harmless to
 * historical reporting" (see the migration's own doc comment). That only
 * holds if a rename actually IS harmless to what's displayed: this must
 * prefer committeeNameAtPosting over the live committee.name whenever both
 * exist, not just when the live row is gone. Shared by the ledger table and
 * both detail pages (generic + PTA-nested) so this 4-way rule lives in
 * exactly one place.
 */
export function describeCommitteeAttribution(row: { committee: { name: string } | null; committeeNameAtPosting: string | null }): {
  display: string;
  helper?: string;
} {
  const liveName = row.committee?.name ?? null;
  const snapshot = row.committeeNameAtPosting;

  if (!snapshot && !liveName) return { display: "No committee" };
  if (!snapshot) return { display: liveName! };
  if (!liveName) return { display: snapshot, helper: "Committee since archived or removed — name shown as recorded at the time." };
  if (liveName === snapshot) return { display: snapshot };
  return { display: snapshot, helper: `Committee is now named "${liveName}" — shown as recorded at the time of posting.` };
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export async function listExpenditures(organizationId: string, filters: ExpenditureListFilters = {}, take = 200) {
  const dateFrom = parseDate(filters.dateFrom);
  const dateTo = parseDate(filters.dateTo);
  const vendor = filters.vendor?.trim();

  return prisma.expenditure.findMany({
    where: {
      organizationId,
      ...(dateFrom || dateTo ? { date: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } } : {}),
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      ...(filters.paymentMethodId ? { paymentMethodId: filters.paymentMethodId } : {}),
      ...(filters.committeeId ? { committeeId: filters.committeeId } : {}),
      ...(filters.status === "VOIDED" ? { voidedAt: { not: null } } : filters.status === "ACTIVE" ? { voidedAt: null } : {}),
      ...(vendor ? { vendor: { contains: vendor, mode: "insensitive" } } : {}),
      ...(filters.origin === "REIMBURSEMENT" ? { reimbursement: { isNot: null } } : filters.origin === "DIRECT" ? { reimbursement: { is: null } } : {}),
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: {
      categoryRef: true,
      paymentMethodConfig: true,
      campaign: true,
      event: true,
      committee: { select: { id: true, name: true } },
      reimbursement: { select: { id: true, payeeName: true } },
    },
    take,
  });
}

/** Cross-org-safe committee validation + name lookup, shared by the direct-
 * expenditure API and (separately, inline — different transaction context)
 * by the reimbursement mark-paid inheritance step in reimbursements.ts. */
export async function assertCommitteeInOrganization(organizationId: string, committeeId: string) {
  const committee = await prisma.ptaCommittee.findFirst({ where: { id: committeeId, organizationId }, select: { id: true, name: true } });
  if (!committee) throw new FinanceError("Committee not found in this organization.", 404);
  return committee;
}

export interface VoidExpenditureInput {
  organizationId: string;
  expenditureId: string;
  reason: string;
  actorUserId: string;
  actorEmail?: string | null;
  /** Pre-fetched by the caller (which already needed it for the edit-window
   * policy check shared with ordinary edits) — passed in rather than
   * re-read here, and used only for the audit event's "before" snapshot. */
  existing: Record<string, unknown>;
}

/** CAS-guarded void: the updateMany's `voidedAt: null` where-clause means
 * only the first of any concurrent void requests can ever match a row —
 * a second, racing request (double submit, or two officers acting at once)
 * matches zero rows and gets a stable FinanceError instead of silently
 * double-voiding or overwriting the first voidReason. Mutation and audit
 * event commit in the same transaction, same discipline as every other
 * money-moving write in this program. */
export async function voidExpenditure(input: VoidExpenditureInput) {
  return prisma.$transaction(async (tx) => {
    const claim = await tx.expenditure.updateMany({
      where: { id: input.expenditureId, organizationId: input.organizationId, voidedAt: null },
      data: { voidReason: input.reason, voidedAt: new Date(), voidedByUserId: input.actorUserId },
    });
    if (claim.count === 0) {
      throw new FinanceError("This expenditure has already been voided.", 409);
    }
    const result = await tx.expenditure.findFirst({ where: { id: input.expenditureId } });

    // receiptUrl excluded from audit metadata -- it's a pointer into private
    // object storage, not something an audit-log reader needs.
    const beforeSansReceipt = omit(input.existing, "receiptUrl");
    const afterSansReceipt = omit(result!, "receiptUrl");
    await createAuditEvent({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail ?? null,
      action: "void",
      entityType: "expenditure",
      entityId: input.expenditureId,
      metadata: { before: beforeSansReceipt, after: afterSansReceipt } as Prisma.InputJsonValue,
      tx,
    });
    return result!;
  });
}

/** PTA-only: committees available for the direct-expenditure form's optional
 * committee selector. Returns an empty list for any non-PTA organization —
 * callers gate the field's visibility on this being non-empty, so the field
 * is inert (never rendered) outside PTA rather than needing its own vertical
 * check at every call site. */
export async function getOrganizationCommitteeOptions(organizationId: string, vertical: string) {
  if (vertical !== "PTA") return [];
  const committees = await prisma.ptaCommittee.findMany({
    where: { organizationId, status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return committees.map((row) => ({ id: row.id, label: row.name }));
}
