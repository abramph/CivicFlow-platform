import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueProfile = vi.fn();
const findFirstConcern = vi.fn();
const findManyConcerns = vi.fn();
const countConcerns = vi.fn();
const createConcernRow = vi.fn();
const updateConcernRow = vi.fn();
const createAssignee = vi.fn();
const upsertAssignee = vi.fn();
const deleteManyAssignees = vi.fn();
const createNote = vi.fn();
const findFirstMembership = vi.fn();
const findFirstCommittee = vi.fn();
const findFirstGovernanceDoc = vi.fn();
const transaction = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaProfile: { findUnique: (...a: unknown[]) => findUniqueProfile(...a) },
    ptaConcern: {
      findFirst: (...a: unknown[]) => findFirstConcern(...a),
      findMany: (...a: unknown[]) => findManyConcerns(...a),
      count: (...a: unknown[]) => countConcerns(...a),
      create: (...a: unknown[]) => createConcernRow(...a),
      update: (...a: unknown[]) => updateConcernRow(...a),
    },
    ptaConcernAssignee: {
      create: (...a: unknown[]) => createAssignee(...a),
      upsert: (...a: unknown[]) => upsertAssignee(...a),
      deleteMany: (...a: unknown[]) => deleteManyAssignees(...a),
    },
    ptaConcernNote: { create: (...a: unknown[]) => createNote(...a) },
    organizationMembership: { findFirst: (...a: unknown[]) => findFirstMembership(...a) },
    ptaCommittee: { findFirst: (...a: unknown[]) => findFirstCommittee(...a) },
    governanceDocument: { findFirst: (...a: unknown[]) => findFirstGovernanceDoc(...a) },
    $transaction: (...a: unknown[]) => transaction(...a),
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

import {
  addConcernNote,
  assignConcernOfficer,
  canReadConcernContent,
  createConcern,
  ensureConcernsEnabled,
  getConcern,
  listConcerns,
  removeConcernAssignee,
  updateConcern,
  type ConcernViewer,
} from "@/lib/labs/pta/concerns";

const admin: ConcernViewer = { userId: "admin-1", userEmail: "admin@example.org", canView: true, canManage: true, canAssign: true, canResolve: true
};
const viewOnly: ConcernViewer = { userId: "viewer-1", canView: true, canManage: false, canAssign: false, canResolve: false };
const assignedOfficer: ConcernViewer = { userId: "officer-1", canView: true, canManage: true, canAssign: false, canResolve: true };

function transactionRunsCallback() {
  transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      ptaConcern: {
        count: (...a: unknown[]) => countConcerns(...a),
        create: (...a: unknown[]) => createConcernRow(...a),
      },
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  findUniqueProfile.mockResolvedValue({ concernsEnabled: true, concernsLabel: null });
});

describe("ensureConcernsEnabled", () => {
  it("throws PTA_CONCERNS_DISABLED when the module is switched off", async () => {
    findUniqueProfile.mockResolvedValueOnce({ concernsEnabled: false, concernsLabel: null });
    await expect(ensureConcernsEnabled("org-1")).rejects.toMatchObject({ code: "PTA_CONCERNS_DISABLED", status: 403 });
  });

  it("falls back to the default label and allows orgs without a profile", async () => {
    findUniqueProfile.mockResolvedValueOnce(null);
    await expect(ensureConcernsEnabled("org-1")).resolves.toEqual({ label: "Concerns & Grievances" });
  });
});

describe("createConcern", () => {
  it("requires a title and description", async () => {
    await expect(createConcern({ organizationId: "org-1", title: " ", description: "x", actor: admin })).rejects.toMatchObject({
      code: "PTA_VALIDATION_ERROR",
    });
  });

  it("allocates a per-year case number inside the transaction", async () => {
    transactionRunsCallback();
    countConcerns.mockResolvedValueOnce(4);
    createConcernRow.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "c-1", ...args.data }));

    const concern = await createConcern({ organizationId: "org-1", title: "Budget question", description: "Details", actor: admin });
    const year = new Date().getFullYear();
    expect(concern.caseNumber).toBe(`C-${year}-005`);
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "pta.concern.created" }));
  });

  it("retries case-number allocation on a unique-constraint collision", async () => {
    transactionRunsCallback();
    countConcerns.mockResolvedValue(0);
    createConcernRow
      .mockRejectedValueOnce({ code: "P2002" })
      .mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "c-1", ...args.data }));

    const concern = await createConcern({ organizationId: "org-1", title: "T", description: "D", actor: admin });
    expect(concern.id).toBe("c-1");
    expect(createConcernRow).toHaveBeenCalledTimes(2);
  });

  it("a restricted case auto-assigns its creator so it is never born unreachable", async () => {
    transactionRunsCallback();
    countConcerns.mockResolvedValueOnce(0);
    createConcernRow.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "c-9", ...args.data }));

    await createConcern({ organizationId: "org-1", title: "Sensitive", description: "D", isRestricted: true, actor: admin });
    expect(createAssignee).toHaveBeenCalledWith({
      data: { organizationId: "org-1", concernId: "c-9", userId: "admin-1", assignedByUserId: "admin-1" },
    });
  });
});

describe("restricted-case access wall", () => {
  const restricted = { isRestricted: true, assignees: [{ userId: "officer-1" }] };

  it("no permission bypasses assignment on a restricted case", () => {
    expect(canReadConcernContent(restricted, admin)).toBe(false);
    expect(canReadConcernContent(restricted, assignedOfficer)).toBe(true);
  });

  it("listConcerns returns a redacted stub (never content) to an unassigned assign-holder", async () => {
    findManyConcerns.mockResolvedValueOnce([
      {
        id: "c-1",
        caseNumber: "C-2026-001",
        title: "SECRET TITLE",
        category: "CONDUCT",
        status: "UNDER_REVIEW",
        isRestricted: true,
        submittedAt: new Date(),
        assignees: [{ userId: "officer-1" }],
      },
    ]);
    const { readable, redacted } = await listConcerns("org-1", admin);
    expect(readable).toHaveLength(0);
    expect(redacted).toHaveLength(1);
    expect(JSON.stringify(redacted[0])).not.toContain("SECRET");
  });

  it("listConcerns hides restricted cases entirely from viewers without assign", async () => {
    findManyConcerns.mockResolvedValueOnce([
      { id: "c-1", caseNumber: "C-2026-001", title: "S", category: "CONDUCT", status: "UNDER_REVIEW", isRestricted: true, submittedAt: new Date(), assignees: [] },
    ]);
    const { readable, redacted } = await listConcerns("org-1", viewOnly);
    expect(readable).toHaveLength(0);
    expect(redacted).toHaveLength(0);
  });

  it("getConcern answers 404 (not 403) for restricted content — existence is not confirmed", async () => {
    findFirstConcern.mockResolvedValueOnce({ id: "c-1", caseNumber: "C-2026-001", isRestricted: true, assignees: [] });
    await expect(getConcern("org-1", "c-1", admin)).rejects.toMatchObject({ code: "PTA_CONCERN_NOT_FOUND", status: 404 });
    expect(createAuditEvent).not.toHaveBeenCalled();
  });

  it("getConcern audits every successful detail read", async () => {
    findFirstConcern.mockResolvedValueOnce({ id: "c-1", caseNumber: "C-2026-001", isRestricted: false, assignees: [], notes: [] });
    await getConcern("org-1", "c-1", viewOnly);
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "pta.concern.viewed", entityId: "c-1" }));
  });
});

describe("updateConcern / resolution", () => {
  it("resolving requires the resolve permission", async () => {
    findFirstConcern.mockResolvedValueOnce({ id: "c-1", caseNumber: "C-2026-001", status: "UNDER_REVIEW", isRestricted: false, assignees: [], resolution: null });
    const manageOnly: ConcernViewer = { ...admin, canResolve: false };
    await expect(updateConcern({ organizationId: "org-1", concernId: "c-1", status: "RESOLVED", resolution: "done", actor: manageOnly })).rejects.toMatchObject({
      code: "PTA_CONCERN_FORBIDDEN",
    });
  });

  it("resolving requires a resolution summary and stamps resolvedAt", async () => {
    findFirstConcern.mockResolvedValue({ id: "c-1", caseNumber: "C-2026-001", status: "UNDER_REVIEW", isRestricted: false, assignees: [], resolution: null });
    await expect(updateConcern({ organizationId: "org-1", concernId: "c-1", status: "RESOLVED", actor: admin })).rejects.toMatchObject({
      code: "PTA_VALIDATION_ERROR",
    });

    updateConcernRow.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "c-1", status: "RESOLVED", ...args.data }));
    await updateConcern({ organizationId: "org-1", concernId: "c-1", status: "RESOLVED", resolution: "Refund issued.", actor: admin });
    expect(updateConcernRow.mock.calls[0][0].data.resolvedAt).toBeInstanceOf(Date);
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "pta.concern.resolved" }));
  });

  it("an unassigned manager cannot write to a restricted case", async () => {
    findFirstConcern.mockResolvedValueOnce({ id: "c-1", caseNumber: "C-2026-001", status: "UNDER_REVIEW", isRestricted: true, assignees: [{ userId: "someone-else" }], resolution: null });
    await expect(updateConcern({ organizationId: "org-1", concernId: "c-1", status: "UNDER_REVIEW", actor: admin })).rejects.toMatchObject({
      code: "PTA_CONCERN_NOT_FOUND",
    });
  });
});

describe("assignment", () => {
  it("requires the assign permission", async () => {
    await expect(
      assignConcernOfficer({ organizationId: "org-1", concernId: "c-1", userId: "u2", actor: assignedOfficer })
    ).rejects.toMatchObject({ code: "PTA_CONCERN_FORBIDDEN" });
  });

  it("the assignee must be an active non-member officer of the organization", async () => {
    findFirstConcern.mockResolvedValueOnce({ id: "c-1", caseNumber: "C-2026-001" });
    findFirstMembership.mockResolvedValueOnce(null);
    await expect(assignConcernOfficer({ organizationId: "org-1", concernId: "c-1", userId: "outsider", actor: admin })).rejects.toMatchObject({
      code: "PTA_VALIDATION_ERROR",
    });
    expect(findFirstMembership).toHaveBeenCalledWith({
      where: { organizationId: "org-1", userId: "outsider", status: "active", role: { not: "MEMBER" } },
    });
  });

  it("assigning audits and is idempotent via upsert", async () => {
    findFirstConcern.mockResolvedValueOnce({ id: "c-1", caseNumber: "C-2026-001" });
    findFirstMembership.mockResolvedValueOnce({ id: "m-1", role: "ORG_ADMIN" });
    upsertAssignee.mockResolvedValueOnce({ id: "a-1" });
    await assignConcernOfficer({ organizationId: "org-1", concernId: "c-1", userId: "u2", actor: admin });
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "pta.concern.assigned" }));
  });

  it("a restricted case must keep at least one assigned officer", async () => {
    findFirstConcern.mockResolvedValueOnce({ id: "c-1", caseNumber: "C-2026-001", isRestricted: true, assignees: [{ userId: "u2" }] });
    await expect(removeConcernAssignee({ organizationId: "org-1", concernId: "c-1", userId: "u2", actor: admin })).rejects.toMatchObject({
      code: "PTA_VALIDATION_ERROR",
    });
    expect(deleteManyAssignees).not.toHaveBeenCalled();
  });
});

describe("case log", () => {
  it("notes require write access to the case", async () => {
    findFirstConcern.mockResolvedValueOnce({ id: "c-1", caseNumber: "C-2026-001", isRestricted: false, assignees: [] });
    await expect(addConcernNote({ organizationId: "org-1", concernId: "c-1", body: "note", actor: viewOnly })).rejects.toMatchObject({
      code: "PTA_CONCERN_NOT_FOUND",
    });
  });

  it("adding a note audits without leaking the note body into metadata", async () => {
    findFirstConcern.mockResolvedValueOnce({ id: "c-1", caseNumber: "C-2026-001", isRestricted: false, assignees: [] });
    createNote.mockResolvedValueOnce({ id: "n-1", kind: "COMMUNICATION" });
    await addConcernNote({ organizationId: "org-1", concernId: "c-1", body: "Called the family. PRIVATE DETAILS.", kind: "COMMUNICATION", actor: admin });
    const audit = createAuditEvent.mock.calls.find((call) => call[0].action === "pta.concern.note_added");
    expect(audit).toBeDefined();
    expect(JSON.stringify(audit![0].metadata)).not.toContain("PRIVATE");
  });
});

describe("tenant isolation", () => {
  it("cases are always looked up scoped to the caller's organization", async () => {
    findFirstConcern.mockResolvedValueOnce(null);
    await expect(getConcern("org-1", "foreign-concern", admin)).rejects.toMatchObject({ code: "PTA_CONCERN_NOT_FOUND" });
    expect(findFirstConcern.mock.calls[0][0].where).toMatchObject({ id: "foreign-concern", organizationId: "org-1" });
  });
});
