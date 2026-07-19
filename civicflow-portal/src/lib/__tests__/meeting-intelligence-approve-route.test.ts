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

const approveMeetingMinutesDraft = vi.fn();
vi.mock("@/lib/labs/meeting-intelligence/minutes-review", () => ({
  approveMeetingMinutesDraft: (...args: unknown[]) => approveMeetingMinutesDraft(...args),
}));

import { POST } from "@/app/api/labs/meeting-intelligence/jobs/[jobId]/minutes/approve/route";
import { ForbiddenError } from "@/lib/auth-guards";

beforeEach(() => {
  vi.resetAllMocks();
  requireOrganizationLabFeature.mockResolvedValue(undefined);
});

describe("POST /api/labs/meeting-intelligence/jobs/[jobId]/minutes/approve", () => {
  it("requires meetingIntelligence:approve — not just :review", async () => {
    requirePermission.mockResolvedValueOnce({ organizationId: "aph-org", session: { userId: "user-1", userEmail: "a@example.com" }, role: "ORG_OWNER" });
    approveMeetingMinutesDraft.mockResolvedValueOnce({ id: "draft-1", status: "APPROVED" });
    await POST(new Request("https://portal.test"), { params: Promise.resolve({ jobId: "job-1" }) });
    expect(requirePermission).toHaveBeenCalledWith("meetingIntelligence:approve", "throw");
  });

  it("denies a user who only has meetingIntelligence:review (lacking :approve) with a 403, not a 500", async () => {
    requirePermission.mockRejectedValueOnce(new ForbiddenError("Permission denied: meetingIntelligence:approve"));
    const response = await POST(new Request("https://portal.test"), { params: Promise.resolve({ jobId: "job-1" }) });
    expect(response.status).toBe(403);
    expect(approveMeetingMinutesDraft).not.toHaveBeenCalled();
  });

  it("records the actor and returns the approved draft", async () => {
    requirePermission.mockResolvedValueOnce({ organizationId: "aph-org", session: { userId: "user-1", userEmail: "a@example.com" }, role: "ORG_OWNER" });
    approveMeetingMinutesDraft.mockResolvedValueOnce({ id: "draft-1", status: "APPROVED", approvedByUserId: "user-1" });
    const response = await POST(new Request("https://portal.test"), { params: Promise.resolve({ jobId: "job-1" }) });
    const payload = await response.json();
    expect(payload.data.status).toBe("APPROVED");
    expect(approveMeetingMinutesDraft).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "aph-org", jobId: "job-1", actorUserId: "user-1" }));
  });
});
