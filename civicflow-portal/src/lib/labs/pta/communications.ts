import { prisma } from "@/lib/prisma";
import { z } from "@/lib/validation";
import { PtaError } from "./errors";
import { getCommitteeTargetMemberIds } from "./committees";

/**
 * Resolves a PTA-specific targeting rule into a list of OrgMember ids (the
 * households' billing identities) — fed into the EXISTING, unmodified
 * CommunicationCampaign pipeline via its "manual" selector + memberIds list
 * (see resolveCommunicationRecipients() in src/lib/communication-campaigns.ts).
 * No new targeting engine, no new send/opt-in/STOP-HELP logic — this module
 * only ever produces an id list. Never returns or logs a student name.
 *
 * Every branch that accepts a target entity id (gradeId/classroomId/
 * committeeId/eventId) explicitly verifies that entity belongs to
 * `organizationId` before resolving anything from it, and throws the same
 * PTA_*_NOT_FOUND error the rest of this module already uses for a
 * cross-tenant id — this is a real ownership guard, not just an
 * empty-result side effect of every downstream query also being
 * organizationId-scoped (which they still are, as defense in depth).
 */

export type PtaTargetingRule =
  | { type: "all" }
  | { type: "grade"; gradeId: string; schoolYear: string }
  | { type: "classroom"; classroomId: string; schoolYear: string }
  | { type: "committee"; committeeId: string }
  | { type: "volunteers_for_event"; eventId: string }
  | { type: "unpaid"; schoolYear: string };

/**
 * Runtime validator matching PtaTargetingRule exactly — the campaign create
 * schema accepts recipientFilter as an opaque JSON object (it has to, since
 * every existing non-PTA selector shape lives there too), so a ptaRule
 * value arriving over HTTP has no compile-time guarantee of matching the
 * TS type above. Used at the one place resolveCommunicationRecipients()
 * accepts a ptaRule, so a malformed/unknown rule.type fails loudly with a
 * validation error instead of silently falling through
 * resolvePtaTargetMemberIds()'s switch and returning undefined.
 */
export const ptaTargetingRuleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("all") }),
  z.object({ type: z.literal("grade"), gradeId: z.string().min(1), schoolYear: z.string().min(1) }),
  z.object({ type: z.literal("classroom"), classroomId: z.string().min(1), schoolYear: z.string().min(1) }),
  z.object({ type: z.literal("committee"), committeeId: z.string().min(1) }),
  z.object({ type: z.literal("volunteers_for_event"), eventId: z.string().min(1) }),
  z.object({ type: z.literal("unpaid"), schoolYear: z.string().min(1) }),
]);

export async function resolvePtaTargetMemberIds(organizationId: string, rule: PtaTargetingRule): Promise<string[]> {
  switch (rule.type) {
    case "all": {
      const households = await prisma.ptaHousehold.findMany({ where: { organizationId, status: "ACTIVE" }, select: { orgMemberId: true } });
      return dedupe(households.map((h) => h.orgMemberId));
    }
    case "grade": {
      const grade = await prisma.ptaGrade.findFirst({ where: { id: rule.gradeId, organizationId } });
      if (!grade) throw new PtaError("PTA_GRADE_NOT_FOUND", "Grade not found in this organization.");

      const classrooms = await prisma.ptaClassroom.findMany({ where: { organizationId, gradeId: rule.gradeId, schoolYear: rule.schoolYear }, select: { id: true } });
      const classroomIds = classrooms.map((c) => c.id);
      const enrollments = await prisma.ptaStudentEnrollment.findMany({
        where: {
          organizationId,
          classroomId: { in: classroomIds },
          schoolYear: rule.schoolYear,
          status: "ACTIVE",
          student: { status: "ACTIVE", household: { status: "ACTIVE" } },
        },
        include: { student: { include: { household: { select: { orgMemberId: true } } } } },
      });
      return dedupe(enrollments.map((e) => e.student.household.orgMemberId));
    }
    case "classroom": {
      const classroom = await prisma.ptaClassroom.findFirst({ where: { id: rule.classroomId, organizationId } });
      if (!classroom) throw new PtaError("PTA_CLASSROOM_NOT_FOUND", "Classroom not found in this organization.");

      const enrollments = await prisma.ptaStudentEnrollment.findMany({
        where: {
          organizationId,
          classroomId: rule.classroomId,
          schoolYear: rule.schoolYear,
          status: "ACTIVE",
          student: { status: "ACTIVE", household: { status: "ACTIVE" } },
        },
        include: { student: { include: { household: { select: { orgMemberId: true } } } } },
      });
      return dedupe(enrollments.map((e) => e.student.household.orgMemberId));
    }
    case "committee":
      return getCommitteeTargetMemberIds(organizationId, rule.committeeId);
    case "volunteers_for_event": {
      const event = await prisma.event.findFirst({ where: { id: rule.eventId, organizationId } });
      if (!event) throw new PtaError("PTA_EVENT_NOT_FOUND", "Event not found in this organization.");

      // An event can have more than one volunteer opportunity (setup crew,
      // day-of staffing, cleanup, ...) — fan out across all of them rather
      // than requiring the caller to already know a specific opportunityId,
      // matching "message this event's volunteers" as a single audience.
      const opportunities = await prisma.ptaVolunteerOpportunity.findMany({ where: { organizationId, eventId: rule.eventId }, select: { id: true } });
      const opportunityIds = opportunities.map((o) => o.id);

      const signups = await prisma.ptaVolunteerSignup.findMany({
        where: { organizationId, status: "SIGNED_UP", slot: { opportunityId: { in: opportunityIds } } },
        include: { householdAdult: { include: { household: { select: { orgMemberId: true } } } } },
      });
      return dedupe(signups.map((s) => s.householdAdult.household.orgMemberId));
    }
    case "unpaid": {
      // Reuses the platform's existing "outstanding dues" convention
      // (status PENDING/PARTIAL), the same predicate already used by
      // src/lib/communication-campaigns.ts's "outstanding_dues" selector and
      // src/lib/member-filters.ts's hasOutstandingDues filter — not a new or
      // parallel definition of "unpaid."
      const households = await prisma.ptaHousehold.findMany({
        where: {
          organizationId,
          schoolYear: rule.schoolYear,
          status: "ACTIVE",
          orgMember: { duesCharges: { some: { organizationId, status: { in: ["PENDING", "PARTIAL"] } } } },
        },
        select: { orgMemberId: true },
      });
      return dedupe(households.map((h) => h.orgMemberId));
    }
  }
}

function dedupe(ids: (string | null)[]): string[] {
  return Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
}
