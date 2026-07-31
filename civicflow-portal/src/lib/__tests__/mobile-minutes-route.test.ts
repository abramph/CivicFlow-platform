import { beforeEach, describe, expect, it, vi } from "vitest";

const requireMobileOrgAccess = vi.fn();
vi.mock("@/lib/mobile-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mobile-auth")>();
  return { ...actual, requireMobileOrgAccess: (...args: unknown[]) => requireMobileOrgAccess(...args) };
});

const getApprovedMeetingMinutes = vi.fn();
vi.mock("@/lib/meeting-minutes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/meeting-minutes")>();
  return { ...actual, getApprovedMeetingMinutes: (...args: unknown[]) => getApprovedMeetingMinutes(...args) };
});

import { MobileForbiddenError } from "@/lib/mobile-auth";
import { GET } from "@/app/api/mobile/minutes/route";

function buildRequest(url: string) {
  return new Request(url);
}

describe("GET /api/mobile/minutes", () => {
  beforeEach(() => {
    requireMobileOrgAccess.mockReset();
    getApprovedMeetingMinutes.mockReset();
  });

  it("requires organizationId", async () => {
    const response = await GET(buildRequest("https://portal.test/api/mobile/minutes"));
    expect(response.status).toBe(400);
    expect(requireMobileOrgAccess).not.toHaveBeenCalled();
  });

  it("works for any identity (conventional member or PTA) via the loosest mobile guard", async () => {
    requireMobileOrgAccess.mockResolvedValueOnce({ session: { userId: "user-1" }, organizationId: "org-a", memberId: null });
    getApprovedMeetingMinutes.mockResolvedValueOnce([
      { id: "minutes-1", title: "October Board Meeting", meeting: { title: "October Board Meeting", meetingDate: new Date("2026-10-01") }, approvedAt: new Date("2026-10-05") },
    ]);

    const response = await GET(buildRequest("https://portal.test/api/mobile/minutes?organizationId=org-a"));
    const body = await response.json();

    expect(requireMobileOrgAccess).toHaveBeenCalledWith(expect.anything(), "org-a");
    expect(body.data).toEqual([
      { id: "minutes-1", title: "October Board Meeting", meetingTitle: "October Board Meeting", meetingDate: "2026-10-01T00:00:00.000Z", approvedAt: "2026-10-05T00:00:00.000Z" },
    ]);
  });

  it("returns 403 when the caller has no access to the organization", async () => {
    requireMobileOrgAccess.mockRejectedValueOnce(new MobileForbiddenError("No active access to this organization"));

    const response = await GET(buildRequest("https://portal.test/api/mobile/minutes?organizationId=org-a"));

    expect(response.status).toBe(403);
    expect(getApprovedMeetingMinutes).not.toHaveBeenCalled();
  });
});
