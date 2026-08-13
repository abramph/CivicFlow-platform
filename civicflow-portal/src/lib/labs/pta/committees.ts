import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { PtaError } from "./errors";
import { getPtaProfile } from "./profile";
import { resolveSchoolYearId } from "./school-years";

export async function createPtaCommittee(organizationId: string, name: string, description: string | null | undefined, actorUserId: string, actorEmail?: string | null) {
  if (!name.trim()) throw new PtaError("PTA_VALIDATION_ERROR", "Committee name is required.");
  // PTA-B: new committees are stamped with the org's current school year
  // (label + FK, same dual-write convention as volunteer opportunities).
  const currentYearLabel = (await getPtaProfile(organizationId))?.currentSchoolYear ?? null;
  const committee = await prisma.ptaCommittee.create({
    data: {
      organizationId,
      name,
      description: description ?? null,
      schoolYear: currentYearLabel,
      schoolYearId: await resolveSchoolYearId(organizationId, currentYearLabel),
    },
  });
  await createAuditEvent({ organizationId, actorUserId, actorEmail: actorEmail ?? null, action: "pta.committee.created", entityType: "pta_committee", entityId: committee.id, metadata: { schoolYear: currentYearLabel } });
  return committee;
}

export interface UpdatePtaCommitteeInput {
  organizationId: string;
  committeeId: string;
  name?: string;
  description?: string | null;
  goals?: string | null;
  meetingSchedule?: string | null;
  status?: "PLANNING" | "ACTIVE" | "COMPLETED" | "ARCHIVED";
  schoolYearId?: string | null;
  boardLiaisonAdultId?: string | null;
  actorUserId: string;
  actorEmail?: string | null;
}

/** Full committee update — pta:committees:manage authority. Chairs use
 * updatePtaCommitteeAsChair below, which whitelists a smaller field set. */
export async function updatePtaCommittee(input: UpdatePtaCommitteeInput) {
  const existing = await prisma.ptaCommittee.findFirst({ where: { id: input.committeeId, organizationId: input.organizationId } });
  if (!existing) throw new PtaError("PTA_COMMITTEE_NOT_FOUND", "Committee not found in this organization.");

  const name = input.name?.trim();
  if (name !== undefined && !name) throw new PtaError("PTA_VALIDATION_ERROR", "Committee name cannot be blank.");
  if (name !== undefined && name !== existing.name) {
    const clash = await prisma.ptaCommittee.findUnique({ where: { organizationId_name: { organizationId: input.organizationId, name } } });
    if (clash) throw new PtaError("PTA_VALIDATION_ERROR", `A committee named "${name}" already exists.`);
  }

  if (input.boardLiaisonAdultId) {
    const adult = await prisma.ptaHouseholdAdult.findFirst({ where: { id: input.boardLiaisonAdultId, organizationId: input.organizationId } });
    if (!adult) throw new PtaError("PTA_NOT_A_HOUSEHOLD_MEMBER", "Household adult not found in this organization.");
  }

  let schoolYearLabel: string | null | undefined = undefined;
  if (input.schoolYearId !== undefined) {
    if (input.schoolYearId === null) {
      schoolYearLabel = null;
    } else {
      const year = await prisma.ptaSchoolYear.findFirst({ where: { id: input.schoolYearId, organizationId: input.organizationId } });
      if (!year) throw new PtaError("PTA_SCHOOL_YEAR_NOT_FOUND", "School year not found.");
      schoolYearLabel = year.label;
    }
  }

  const committee = await prisma.ptaCommittee.update({
    where: { id: existing.id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.goals !== undefined ? { goals: input.goals } : {}),
      ...(input.meetingSchedule !== undefined ? { meetingSchedule: input.meetingSchedule } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.schoolYearId !== undefined ? { schoolYearId: input.schoolYearId, schoolYear: schoolYearLabel } : {}),
      ...(input.boardLiaisonAdultId !== undefined ? { boardLiaisonAdultId: input.boardLiaisonAdultId } : {}),
    },
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "pta.committee.updated",
    entityType: "pta_committee",
    entityId: committee.id,
    metadata: { before: { name: existing.name, status: existing.status }, after: { name: committee.name, status: committee.status } },
  });
  return committee;
}

/** Chair-scoped update — the whitelist IS the authorization boundary: a
 * chair/co-chair may describe and organize their own committee, but never
 * rename it, change its lifecycle status/year, reassign leadership, or touch
 * any other committee (the guard already pinned committeeId to their own). */
export async function updatePtaCommitteeAsChair(input: {
  organizationId: string;
  committeeId: string;
  description?: string | null;
  goals?: string | null;
  meetingSchedule?: string | null;
  actorUserId: string;
  actorEmail?: string | null;
}) {
  const existing = await prisma.ptaCommittee.findFirst({ where: { id: input.committeeId, organizationId: input.organizationId } });
  if (!existing) throw new PtaError("PTA_COMMITTEE_NOT_FOUND", "Committee not found in this organization.");

  const committee = await prisma.ptaCommittee.update({
    where: { id: existing.id },
    data: {
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.goals !== undefined ? { goals: input.goals } : {}),
      ...(input.meetingSchedule !== undefined ? { meetingSchedule: input.meetingSchedule } : {}),
    },
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "pta.committee.updated_by_chair",
    entityType: "pta_committee",
    entityId: committee.id,
    metadata: {},
  });
  return committee;
}

export async function listPtaCommittees(organizationId: string) {
  return prisma.ptaCommittee.findMany({ where: { organizationId }, include: { chair: true, coChair: true, members: { include: { householdAdult: true } } }, orderBy: { name: "asc" } });
}

export async function getPtaCommittee(organizationId: string, committeeId: string) {
  const committee = await prisma.ptaCommittee.findFirst({ where: { id: committeeId, organizationId }, include: { chair: true, coChair: true, members: { include: { householdAdult: true } } } });
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

/** Mirrors setPtaCommitteeChair exactly -- a separate function rather than a
 * shared "set chair-like role" helper, since chair/co-chair are deliberately
 * two independent fields (a committee can have a co-chair with no chair set,
 * or vice versa), not a list. */
export async function setPtaCommitteeCoChair(organizationId: string, committeeId: string, coChairAdultId: string | null, actorUserId: string, actorEmail?: string | null) {
  const committee = await prisma.ptaCommittee.findFirst({ where: { id: committeeId, organizationId } });
  if (!committee) throw new PtaError("PTA_COMMITTEE_NOT_FOUND", "Committee not found in this organization.");

  if (coChairAdultId) {
    const adult = await prisma.ptaHouseholdAdult.findFirst({ where: { id: coChairAdultId, organizationId } });
    if (!adult) throw new PtaError("PTA_NOT_A_HOUSEHOLD_MEMBER", "Household adult not found in this organization.");
  }

  const updated = await prisma.ptaCommittee.update({ where: { id: committee.id }, data: { coChairAdultId } });
  await createAuditEvent({ organizationId, actorUserId, actorEmail: actorEmail ?? null, action: "pta.committee.co_chair_set", entityType: "pta_committee", entityId: committee.id, metadata: { coChairAdultId } });
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

/**
 * Every OrgMember id (billing identity) for a committee's households — used
 * by committee-targeted communications. Includes the chair and co-chair
 * even if they were never separately added via addPtaCommitteeMember: those
 * two roles live on PtaCommittee.chairAdultId/coChairAdultId, a field
 * distinct from the PtaCommitteeMember join table (see the doc comment on
 * setPtaCommitteeChair/setPtaCommitteeCoChair), and a chair who was set but
 * never also added as a member would otherwise silently never receive
 * committee communications despite being its chair.
 */
export async function getCommitteeTargetMemberIds(organizationId: string, committeeId: string): Promise<string[]> {
  const committee = await prisma.ptaCommittee.findFirst({
    where: { id: committeeId, organizationId },
    include: {
      chair: { include: { household: { select: { orgMemberId: true } } } },
      coChair: { include: { household: { select: { orgMemberId: true } } } },
      members: { include: { householdAdult: { include: { household: { select: { orgMemberId: true } } } } } },
    },
  });
  if (!committee) throw new PtaError("PTA_COMMITTEE_NOT_FOUND", "Committee not found in this organization.");

  const ids = [
    committee.chair?.household.orgMemberId,
    committee.coChair?.household.orgMemberId,
    ...committee.members.map((m) => m.householdAdult.household.orgMemberId),
  ];
  return Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
}
