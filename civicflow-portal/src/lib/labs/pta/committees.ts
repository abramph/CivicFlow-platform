import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { PtaError } from "./errors";

export async function createPtaCommittee(organizationId: string, name: string, description: string | null | undefined, actorUserId: string, actorEmail?: string | null) {
  if (!name.trim()) throw new PtaError("PTA_VALIDATION_ERROR", "Committee name is required.");
  const committee = await prisma.ptaCommittee.create({ data: { organizationId, name, description: description ?? null } });
  await createAuditEvent({ organizationId, actorUserId, actorEmail: actorEmail ?? null, action: "pta.committee.created", entityType: "pta_committee", entityId: committee.id, metadata: {} });
  return committee;
}

export async function listPtaCommittees(organizationId: string) {
  return prisma.ptaCommittee.findMany({ where: { organizationId }, include: { chair: true, members: { include: { householdAdult: true } } }, orderBy: { name: "asc" } });
}

export async function getPtaCommittee(organizationId: string, committeeId: string) {
  const committee = await prisma.ptaCommittee.findFirst({ where: { id: committeeId, organizationId }, include: { chair: true, members: { include: { householdAdult: true } } } });
  if (!committee) throw new PtaError("PTA_COMMITTEE_NOT_FOUND", "Committee not found in this organization.");
  return committee;
}

export async function setPtaCommitteeChair(organizationId: string, committeeId: string, chairAdultId: string | null, actorUserId: string, actorEmail?: string | null) {
  const committee = await prisma.ptaCommittee.findFirst({ where: { id: committeeId, organizationId } });
  if (!committee) throw new PtaError("PTA_COMMITTEE_NOT_FOUND", "Committee not found in this organization.");

  if (chairAdultId) {
    const adult = await prisma.ptaHouseholdAdult.findFirst({ where: { id: chairAdultId, organizationId } });
    if (!adult) throw new PtaError("PTA_NOT_A_HOUSEHOLD_MEMBER", "Household adult not found in this organization.");
  }

  const updated = await prisma.ptaCommittee.update({ where: { id: committee.id }, data: { chairAdultId } });
  await createAuditEvent({ organizationId, actorUserId, actorEmail: actorEmail ?? null, action: "pta.committee.chair_set", entityType: "pta_committee", entityId: committee.id, metadata: { chairAdultId } });
  return updated;
}

export async function addPtaCommitteeMember(organizationId: string, committeeId: string, householdAdultId: string, actorUserId: string, actorEmail?: string | null) {
  const committee = await prisma.ptaCommittee.findFirst({ where: { id: committeeId, organizationId } });
  if (!committee) throw new PtaError("PTA_COMMITTEE_NOT_FOUND", "Committee not found in this organization.");
  const adult = await prisma.ptaHouseholdAdult.findFirst({ where: { id: householdAdultId, organizationId } });
  if (!adult) throw new PtaError("PTA_NOT_A_HOUSEHOLD_MEMBER", "Household adult not found in this organization.");

  const member = await prisma.ptaCommitteeMember.upsert({
    where: { committeeId_householdAdultId: { committeeId, householdAdultId } },
    create: { organizationId, committeeId, householdAdultId },
    update: {},
  });

  await createAuditEvent({ organizationId, actorUserId, actorEmail: actorEmail ?? null, action: "pta.committee_member.added", entityType: "pta_committee", entityId: committee.id, metadata: { householdAdultId } });
  return member;
}

export async function removePtaCommitteeMember(organizationId: string, committeeId: string, householdAdultId: string, actorUserId: string, actorEmail?: string | null) {
  const member = await prisma.ptaCommitteeMember.findFirst({ where: { committeeId, householdAdultId, organizationId } });
  if (!member) return;
  await prisma.ptaCommitteeMember.delete({ where: { id: member.id } });
  await createAuditEvent({ organizationId, actorUserId, actorEmail: actorEmail ?? null, action: "pta.committee_member.removed", entityType: "pta_committee", entityId: committeeId, metadata: { householdAdultId } });
}

/** Every OrgMember id (billing identity) for a committee's members' households — used by committee-targeted communications. */
export async function getCommitteeTargetMemberIds(organizationId: string, committeeId: string): Promise<string[]> {
  const members = await prisma.ptaCommitteeMember.findMany({
    where: { organizationId, committeeId },
    include: { householdAdult: { include: { household: { select: { orgMemberId: true } } } } },
  });
  const ids = members.map((m) => m.householdAdult.household.orgMemberId).filter((id): id is string => Boolean(id));
  return Array.from(new Set(ids));
}
