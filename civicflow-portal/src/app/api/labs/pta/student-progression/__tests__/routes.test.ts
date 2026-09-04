import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePtaAccess = vi.fn();
vi.mock("@/lib/labs/pta/guard", () => ({ requirePtaAccess: (...a: unknown[]) => requirePtaAccess(...a) }));

const listProgressionBatches = vi.fn();
const createProgressionBatch = vi.fn();
const getProgressionBatchDetail = vi.fn();
const generateProgressionPreview = vi.fn();
const saveProgressionClassroomMappings = vi.fn();
const saveProgressionException = vi.fn();
const commitProgressionBatch = vi.fn();
const rollbackProgressionBatch = vi.fn();
const correctProgressionRecord = vi.fn();

vi.mock("@/lib/labs/pta/student-progression", () => ({
  listProgressionBatches: (...a: unknown[]) => listProgressionBatches(...a),
  createProgressionBatch: (...a: unknown[]) => createProgressionBatch(...a),
  getProgressionBatchDetail: (...a: unknown[]) => getProgressionBatchDetail(...a),
  generateProgressionPreview: (...a: unknown[]) => generateProgressionPreview(...a),
  saveProgressionClassroomMappings: (...a: unknown[]) => saveProgressionClassroomMappings(...a),
  saveProgressionException: (...a: unknown[]) => saveProgressionException(...a),
  commitProgressionBatch: (...a: unknown[]) => commitProgressionBatch(...a),
  rollbackProgressionBatch: (...a: unknown[]) => rollbackProgressionBatch(...a),
  correctProgressionRecord: (...a: unknown[]) => correctProgressionRecord(...a),
}));

const SESSION = { organizationId: "org-1", session: { userId: "u1", userEmail: "officer@example.org" } };

beforeEach(() => {
  vi.clearAllMocks();
  requirePtaAccess.mockResolvedValue(SESSION);
});

function jsonRequest(body: unknown) {
  return new Request("https://portal.test/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("GET/POST /api/labs/pta/student-progression -- list/create", () => {
  it("GET uses the PREVIEW-tier permission and returns the batch list scoped to the caller's own org", async () => {
    const { GET } = await import("../route");
    listProgressionBatches.mockResolvedValueOnce([{ id: "b1" }]);
    const res = await GET();
    expect(requirePtaAccess).toHaveBeenCalledWith("pta:student-progression:preview");
    expect(listProgressionBatches).toHaveBeenCalledWith("org-1");
    expect(res.status).toBe(200);
  });

  it("POST creates a batch using the org resolved from the session, never a client-supplied organizationId", async () => {
    const { POST } = await import("../route");
    createProgressionBatch.mockResolvedValueOnce({ id: "b1" });
    const res = await POST(jsonRequest({ fromSchoolYearId: "y1", toSchoolYearId: "y2", organizationId: "someone-elses-org" }));
    expect(res.status).toBe(201);
    expect(createProgressionBatch).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", fromSchoolYearId: "y1", toSchoolYearId: "y2" })
    );
  });

  it("POST rejects a body missing required fields before calling the service", async () => {
    const { POST } = await import("../route");
    const res = await POST(jsonRequest({ fromSchoolYearId: "y1" }));
    expect(res.status).not.toBe(201);
    expect(createProgressionBatch).not.toHaveBeenCalled();
  });

  it("an unauthorized caller is rejected before the service is ever called", async () => {
    const { PtaError } = await import("@/lib/labs/pta/errors");
    requirePtaAccess.mockRejectedValueOnce(new PtaError("PTA_STUDENT_PROGRESSION_DISABLED", "off"));
    const { GET } = await import("../route");
    const res = await GET();
    expect(res.status).not.toBe(200);
    expect(listProgressionBatches).not.toHaveBeenCalled();
  });
});

describe("GET /api/labs/pta/student-progression/:batchId", () => {
  it("returns batch detail scoped to the caller's org", async () => {
    const { GET } = await import("../[batchId]/route");
    getProgressionBatchDetail.mockResolvedValueOnce({ id: "b1" });
    const res = await GET(new Request("https://x.test"), { params: Promise.resolve({ batchId: "b1" }) });
    expect(getProgressionBatchDetail).toHaveBeenCalledWith("org-1", "b1");
    expect(res.status).toBe(200);
  });
});

describe("POST /api/labs/pta/student-progression/:batchId/preview", () => {
  it("generates a preview under the PREVIEW-tier permission", async () => {
    const { POST } = await import("../[batchId]/preview/route");
    generateProgressionPreview.mockResolvedValueOnce({ id: "b1", status: "PREVIEWED" });
    const res = await POST(new Request("https://x.test", { method: "POST" }), { params: Promise.resolve({ batchId: "b1" }) });
    expect(requirePtaAccess).toHaveBeenCalledWith("pta:student-progression:preview");
    expect(generateProgressionPreview).toHaveBeenCalledWith("org-1", "b1");
    expect(res.status).toBe(200);
  });
});

describe("PUT /api/labs/pta/student-progression/:batchId/classroom-mappings", () => {
  it("saves mappings scoped to the batch and org", async () => {
    const { PUT } = await import("../[batchId]/classroom-mappings/route");
    saveProgressionClassroomMappings.mockResolvedValueOnce({ id: "b1" });
    const res = await PUT(
      jsonRequest({ mappings: [{ sourceClassroomId: "c1", targetClassroomId: "c2" }] }),
      { params: Promise.resolve({ batchId: "b1" }) }
    );
    expect(saveProgressionClassroomMappings).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", batchId: "b1", mappings: [{ sourceClassroomId: "c1", targetClassroomId: "c2" }] })
    );
    expect(res.status).toBe(200);
  });

  it("rejects a malformed mapping body before calling the service", async () => {
    const { PUT } = await import("../[batchId]/classroom-mappings/route");
    const res = await PUT(jsonRequest({ mappings: [{ sourceClassroomId: "c1" }] }), { params: Promise.resolve({ batchId: "b1" }) });
    expect(res.status).not.toBe(200);
    expect(saveProgressionClassroomMappings).not.toHaveBeenCalled();
  });
});

describe("POST /api/labs/pta/student-progression/:batchId/exceptions", () => {
  it("saves a per-student exception", async () => {
    const { POST } = await import("../[batchId]/exceptions/route");
    saveProgressionException.mockResolvedValueOnce({ id: "r1", outcome: "WITHDRAW" });
    const res = await POST(jsonRequest({ studentId: "s1", outcome: "WITHDRAW" }), { params: Promise.resolve({ batchId: "b1" }) });
    expect(saveProgressionException).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-1", batchId: "b1", studentId: "s1", outcome: "WITHDRAW" }));
    expect(res.status).toBe(200);
  });

  it("rejects an outcome the automatic algorithm alone should assign (PROMOTE/GRADUATE/NEEDS_REVIEW aren't valid exception inputs)", async () => {
    const { POST } = await import("../[batchId]/exceptions/route");
    const res = await POST(jsonRequest({ studentId: "s1", outcome: "PROMOTE" }), { params: Promise.resolve({ batchId: "b1" }) });
    expect(res.status).not.toBe(200);
    expect(saveProgressionException).not.toHaveBeenCalled();
  });
});

describe("POST /api/labs/pta/student-progression/:batchId/commit", () => {
  it("uses the COMMIT-tier permission (distinct from preview) and requires both previewVersion and idempotencyKey", async () => {
    const { POST } = await import("../[batchId]/commit/route");
    commitProgressionBatch.mockResolvedValueOnce({ promoted: 1 });
    const res = await POST(jsonRequest({ previewVersion: "2027-01-01T00:00:00.000Z", idempotencyKey: "k1" }), { params: Promise.resolve({ batchId: "b1" }) });
    expect(requirePtaAccess).toHaveBeenCalledWith("pta:student-progression:commit");
    expect(commitProgressionBatch).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", batchId: "b1", previewVersion: "2027-01-01T00:00:00.000Z", idempotencyKey: "k1" })
    );
    expect(res.status).toBe(200);
  });

  it("rejects a commit request missing idempotencyKey before calling the service", async () => {
    const { POST } = await import("../[batchId]/commit/route");
    const res = await POST(jsonRequest({ previewVersion: "2027-01-01T00:00:00.000Z" }), { params: Promise.resolve({ batchId: "b1" }) });
    expect(res.status).not.toBe(200);
    expect(commitProgressionBatch).not.toHaveBeenCalled();
  });

  it("a caller with only PREVIEW-tier access is rejected before the service is called", async () => {
    const { PtaError } = await import("@/lib/labs/pta/errors");
    requirePtaAccess.mockRejectedValueOnce(Object.assign(new PtaError("PTA_VALIDATION_ERROR", "forbidden"), { status: 403 }));
    const { POST } = await import("../[batchId]/commit/route");
    const res = await POST(jsonRequest({ previewVersion: "x", idempotencyKey: "k1" }), { params: Promise.resolve({ batchId: "b1" }) });
    expect(res.status).not.toBe(200);
    expect(commitProgressionBatch).not.toHaveBeenCalled();
  });
});

describe("POST /api/labs/pta/student-progression/:batchId/rollback", () => {
  it("uses the COMMIT-tier permission (same as commit) and scopes to the batch/org", async () => {
    const { POST } = await import("../[batchId]/rollback/route");
    rollbackProgressionBatch.mockResolvedValueOnce({ id: "b1", status: "ROLLED_BACK" });
    const res = await POST(new Request("https://x.test", { method: "POST" }), { params: Promise.resolve({ batchId: "b1" }) });
    expect(requirePtaAccess).toHaveBeenCalledWith("pta:student-progression:commit");
    expect(rollbackProgressionBatch).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-1", batchId: "b1" }));
    expect(res.status).toBe(200);
  });
});

describe("PATCH /api/labs/pta/student-progression/:batchId/records/:recordId", () => {
  it("corrects a single record under the COMMIT-tier permission", async () => {
    const { PATCH } = await import("../[batchId]/records/[recordId]/route");
    correctProgressionRecord.mockResolvedValueOnce({ id: "r1", outcome: "RETAIN" });
    const res = await PATCH(jsonRequest({ outcome: "RETAIN" }), { params: Promise.resolve({ batchId: "b1", recordId: "r1" }) });
    expect(requirePtaAccess).toHaveBeenCalledWith("pta:student-progression:commit");
    expect(correctProgressionRecord).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-1", batchId: "b1", recordId: "r1", outcome: "RETAIN" }));
    expect(res.status).toBe(200);
  });
});
