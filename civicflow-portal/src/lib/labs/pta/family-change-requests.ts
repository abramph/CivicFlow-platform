import type { PtaFamilyChangeRequestType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { z } from "@/lib/validation";
import { enrollPtaStudent } from "./academic";
import { PtaError } from "./errors";
import { addPtaStudent, deactivatePtaStudent, renamePtaStudent, updatePtaHousehold } from "./households";
import { getPtaProfile } from "./profile";

/**
 * Build 27 — parent-submitted family change requests, the Member-Intake
 * review pattern (typed payload → sensitivity gate → CAS-claimed decision →
 * one apply engine) rebuilt on PTA tables (that program's FKs are
 * OrgMember-bound; a parent is a PtaHouseholdAdult).
 *
 * The classification driving this module (docs/build27-pta-mobile-audit-and-plan.md §Batch 2):
 * a parent edits their OWN contact row and the household's volunteer
 * interests directly (households.ts self-service functions); everything that
 * touches organization-controlled or identity-bearing records — household
 * display name, the student roster, placements — goes through a request an
 * officer approves. An APPROVED request is APPLIED through the same service
 * functions officers use (updatePtaHousehold / addPtaStudent /
 * renamePtaStudent / enrollPtaStudent / deactivatePtaStudent), so approval
 * always lands on the authoritative records — never inert JSON.
 *
 * Concurrency: the decision transition is a single conditional updateMany
 * (SUBMITTED → APPROVED/REJECTED). Two racing reviewers cannot both win; the
 * loser gets PTA_CHANGE_REQUEST_ALREADY_DECIDED. If applying an approved
 * request fails, the claim is rolled back to SUBMITTED so the queue never
 * strands a request in a half-decided state.
 */

const MAX_OPEN_REQUESTS_PER_HOUSEHOLD = 25;

const payloadSchemas = {
  HOUSEHOLD_DISPLAY_NAME: z.object({ displayName: z.string().trim().min(1).max(120) }),
  ADD_STUDENT: z.object({ displayName: z.string().trim().min(1).max(120) }),
  RENAME_STUDENT: z.object({ studentId: z.string().min(1), displayName: z.string().trim().min(1).max(120) }),
  STUDENT_PLACEMENT: z.object({ studentId: z.string().min(1), classroomId: z.string().min(1) }),
  REMOVE_STUDENT: z.object({ studentId: z.string().min(1) }),
} as const;

export type FamilyChangeRequestPayload =
  | { type: "HOUSEHOLD_DISPLAY_NAME"; payload: z.infer<(typeof payloadSchemas)["HOUSEHOLD_DISPLAY_NAME"]> }
  | { type: "ADD_STUDENT"; payload: z.infer<(typeof payloadSchemas)["ADD_STUDENT"]> }
  | { type: "RENAME_STUDENT"; payload: z.infer<(typeof payloadSchemas)["RENAME_STUDENT"]> }
  | { type: "STUDENT_PLACEMENT"; payload: z.infer<(typeof payloadSchemas)["STUDENT_PLACEMENT"]> }
  | { type: "REMOVE_STUDENT"; payload: z.infer<(typeof payloadSchemas)["REMOVE_STUDENT"]> };

export interface SubmitFamilyChangeRequestInput {
  organizationId: string;
  householdId: string;
  submittedByAdultId: string;
  type: PtaFamilyChangeRequestType;
  payload: unknown;
  actorUserId: string;
  actorEmail?: string | null;
}

/** Validates and files a parent's change request. Every entity the payload
 * references is verified to belong to the caller's own household (students)
 * or organization + current school year (classrooms) at SUBMIT time — and
 * verified again at APPLY time, since the world can change in between. */
export async function submitFamilyChangeRequest(input: SubmitFamilyChangeRequestInput) {
  const schema = payloadSchemas[input.type];
  const parsed = schema.safeParse(input.payload);
  if (!parsed.success) {
    throw new PtaError("PTA_VALIDATION_ERROR", "The change request is incomplete or invalid.");
  }
  const payload = parsed.data;

  await assertPayloadReferencesValid(input.organizationId, input.householdId, input.type, payload);

  const openCount = await prisma.ptaFamilyChangeRequest.count({
    where: { organizationId: input.organizationId, householdId: input.householdId, status: "SUBMITTED" },
  });
  if (openCount >= MAX_OPEN_REQUESTS_PER_HOUSEHOLD) {
    throw new PtaError("PTA_CHANGE_REQUEST_LIMIT_REACHED", "Your household already has the maximum number of pending requests. Please wait for review.");
  }

  const request = await prisma.ptaFamilyChangeRequest.create({
    data: {
      organizationId: input.organizationId,
      householdId: input.householdId,
      submittedByAdultId: input.submittedByAdultId,
      type: input.type,
      payload: payload as Prisma.InputJsonValue,
    },
  });

  // Ids and the request type only — payload values (names) stay out of the
  // audit trail, matching the student data-minimization rule.
  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "pta.family_change_request.submitted",
    entityType: "pta_family_change_request",
    entityId: request.id,
    metadata: { type: input.type, householdId: input.householdId },
  });

  return request;
}

async function assertPayloadReferencesValid(
  organizationId: string,
  householdId: string,
  type: PtaFamilyChangeRequestType,
  payload: Record<string, unknown>
) {
  if (type === "RENAME_STUDENT" || type === "STUDENT_PLACEMENT" || type === "REMOVE_STUDENT") {
    const student = await prisma.ptaStudent.findFirst({
      where: { id: payload.studentId as string, householdId, organizationId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!student) throw new PtaError("PTA_STUDENT_NOT_FOUND", "That student isn't part of your household.");
  }
  if (type === "STUDENT_PLACEMENT") {
    const profile = await getPtaProfile(organizationId);
    if (!profile?.currentSchoolYear) {
      throw new PtaError("PTA_VALIDATION_ERROR", "This organization has no current school year configured.");
    }
    const classroom = await prisma.ptaClassroom.findFirst({
      where: { id: payload.classroomId as string, organizationId, schoolYear: profile.currentSchoolYear },
      select: { id: true },
    });
    if (!classroom) throw new PtaError("PTA_CLASSROOM_NOT_FOUND", "That classroom isn't available for the current school year.");
  }
}

export function listFamilyChangeRequestsForHousehold(organizationId: string, householdId: string) {
  return prisma.ptaFamilyChangeRequest.findMany({
    where: { organizationId, householdId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export function listFamilyChangeRequests(organizationId: string, filters: { status?: "SUBMITTED" | "APPROVED" | "APPLIED" | "REJECTED" } = {}) {
  return prisma.ptaFamilyChangeRequest.findMany({
    where: { organizationId, ...(filters.status ? { status: filters.status } : {}) },
    orderBy: { createdAt: "asc" },
    take: 200,
    include: { household: { select: { displayName: true } } },
  });
}

export function countPendingFamilyChangeRequests(organizationId: string) {
  return prisma.ptaFamilyChangeRequest.count({ where: { organizationId, status: "SUBMITTED" } });
}

export interface DecideFamilyChangeRequestInput {
  organizationId: string;
  requestId: string;
  decisionNotes?: string | null;
  actorUserId: string;
  actorEmail?: string | null;
}

export async function approveFamilyChangeRequest(input: DecideFamilyChangeRequestInput) {
  const request = await prisma.ptaFamilyChangeRequest.findFirst({
    where: { id: input.requestId, organizationId: input.organizationId },
  });
  if (!request) throw new PtaError("PTA_CHANGE_REQUEST_NOT_FOUND", "Change request not found in this organization.");

  // CAS claim — exactly one reviewer wins a race.
  const claim = await prisma.ptaFamilyChangeRequest.updateMany({
    where: { id: request.id, status: "SUBMITTED" },
    data: { status: "APPROVED", reviewedByUserId: input.actorUserId, reviewedAt: new Date(), decisionNotes: input.decisionNotes ?? null },
  });
  if (claim.count === 0) {
    throw new PtaError("PTA_CHANGE_REQUEST_ALREADY_DECIDED", "This request has already been reviewed.");
  }

  try {
    await applyFamilyChangeRequest(input.organizationId, request.householdId, request.type, request.payload as Record<string, unknown>, input.actorUserId, input.actorEmail ?? null);
  } catch (error) {
    // Roll the claim back so the request re-enters the queue instead of
    // stranding as APPROVED-but-never-applied.
    await prisma.ptaFamilyChangeRequest.updateMany({
      where: { id: request.id, status: "APPROVED" },
      data: { status: "SUBMITTED", reviewedByUserId: null, reviewedAt: null, decisionNotes: null },
    });
    throw error;
  }

  const applied = await prisma.ptaFamilyChangeRequest.update({
    where: { id: request.id },
    data: { status: "APPLIED", appliedAt: new Date() },
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "pta.family_change_request.approved",
    entityType: "pta_family_change_request",
    entityId: request.id,
    metadata: { type: request.type, householdId: request.householdId },
  });

  return applied;
}

/** Writes the approved change onto the real records via the same services
 * officers use directly — each of which performs its own org-scoping,
 * validation, and audit event. Re-validates every payload reference because
 * the household may have changed since submission. */
async function applyFamilyChangeRequest(
  organizationId: string,
  householdId: string,
  type: PtaFamilyChangeRequestType,
  payload: Record<string, unknown>,
  actorUserId: string,
  actorEmail: string | null
) {
  await assertPayloadReferencesValid(organizationId, householdId, type, payload);

  switch (type) {
    case "HOUSEHOLD_DISPLAY_NAME":
      await updatePtaHousehold({ organizationId, householdId, displayName: payload.displayName as string, actorUserId, actorEmail });
      return;
    case "ADD_STUDENT":
      await addPtaStudent({ organizationId, householdId, displayName: payload.displayName as string, actorUserId, actorEmail });
      return;
    case "RENAME_STUDENT":
      await renamePtaStudent({ organizationId, householdId, studentId: payload.studentId as string, displayName: payload.displayName as string, actorUserId, actorEmail });
      return;
    case "STUDENT_PLACEMENT": {
      const profile = await getPtaProfile(organizationId);
      if (!profile?.currentSchoolYear) {
        throw new PtaError("PTA_VALIDATION_ERROR", "This organization has no current school year configured.");
      }
      await enrollPtaStudent(organizationId, payload.studentId as string, payload.classroomId as string, profile.currentSchoolYear, actorUserId, actorEmail);
      return;
    }
    case "REMOVE_STUDENT":
      await deactivatePtaStudent(organizationId, householdId, payload.studentId as string, actorUserId, actorEmail);
      return;
  }
}

export async function rejectFamilyChangeRequest(input: DecideFamilyChangeRequestInput) {
  const request = await prisma.ptaFamilyChangeRequest.findFirst({
    where: { id: input.requestId, organizationId: input.organizationId },
  });
  if (!request) throw new PtaError("PTA_CHANGE_REQUEST_NOT_FOUND", "Change request not found in this organization.");

  const claim = await prisma.ptaFamilyChangeRequest.updateMany({
    where: { id: request.id, status: "SUBMITTED" },
    data: { status: "REJECTED", reviewedByUserId: input.actorUserId, reviewedAt: new Date(), decisionNotes: input.decisionNotes ?? null },
  });
  if (claim.count === 0) {
    throw new PtaError("PTA_CHANGE_REQUEST_ALREADY_DECIDED", "This request has already been reviewed.");
  }

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "pta.family_change_request.rejected",
    entityType: "pta_family_change_request",
    entityId: request.id,
    metadata: { type: request.type, householdId: request.householdId },
  });

  return prisma.ptaFamilyChangeRequest.findUnique({ where: { id: request.id } });
}
