import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { PtaError } from "../errors";

/**
 * spec §8/§15: "report a missing or incorrect volunteer record" — a
 * lightweight household-submitted flag. This never itself alters any hour
 * entry; an officer investigates and makes any correction through the
 * existing approve/reject/adjust tools (volunteers.ts).
 */
export async function createHourDispute(
  organizationId: string,
  requirementPeriodId: string,
  householdId: string,
  description: string,
  actorUserId: string
) {
  if (!description.trim()) {
    throw new PtaError("PTA_VALIDATION_ERROR", "Describe the missing or incorrect volunteer activity.");
  }

  const dispute = await prisma.ptaVolunteerHourDispute.create({
    data: { organizationId, requirementPeriodId, householdId, submittedByUserId: actorUserId, description: description.trim() },
  });

  await createAuditEvent({
    organizationId,
    actorUserId,
    action: "pta.volunteer_hours.dispute_submitted",
    entityType: "pta_volunteer_hour_dispute",
    entityId: dispute.id,
    metadata: { requirementPeriodId, householdId },
  });

  return dispute;
}

export async function listHouseholdDisputes(organizationId: string, householdId: string) {
  return prisma.ptaVolunteerHourDispute.findMany({ where: { organizationId, householdId }, orderBy: { createdAt: "desc" } });
}

export async function listPeriodDisputes(organizationId: string, requirementPeriodId: string) {
  return prisma.ptaVolunteerHourDispute.findMany({ where: { organizationId, requirementPeriodId }, orderBy: { createdAt: "desc" } });
}

export async function resolveHourDispute(
  organizationId: string,
  disputeId: string,
  status: "RESOLVED" | "DISMISSED",
  adminNotes: string | null,
  actorUserId: string
) {
  const existing = await prisma.ptaVolunteerHourDispute.findFirst({ where: { id: disputeId, organizationId } });
  if (!existing) throw new PtaError("PTA_VALIDATION_ERROR", "Dispute not found in this organization.");

  const dispute = await prisma.ptaVolunteerHourDispute.update({
    where: { id: disputeId },
    data: { status, adminNotes: adminNotes?.trim() || null, resolvedByUserId: actorUserId, resolvedAt: new Date() },
  });

  await createAuditEvent({
    organizationId,
    actorUserId,
    action: "pta.volunteer_hours.dispute_resolved",
    entityType: "pta_volunteer_hour_dispute",
    entityId: dispute.id,
    metadata: { status, adminNotes },
  });

  return dispute;
}
