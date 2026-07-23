import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { PtaError } from "./errors";

/** Grades, classrooms, teachers, and year-scoped student enrollment. Teacher records carry no `userId` at all — they are never authenticated accounts and never automatically receive household/payment access. */

export async function listPtaGrades(organizationId: string) {
  return prisma.ptaGrade.findMany({ where: { organizationId }, orderBy: { sortOrder: "asc" } });
}

export async function createPtaGrade(organizationId: string, name: string, sortOrder: number, actorUserId: string, actorEmail?: string | null) {
  if (!name.trim()) throw new PtaError("PTA_VALIDATION_ERROR", "Grade name is required.");
  const grade = await prisma.ptaGrade.create({ data: { organizationId, name, sortOrder } });
  await createAuditEvent({ organizationId, actorUserId, actorEmail: actorEmail ?? null, action: "pta.grade.created", entityType: "pta_grade", entityId: grade.id, metadata: {} });
  return grade;
}

export async function listPtaTeachers(organizationId: string) {
  return prisma.ptaTeacher.findMany({ where: { organizationId }, orderBy: { name: "asc" } });
}

export async function createPtaTeacher(organizationId: string, name: string, email: string | null | undefined, actorUserId: string, actorEmail?: string | null) {
  if (!name.trim()) throw new PtaError("PTA_VALIDATION_ERROR", "Teacher name is required.");
  const teacher = await prisma.ptaTeacher.create({ data: { organizationId, name, email: email ?? null } });
  await createAuditEvent({ organizationId, actorUserId, actorEmail: actorEmail ?? null, action: "pta.teacher.created", entityType: "pta_teacher", entityId: teacher.id, metadata: {} });
  return teacher;
}

export interface CreateClassroomInput {
  organizationId: string;
  gradeId: string;
  name: string;
  schoolYear: string;
  teacherId?: string | null;
  actorUserId: string;
  actorEmail?: string | null;
}

export async function createPtaClassroom(input: CreateClassroomInput) {
  const grade = await prisma.ptaGrade.findFirst({ where: { id: input.gradeId, organizationId: input.organizationId } });
  if (!grade) throw new PtaError("PTA_GRADE_NOT_FOUND", "Grade not found in this organization.");
  if (!input.name.trim()) throw new PtaError("PTA_VALIDATION_ERROR", "Classroom name is required.");

  if (input.teacherId) {
    const teacher = await prisma.ptaTeacher.findFirst({ where: { id: input.teacherId, organizationId: input.organizationId } });
    if (!teacher) throw new PtaError("PTA_TEACHER_NOT_FOUND", "Teacher not found in this organization.");
  }

  const classroom = await prisma.ptaClassroom.create({
    data: { organizationId: input.organizationId, gradeId: grade.id, name: input.name, schoolYear: input.schoolYear, teacherId: input.teacherId ?? null },
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "pta.classroom.created",
    entityType: "pta_classroom",
    entityId: classroom.id,
    metadata: { schoolYear: input.schoolYear },
  });

  return classroom;
}

export async function listPtaClassrooms(organizationId: string, schoolYear: string) {
  return prisma.ptaClassroom.findMany({
    where: { organizationId, schoolYear },
    include: { grade: true, teacher: true },
    orderBy: [{ grade: { sortOrder: "asc" } }, { name: "asc" }],
  });
}

/**
 * Year-scoped enrollment — a new row per (student, schoolYear), never
 * overwriting a prior year's row. This is what makes school-year rollover
 * safe: enrolling a student in the new year's classroom leaves every prior
 * year's enrollment record untouched.
 */
export async function enrollPtaStudent(organizationId: string, studentId: string, classroomId: string, schoolYear: string, actorUserId: string, actorEmail?: string | null) {
  const student = await prisma.ptaStudent.findFirst({ where: { id: studentId, organizationId } });
  if (!student) throw new PtaError("PTA_STUDENT_NOT_FOUND", "Student not found in this organization.");
  const classroom = await prisma.ptaClassroom.findFirst({ where: { id: classroomId, organizationId } });
  if (!classroom) throw new PtaError("PTA_CLASSROOM_NOT_FOUND", "Classroom not found in this organization.");

  const enrollment = await prisma.ptaStudentEnrollment.upsert({
    where: { studentId_schoolYear: { studentId, schoolYear } },
    create: { organizationId, studentId, classroomId, schoolYear },
    update: { classroomId },
  });

  await createAuditEvent({
    organizationId,
    actorUserId,
    actorEmail: actorEmail ?? null,
    action: "pta.student.enrolled",
    entityType: "pta_student",
    entityId: studentId,
    metadata: { schoolYear, classroomId },
  });

  return enrollment;
}

export async function getPtaStudentEnrollment(organizationId: string, studentId: string, schoolYear: string) {
  return prisma.ptaStudentEnrollment.findFirst({
    where: { organizationId, studentId, schoolYear },
    include: { classroom: { include: { grade: true, teacher: true } } },
  });
}

/** Returns every currently-enrolled student in a classroom for a school year — used by classroom-targeted communications. Never includes household financial data. */
export async function listStudentsInClassroom(organizationId: string, classroomId: string, schoolYear: string) {
  return prisma.ptaStudentEnrollment.findMany({
    where: { organizationId, classroomId, schoolYear, status: "ACTIVE" },
    include: { student: { select: { id: true, displayName: true, householdId: true } } },
  });
}
