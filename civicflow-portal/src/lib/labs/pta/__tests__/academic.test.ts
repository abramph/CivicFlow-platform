import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstGrade = vi.fn();
const findFirstTeacher = vi.fn();
const findFirstStudent = vi.fn();
const findFirstClassroom = vi.fn();
const createClassroom = vi.fn();
const upsertEnrollment = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaGrade: { findFirst: (...a: unknown[]) => findFirstGrade(...a) },
    ptaTeacher: { findFirst: (...a: unknown[]) => findFirstTeacher(...a) },
    ptaStudent: { findFirst: (...a: unknown[]) => findFirstStudent(...a) },
    ptaClassroom: { findFirst: (...a: unknown[]) => findFirstClassroom(...a), create: (...a: unknown[]) => createClassroom(...a) },
    ptaStudentEnrollment: { upsert: (...a: unknown[]) => upsertEnrollment(...a) },
    // PTA-A dual-write: create paths resolve the schoolYearId FK twin of the label.
    ptaSchoolYear: { upsert: async () => ({ id: "school-year-mock" }) },
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));

beforeEach(() => vi.clearAllMocks());

describe("tenant isolation — cross-organization academic-structure access denied", () => {
  it("createPtaClassroom cannot attach to another organization's grade", async () => {
    findFirstGrade.mockResolvedValueOnce(null);
    const { createPtaClassroom } = await import("../academic");
    await expect(createPtaClassroom({ organizationId: "org-b", gradeId: "grade-belonging-to-org-a", name: "Room 1", schoolYear: "2026-2027", actorUserId: "u1" })).rejects.toMatchObject({ code: "PTA_GRADE_NOT_FOUND" });
    expect(createClassroom).not.toHaveBeenCalled();
  });

  it("createPtaClassroom cannot attach to another organization's teacher", async () => {
    findFirstGrade.mockResolvedValueOnce({ id: "grade-1", organizationId: "org-b" });
    findFirstTeacher.mockResolvedValueOnce(null);
    const { createPtaClassroom } = await import("../academic");
    await expect(createPtaClassroom({ organizationId: "org-b", gradeId: "grade-1", name: "Room 1", schoolYear: "2026-2027", teacherId: "teacher-belonging-to-org-a", actorUserId: "u1" })).rejects.toMatchObject({ code: "PTA_TEACHER_NOT_FOUND" });
  });

  it("enrollPtaStudent cannot enroll another organization's student", async () => {
    findFirstStudent.mockResolvedValueOnce(null);
    const { enrollPtaStudent } = await import("../academic");
    await expect(enrollPtaStudent("org-b", "student-belonging-to-org-a", "classroom-1", "2026-2027", "u1")).rejects.toMatchObject({ code: "PTA_STUDENT_NOT_FOUND" });
  });

  it("enrollPtaStudent cannot enroll into another organization's classroom", async () => {
    findFirstStudent.mockResolvedValueOnce({ id: "student-1", organizationId: "org-b" });
    findFirstClassroom.mockResolvedValueOnce(null);
    const { enrollPtaStudent } = await import("../academic");
    await expect(enrollPtaStudent("org-b", "student-1", "classroom-belonging-to-org-a", "2026-2027", "u1")).rejects.toMatchObject({ code: "PTA_CLASSROOM_NOT_FOUND" });
  });
});

describe("school-year rollover safety", () => {
  it("enrolling a student in a new school year upserts on (studentId, schoolYear) — never overwrites a prior year's row", async () => {
    findFirstStudent.mockResolvedValueOnce({ id: "student-1", organizationId: "org-a" });
    findFirstClassroom.mockResolvedValueOnce({ id: "classroom-2027", organizationId: "org-a" });
    upsertEnrollment.mockResolvedValueOnce({ id: "enrollment-2" });

    const { enrollPtaStudent } = await import("../academic");
    await enrollPtaStudent("org-a", "student-1", "classroom-2027", "2027-2028", "u1");

    expect(upsertEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { studentId_schoolYear: { studentId: "student-1", schoolYear: "2027-2028" } },
        create: expect.objectContaining({ schoolYear: "2027-2028" }),
      })
    );
    // A different year's key ("2026-2027") is never touched by this call —
    // the unique constraint is scoped per year, so last year's enrollment
    // row for the same student is a separate, untouched record.
  });
});
