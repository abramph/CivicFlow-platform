import { prisma } from "@/lib/prisma";
import { getCommitteeTargetMemberIds } from "./committees";

/**
 * Resolves a PTA-specific targeting rule into a list of OrgMember ids (the
 * households' billing identities) — fed into the EXISTING, unmodified
 * CommunicationCampaign pipeline via its "manual" selector + memberIds list
 * (see resolveCommunicationRecipients() in src/lib/communication-campaigns.ts).
 * No new targeting engine, no new send/opt-in/STOP-HELP logic — this module
 * only ever produces an id list. Never returns or logs a student name.
 */

export type PtaTargetingRule =
  | { type: "all" }
  | { type: "grade"; gradeId: string; schoolYear: string }
  | { type: "classroom"; classroomId: string; schoolYear: string }
  | { type: "committee"; committeeId: string }
  | { type: "volunteers_for_event"; opportunityId: string }
  | { type: "unpaid"; schoolYear: string };

export async function resolvePtaTargetMemberIds(organizationId: string, rule: PtaTargetingRule): Promise<string[]> {
  switch (rule.type) {
    case "all": {
      const households = await prisma.ptaHousehold.findMany({ where: { organizationId, status: "ACTIVE" }, select: { orgMemberId: true } });
      return dedupe(households.map((h) => h.orgMemberId));
    }
    case "grade": {
      const classrooms = await prisma.ptaClassroom.findMany({ where: { organizationId, gradeId: rule.gradeId, schoolYear: rule.schoolYear }, select: { id: true } });
      const classroomIds = classrooms.map((c) => c.id);
      const enrollments = await prisma.ptaStudentEnrollment.findMany({
        where: { organizationId, classroomId: { in: classroomIds }, schoolYear: rule.schoolYear, status: "ACTIVE" },
        include: { student: { include: { household: { select: { orgMemberId: true } } } } },
      });
      return dedupe(enrollments.map((e) => e.student.household.orgMemberId));
    }
    case "classroom": {
      const enrollments = await prisma.ptaStudentEnrollment.findMany({
        where: { organizationId, classroomId: rule.classroomId, schoolYear: rule.schoolYear, status: "ACTIVE" },
        include: { student: { include: { household: { select: { orgMemberId: true } } } } },
      });
      return dedupe(enrollments.map((e) => e.student.household.orgMemberId));
    }
    case "committee":
      return getCommitteeTargetMemberIds(organizationId, rule.committeeId);
    case "volunteers_for_event": {
      const signups = await prisma.ptaVolunteerSignup.findMany({
        where: { organizationId, status: "SIGNED_UP", slot: { opportunityId: rule.opportunityId } },
        include: { householdAdult: { include: { household: { select: { orgMemberId: true } } } } },
      });
      return dedupe(signups.map((s) => s.householdAdult.household.orgMemberId));
    }
    case "unpaid": {
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
