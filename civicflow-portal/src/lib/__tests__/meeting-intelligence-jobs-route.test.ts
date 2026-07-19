import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePermission = vi.fn();
vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return { ...actual, requirePermission: (...args: unknown[]) => requirePermission(...args) };
});

const requireOrganizationLabFeature = vi.fn();
vi.mock("@/lib/labs/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/labs/access")>();
  return { ...actual, requireOrganizationLabFeature: (...args: unknown[]) => requireOrganizationLabFeature(...args) };
});

const createMeetingIntelligenceJob = vi.fn();
vi.mock("@/lib/labs/meeting-intelligence/jobs", () => ({
  createMeetingIntelligenceJob: (...args: unknown[]) => createMeetingIntelligenceJob(...args),
}));

const findManyJob = vi.fn().mockResolvedValue([]);
vi.mock("@/lib/prisma", () => ({
  prisma: { meetingIntelligenceJob: { findMany: (...args: unknown[]) => findManyJob(...args) } },
}));

import { GET, POST } from "@/app/api/labs/meeting-intelligence/jobs/route";

const fullConsent = {
  participantsNotifiedOrConsented: true,
  uploaderAuthorized: true,
  mayContainSensitiveInformation: true,
  aiRequiresHumanVerification: true,
  organizationResponsibleForRetention: true,
};

function createRequest(body: Record<string, unknown>) {
  return new Request("https://portal.test/api/labs/meeting-intelligence/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue({ organizationId: "aph-org", session: { userId: "user-1", userEmail: "a@example.com" }, role: "ORG_OWNER" });
  requireOrganizationLabFeature.mockResolvedValue(undefined);
});

describe("POST /api/labs/meeting-intelligence/jobs", () => {
  it("requires meetingIntelligence:create permission", async () => {
    await POST(createRequest({ meetingId: "meeting-1", originalFilename: "meeting.wav", mimeType: "audio/wav", consent: fullConsent }));
    expect(requirePermission).toHaveBeenCalledWith("meetingIntelligence:create", "throw");
  });

  it("requires Labs access after RBAC", async () => {
    await POST(createRequest({ meetingId: "meeting-1", originalFilename: "meeting.wav", mimeType: "audio/wav", consent: fullConsent }));
    expect(requireOrganizationLabFeature).toHaveBeenCalledWith("aph-org", "meetingIntelligence");
  });

  it("returns a 403 Labs denial (not a 500) when the organization lacks access", async () => {
    const { LabFeatureError } = await import("@/lib/labs/access");
    requireOrganizationLabFeature.mockRejectedValueOnce(new LabFeatureError("LAB_FEATURE_NOT_ENROLLED", "meetingIntelligence", "not enrolled"));
    const response = await POST(createRequest({ meetingId: "meeting-1", originalFilename: "meeting.wav", mimeType: "audio/wav", consent: fullConsent }));
    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload.code).toBe("LAB_FEATURE_NOT_ENROLLED");
    expect(createMeetingIntelligenceJob).not.toHaveBeenCalled();
  });

  it("rejects an incomplete consent object with a 400, not a 500", async () => {
    const response = await POST(
      createRequest({ meetingId: "meeting-1", originalFilename: "meeting.wav", mimeType: "audio/wav", consent: { ...fullConsent, aiRequiresHumanVerification: false } })
    );
    expect(response.status).toBe(400);
    expect(createMeetingIntelligenceJob).not.toHaveBeenCalled();
  });

  it("creates the job using the session's own organizationId, never a client-supplied one", async () => {
    createMeetingIntelligenceJob.mockResolvedValueOnce({ id: "job-1", status: "UPLOAD_PENDING" });
    const response = await POST(
      createRequest({ meetingId: "meeting-1", originalFilename: "meeting.wav", mimeType: "audio/wav", consent: fullConsent, organizationId: "attacker-controlled-org" })
    );
    expect(response.status).toBe(201);
    expect(createMeetingIntelligenceJob).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "aph-org" }));
  });
});

describe("GET /api/labs/meeting-intelligence/jobs", () => {
  it("requires meetingIntelligence:read permission", async () => {
    await GET(new Request("https://portal.test/api/labs/meeting-intelligence/jobs"));
    expect(requirePermission).toHaveBeenCalledWith("meetingIntelligence:read", "throw");
  });

  it("scopes the list query by the session's organizationId", async () => {
    await GET(new Request("https://portal.test/api/labs/meeting-intelligence/jobs"));
    expect(findManyJob).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "aph-org" } }));
  });
});
