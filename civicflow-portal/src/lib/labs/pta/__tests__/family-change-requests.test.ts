import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstRequest = vi.fn();
const findManyRequest = vi.fn();
const countRequest = vi.fn();
const createRequest = vi.fn();
const updateManyRequest = vi.fn();
const updateRequest = vi.fn();
const findUniqueRequest = vi.fn();
const findFirstStudent = vi.fn();
const findFirstClassroom = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaFamilyChangeRequest: {
      findFirst: (...args: unknown[]) => findFirstRequest(...args),
      findMany: (...args: unknown[]) => findManyRequest(...args),
      count: (...args: unknown[]) => countRequest(...args),
      create: (...args: unknown[]) => createRequest(...args),
      updateMany: (...args: unknown[]) => updateManyRequest(...args),
      update: (...args: unknown[]) => updateRequest(...args),
      findUnique: (...args: unknown[]) => findUniqueRequest(...args),
    },
    ptaStudent: { findFirst: (...args: unknown[]) => findFirstStudent(...args) },
    ptaClassroom: { findFirst: (...args: unknown[]) => findFirstClassroom(...args) },
  },
}));

const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

const updatePtaHousehold = vi.fn();
const addPtaStudent = vi.fn();
const renamePtaStudent = vi.fn();
const deactivatePtaStudent = vi.fn();
vi.mock("../households", () => ({
  updatePtaHousehold: (...args: unknown[]) => updatePtaHousehold(...args),
  addPtaStudent: (...args: unknown[]) => addPtaStudent(...args),
  renamePtaStudent: (...args: unknown[]) => renamePtaStudent(...args),
  deactivatePtaStudent: (...args: unknown[]) => deactivatePtaStudent(...args),
}));

const enrollPtaStudent = vi.fn();
vi.mock("../academic", () => ({ enrollPtaStudent: (...args: unknown[]) => enrollPtaStudent(...args) }));

const getPtaProfile = vi.fn();
vi.mock("../profile", () => ({ getPtaProfile: (...args: unknown[]) => getPtaProfile(...args) }));

import { approveFamilyChangeRequest, rejectFamilyChangeRequest, submitFamilyChangeRequest } from "../family-change-requests";
import { PtaError } from "../errors";

const baseSubmit = {
  organizationId: "org-a",
  householdId: "hh-1",
  submittedByAdultId: "adult-1",
  actorUserId: "user-1",
  actorEmail: "parent@example.com",
};

describe("submitFamilyChangeRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    countRequest.mockResolvedValue(0);
    createRequest.mockImplementation(async ({ data }) => ({ id: "req-1", ...data, status: "SUBMITTED" }));
    findFirstStudent.mockResolvedValue({ id: "stu-1" });
    findFirstClassroom.mockResolvedValue({ id: "room-1" });
    getPtaProfile.mockResolvedValue({ currentSchoolYear: "2026-2027" });
  });

  it("rejects a malformed payload before any database write", async () => {
    await expect(
      submitFamilyChangeRequest({ ...baseSubmit, type: "HOUSEHOLD_DISPLAY_NAME", payload: { displayName: "" } })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
    expect(createRequest).not.toHaveBeenCalled();
  });

  it("rejects a student reference outside the caller's own household", async () => {
    findFirstStudent.mockResolvedValueOnce(null);
    await expect(
      submitFamilyChangeRequest({ ...baseSubmit, type: "RENAME_STUDENT", payload: { studentId: "someone-elses", displayName: "New Name" } })
    ).rejects.toMatchObject({ code: "PTA_STUDENT_NOT_FOUND" });
    // The lookup itself was household- and org-scoped.
    expect(findFirstStudent).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ householdId: "hh-1", organizationId: "org-a" }) })
    );
    expect(createRequest).not.toHaveBeenCalled();
  });

  it("rejects a classroom outside the current school year", async () => {
    findFirstClassroom.mockResolvedValueOnce(null);
    await expect(
      submitFamilyChangeRequest({ ...baseSubmit, type: "STUDENT_PLACEMENT", payload: { studentId: "stu-1", classroomId: "old-room" } })
    ).rejects.toMatchObject({ code: "PTA_CLASSROOM_NOT_FOUND" });
  });

  it("enforces the per-household open-request cap", async () => {
    countRequest.mockResolvedValueOnce(25);
    await expect(
      submitFamilyChangeRequest({ ...baseSubmit, type: "ADD_STUDENT", payload: { displayName: "New Student" } })
    ).rejects.toMatchObject({ code: "PTA_CHANGE_REQUEST_LIMIT_REACHED" });
  });

  it("creates the request and audits with ids and type only — never payload values", async () => {
    await submitFamilyChangeRequest({ ...baseSubmit, type: "ADD_STUDENT", payload: { displayName: "Riley Kim" } });
    expect(createRequest).toHaveBeenCalled();
    const audit = createAuditEvent.mock.calls[0][0] as { metadata: Record<string, unknown> };
    expect(JSON.stringify(audit.metadata)).not.toContain("Riley");
  });
});

describe("approveFamilyChangeRequest", () => {
  const storedRequest = {
    id: "req-1",
    organizationId: "org-a",
    householdId: "hh-1",
    type: "RENAME_STUDENT",
    payload: { studentId: "stu-1", displayName: "Corrected Name" },
    status: "SUBMITTED",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    findFirstRequest.mockResolvedValue(storedRequest);
    updateManyRequest.mockResolvedValue({ count: 1 });
    updateRequest.mockImplementation(async ({ data }) => ({ ...storedRequest, ...data }));
    findFirstStudent.mockResolvedValue({ id: "stu-1" });
    findFirstClassroom.mockResolvedValue({ id: "room-1" });
    getPtaProfile.mockResolvedValue({ currentSchoolYear: "2026-2027" });
    renamePtaStudent.mockResolvedValue({});
  });

  it("claims the request via CAS, applies through the real service, and marks it APPLIED", async () => {
    const result = await approveFamilyChangeRequest({ organizationId: "org-a", requestId: "req-1", actorUserId: "officer-1" });

    expect(updateManyRequest).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "req-1", status: "SUBMITTED" }, data: expect.objectContaining({ status: "APPROVED" }) })
    );
    expect(renamePtaStudent).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-a", householdId: "hh-1", studentId: "stu-1", displayName: "Corrected Name" })
    );
    expect(result.status).toBe("APPLIED");
  });

  it("surfaces PTA_CHANGE_REQUEST_ALREADY_DECIDED when the CAS claim loses a race", async () => {
    updateManyRequest.mockResolvedValueOnce({ count: 0 });
    await expect(
      approveFamilyChangeRequest({ organizationId: "org-a", requestId: "req-1", actorUserId: "officer-1" })
    ).rejects.toMatchObject({ code: "PTA_CHANGE_REQUEST_ALREADY_DECIDED" });
    expect(renamePtaStudent).not.toHaveBeenCalled();
  });

  it("rolls the claim back to SUBMITTED when applying fails, so the queue never strands the request", async () => {
    renamePtaStudent.mockRejectedValueOnce(new PtaError("PTA_STUDENT_NOT_FOUND", "gone"));
    await expect(
      approveFamilyChangeRequest({ organizationId: "org-a", requestId: "req-1", actorUserId: "officer-1" })
    ).rejects.toMatchObject({ code: "PTA_STUDENT_NOT_FOUND" });

    // Second updateMany is the rollback APPROVED → SUBMITTED.
    expect(updateManyRequest).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "req-1", status: "APPROVED" }, data: expect.objectContaining({ status: "SUBMITTED" }) })
    );
    expect(updateRequest).not.toHaveBeenCalled();
  });

  it("routes STUDENT_PLACEMENT through enrollPtaStudent with the current school year", async () => {
    findFirstRequest.mockResolvedValueOnce({ ...storedRequest, type: "STUDENT_PLACEMENT", payload: { studentId: "stu-1", classroomId: "room-1" } });
    enrollPtaStudent.mockResolvedValueOnce({});

    await approveFamilyChangeRequest({ organizationId: "org-a", requestId: "req-1", actorUserId: "officer-1" });
    expect(enrollPtaStudent).toHaveBeenCalledWith("org-a", "stu-1", "room-1", "2026-2027", "officer-1", null);
  });

  it("404s for a request outside the caller's organization — tenant isolation", async () => {
    findFirstRequest.mockResolvedValueOnce(null);
    await expect(
      approveFamilyChangeRequest({ organizationId: "org-OTHER", requestId: "req-1", actorUserId: "officer-1" })
    ).rejects.toMatchObject({ code: "PTA_CHANGE_REQUEST_NOT_FOUND" });
    expect(findFirstRequest).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "req-1", organizationId: "org-OTHER" } }));
  });
});

describe("rejectFamilyChangeRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirstRequest.mockResolvedValue({ id: "req-1", organizationId: "org-a", householdId: "hh-1", type: "ADD_STUDENT", status: "SUBMITTED" });
    updateManyRequest.mockResolvedValue({ count: 1 });
    findUniqueRequest.mockResolvedValue({ id: "req-1", status: "REJECTED" });
  });

  it("rejects via CAS and never applies anything", async () => {
    const result = await rejectFamilyChangeRequest({ organizationId: "org-a", requestId: "req-1", decisionNotes: "Duplicate", actorUserId: "officer-1" });
    expect(updateManyRequest).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "req-1", status: "SUBMITTED" }, data: expect.objectContaining({ status: "REJECTED", decisionNotes: "Duplicate" }) })
    );
    expect(addPtaStudent).not.toHaveBeenCalled();
    expect(result?.status).toBe("REJECTED");
  });

  it("conflicts when already decided", async () => {
    updateManyRequest.mockResolvedValueOnce({ count: 0 });
    await expect(
      rejectFamilyChangeRequest({ organizationId: "org-a", requestId: "req-1", actorUserId: "officer-1" })
    ).rejects.toMatchObject({ code: "PTA_CHANGE_REQUEST_ALREADY_DECIDED" });
  });
});
