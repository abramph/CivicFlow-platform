import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePermission = vi.fn();
vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return { ...actual, requirePermission: (...args: unknown[]) => requirePermission(...args) };
});

const requireOrganizationLabFeature = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/labs/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/labs/access")>();
  return { ...actual, requireOrganizationLabFeature: (...args: unknown[]) => requireOrganizationLabFeature(...args) };
});

const requirePlanFeature = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/plan-gate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/plan-gate")>();
  return { ...actual, requirePlanFeature: (...args: unknown[]) => requirePlanFeature(...args) };
});

const getLatestMeetingMinutesDraft = vi.fn();
vi.mock("@/lib/labs/meeting-intelligence/minutes-review", () => ({
  getLatestMeetingMinutesDraft: (...args: unknown[]) => getLatestMeetingMinutesDraft(...args),
}));

const findFirstOrThrowJob = vi.fn();
const findUniqueOrThrowOrg = vi.fn();
const findUniqueOrThrowMeeting = vi.fn();
const findUniqueUser = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    meetingIntelligenceJob: { findFirstOrThrow: (...args: unknown[]) => findFirstOrThrowJob(...args) },
    organization: { findUniqueOrThrow: (...args: unknown[]) => findUniqueOrThrowOrg(...args) },
    meeting: { findUniqueOrThrow: (...args: unknown[]) => findUniqueOrThrowMeeting(...args) },
    user: { findUnique: (...args: unknown[]) => findUniqueUser(...args) },
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));

import { GET } from "@/app/api/labs/meeting-intelligence/jobs/[jobId]/export/route";

const draftMinutesContent = {
  meetingTitle: "Board Meeting",
  meetingDate: null,
  locationOrFormat: null,
  attendance: [],
  agendaItems: [],
  discussionSummaries: [],
  motions: [],
  decisions: [],
  actionItems: [],
  unresolvedIssues: [],
  nextMeetingDetails: null,
  adjournmentTime: null,
  executiveSummary: null,
  status: "draft" as const,
  aiDisclaimer: "AI-generated draft — requires human review.",
};

beforeEach(() => {
  vi.resetAllMocks();
  requirePermission.mockResolvedValue({ organizationId: "aph-org", session: { userId: "user-1", userEmail: "a@example.com" }, role: "ORG_OWNER" });
  requireOrganizationLabFeature.mockResolvedValue(undefined);
  requirePlanFeature.mockResolvedValue(undefined);
  findFirstOrThrowJob.mockResolvedValue({ id: "job-1", meetingId: "meeting-1" });
  findUniqueOrThrowOrg.mockResolvedValue({ name: "APH Technologies, LLC" });
  findUniqueOrThrowMeeting.mockResolvedValue({ id: "meeting-1", title: "Board Meeting", meetingDate: new Date("2026-01-01") });
});

function exportRequest(format: string) {
  return new Request(`https://portal.test/api/labs/meeting-intelligence/jobs/job-1/export?format=${format}`);
}

describe("GET /api/labs/meeting-intelligence/jobs/[jobId]/export", () => {
  it("checks Labs access before anything else", async () => {
    getLatestMeetingMinutesDraft.mockResolvedValueOnce({ id: "draft-1", status: "DRAFT", editableContentJson: draftMinutesContent });
    await GET(exportRequest("pdf"), { params: Promise.resolve({ jobId: "job-1" }) });
    expect(requireOrganizationLabFeature).toHaveBeenCalledWith("aph-org", "meetingIntelligence");
  });

  it("also checks pdfExport plan entitlement for format=pdf", async () => {
    getLatestMeetingMinutesDraft.mockResolvedValueOnce({ id: "draft-1", status: "DRAFT", editableContentJson: draftMinutesContent });
    await GET(exportRequest("pdf"), { params: Promise.resolve({ jobId: "job-1" }) });
    expect(requirePlanFeature).toHaveBeenCalledWith("aph-org", "pdfExport");
  });

  it("never checks pdfExport for a docx export", async () => {
    getLatestMeetingMinutesDraft.mockResolvedValueOnce({ id: "draft-1", status: "DRAFT", editableContentJson: draftMinutesContent });
    await GET(exportRequest("docx"), { params: Promise.resolve({ jobId: "job-1" }) });
    expect(requirePlanFeature).not.toHaveBeenCalled();
  });

  it("returns a standardized 403 when the organization lacks pdfExport", async () => {
    const { PlanFeatureError } = await import("@/lib/plan-gate");
    requirePlanFeature.mockRejectedValueOnce(new PlanFeatureError("pdfExport", "not included"));
    getLatestMeetingMinutesDraft.mockResolvedValueOnce({ id: "draft-1", status: "DRAFT", editableContentJson: draftMinutesContent });
    const response = await GET(exportRequest("pdf"), { params: Promise.resolve({ jobId: "job-1" }) });
    expect(response.status).toBe(403);
  });

  it("exports a DRAFT (unapproved) minutes draft successfully with a draft PDF", async () => {
    getLatestMeetingMinutesDraft.mockResolvedValueOnce({ id: "draft-1", status: "DRAFT", editableContentJson: draftMinutesContent, approvedByUserId: null, approvedAt: null });
    const response = await GET(exportRequest("pdf"), { params: Promise.resolve({ jobId: "job-1" }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
  });

  it("exports an APPROVED draft and looks up the approver's display name", async () => {
    getLatestMeetingMinutesDraft.mockResolvedValueOnce({
      id: "draft-1",
      status: "APPROVED",
      editableContentJson: draftMinutesContent,
      approvedByUserId: "user-2",
      approvedAt: new Date("2026-01-02"),
    });
    findUniqueUser.mockResolvedValueOnce({ displayName: "Alex Chair", email: "alex@example.com" });
    const response = await GET(exportRequest("docx"), { params: Promise.resolve({ jobId: "job-1" }) });
    expect(response.status).toBe(200);
    expect(findUniqueUser).toHaveBeenCalledWith({ where: { id: "user-2" }, select: { displayName: true, email: true } });
  });

  it("returns MEETING_INTELLIGENCE_JOB_NOT_FOUND (not a 500) when there is no minutes draft yet", async () => {
    getLatestMeetingMinutesDraft.mockResolvedValueOnce(null);
    const response = await GET(exportRequest("pdf"), { params: Promise.resolve({ jobId: "job-1" }) });
    expect(response.status).toBe(404);
    const payload = await response.json();
    expect(payload.code).toBe("MEETING_INTELLIGENCE_JOB_NOT_FOUND");
  });
});
