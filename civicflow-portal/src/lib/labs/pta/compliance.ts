import type { PtaComplianceRecurrence } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { PtaError } from "./errors";

/**
 * PTA Vertical 2.0, PR PTA-I — the compliance calendar (brief §22).
 * Requirements are org-configured rows, never hard-coded rules; the §22
 * examples ship as SUGGESTIONS an officer applies deliberately. Display
 * status is derived at read time so the dashboard can never go stale.
 */

export type ComplianceDisplayStatus = "COMPLIANT" | "DUE_SOON" | "OVERDUE" | "NOT_APPLICABLE";

export const DUE_SOON_DAYS = 30;

/** §22's examples — suggestions only, applied via a button, editable rows. */
export const SUGGESTED_REQUIREMENTS: { title: string; ownerName: string; recurrence: PtaComplianceRecurrence }[] = [
  { title: "Bylaws review", ownerName: "President", recurrence: "ANNUAL" },
  { title: "Insurance renewal", ownerName: "Treasurer", recurrence: "ANNUAL" },
  { title: "Annual financial audit/review", ownerName: "Treasurer", recurrence: "ANNUAL" },
  { title: "Tax filing (990/990-EZ/990-N)", ownerName: "Treasurer", recurrence: "ANNUAL" },
  { title: "State PTA reporting", ownerName: "Secretary", recurrence: "ANNUAL" },
  { title: "Officer information update", ownerName: "Secretary", recurrence: "ANNUAL" },
  { title: "Membership reporting", ownerName: "Membership Chair", recurrence: "ANNUAL" },
  { title: "Financial report to membership", ownerName: "Treasurer", recurrence: "QUARTERLY" },
  { title: "Required officer training", ownerName: "President", recurrence: "ANNUAL" },
];

export function deriveComplianceStatus(
  requirement: { isApplicable: boolean; dueDate: Date | null },
  now: Date = new Date()
): ComplianceDisplayStatus {
  if (!requirement.isApplicable) return "NOT_APPLICABLE";
  if (!requirement.dueDate) return "COMPLIANT";
  if (requirement.dueDate.getTime() < now.getTime()) return "OVERDUE";
  const dueSoonCutoff = now.getTime() + DUE_SOON_DAYS * 24 * 60 * 60 * 1000;
  if (requirement.dueDate.getTime() <= dueSoonCutoff) return "DUE_SOON";
  return "COMPLIANT";
}

export function advanceDueDate(dueDate: Date, recurrence: PtaComplianceRecurrence): Date | null {
  const next = new Date(dueDate);
  switch (recurrence) {
    case "MONTHLY":
      next.setMonth(next.getMonth() + 1);
      return next;
    case "QUARTERLY":
      next.setMonth(next.getMonth() + 3);
      return next;
    case "ANNUAL":
      next.setFullYear(next.getFullYear() + 1);
      return next;
    default:
      return null;
  }
}

export async function listComplianceRequirements(organizationId: string) {
  const rows = await prisma.ptaComplianceRequirement.findMany({
    where: { organizationId },
    orderBy: [{ sortOrder: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }, { title: "asc" }],
  });
  const now = new Date();
  return rows.map((row) => ({ ...row, displayStatus: deriveComplianceStatus(row, now) }));
}

interface ActorInput {
  actorUserId: string;
  actorEmail?: string | null;
}

export interface UpsertComplianceInput extends ActorInput {
  organizationId: string;
  requirementId?: string;
  title?: string;
  description?: string | null;
  ownerName?: string | null;
  dueDate?: Date | null;
  recurrence?: PtaComplianceRecurrence;
  isApplicable?: boolean;
  notes?: string | null;
  sortOrder?: number;
}

export async function createComplianceRequirement(input: UpsertComplianceInput) {
  const title = input.title?.trim();
  if (!title) throw new PtaError("PTA_VALIDATION_ERROR", "Requirement title is required.");
  const existing = await prisma.ptaComplianceRequirement.findFirst({ where: { organizationId: input.organizationId, title } });
  if (existing) throw new PtaError("PTA_VALIDATION_ERROR", `"${title}" is already tracked.`);

  const requirement = await prisma.ptaComplianceRequirement.create({
    data: {
      organizationId: input.organizationId,
      title,
      description: input.description?.trim() || null,
      ownerName: input.ownerName?.trim() || null,
      dueDate: input.dueDate ?? null,
      recurrence: input.recurrence ?? "NONE",
      isApplicable: input.isApplicable ?? true,
      notes: input.notes?.trim() || null,
      sortOrder: input.sortOrder ?? 0,
    },
  });
  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "pta.compliance.requirement_created",
    entityType: "pta_compliance_requirement",
    entityId: requirement.id,
    metadata: { title },
  });
  return requirement;
}

export async function updateComplianceRequirement(input: UpsertComplianceInput & { requirementId: string }) {
  const existing = await prisma.ptaComplianceRequirement.findFirst({
    where: { id: input.requirementId, organizationId: input.organizationId },
  });
  if (!existing) throw new PtaError("PTA_COMPLIANCE_NOT_FOUND", "Requirement not found.");

  const requirement = await prisma.ptaComplianceRequirement.update({
    where: { id: existing.id },
    data: {
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
      ...(input.ownerName !== undefined ? { ownerName: input.ownerName?.trim() || null } : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
      ...(input.recurrence !== undefined ? { recurrence: input.recurrence } : {}),
      ...(input.isApplicable !== undefined ? { isApplicable: input.isApplicable } : {}),
      ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    },
  });
  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "pta.compliance.requirement_updated",
    entityType: "pta_compliance_requirement",
    entityId: requirement.id,
    metadata: { title: requirement.title },
  });
  return requirement;
}

/** Mark done now: stamps lastCompletedAt; a recurring requirement's due date
 * auto-advances by its interval, a one-off's due date clears. */
export async function completeComplianceRequirement(input: ActorInput & { organizationId: string; requirementId: string }) {
  const existing = await prisma.ptaComplianceRequirement.findFirst({
    where: { id: input.requirementId, organizationId: input.organizationId },
  });
  if (!existing) throw new PtaError("PTA_COMPLIANCE_NOT_FOUND", "Requirement not found.");

  const now = new Date();
  const nextDue = existing.dueDate && existing.recurrence !== "NONE" ? advanceDueDate(existing.dueDate, existing.recurrence) : null;
  const requirement = await prisma.ptaComplianceRequirement.update({
    where: { id: existing.id },
    data: { lastCompletedAt: now, dueDate: nextDue },
  });
  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "pta.compliance.requirement_completed",
    entityType: "pta_compliance_requirement",
    entityId: requirement.id,
    metadata: { title: existing.title, nextDue: nextDue?.toISOString() ?? null },
  });
  return requirement;
}

/** Apply the §22 suggestions — skips titles already tracked; never a seed
 * that runs on its own. */
export async function applySuggestedRequirements(input: ActorInput & { organizationId: string }) {
  const existing = await prisma.ptaComplianceRequirement.findMany({
    where: { organizationId: input.organizationId },
    select: { title: true },
  });
  const existingTitles = new Set(existing.map((row) => row.title.toLowerCase()));
  const toCreate = SUGGESTED_REQUIREMENTS.filter((suggestion) => !existingTitles.has(suggestion.title.toLowerCase()));

  const result = await prisma.ptaComplianceRequirement.createMany({
    data: toCreate.map((suggestion, index) => ({
      organizationId: input.organizationId,
      title: suggestion.title,
      ownerName: suggestion.ownerName,
      recurrence: suggestion.recurrence,
      sortOrder: existing.length + index,
    })),
    skipDuplicates: true,
  });
  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "pta.compliance.suggestions_applied",
    entityType: "pta_compliance_requirement",
    metadata: { created: result.count },
  });
  return result;
}
