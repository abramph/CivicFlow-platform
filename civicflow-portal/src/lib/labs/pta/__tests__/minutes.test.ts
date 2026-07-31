import { beforeEach, describe, expect, it, vi } from "vitest";

const getApprovedMeetingMinutes = vi.fn();
vi.mock("@/lib/meeting-minutes", () => ({
  getApprovedMeetingMinutes: (...args: unknown[]) => getApprovedMeetingMinutes(...args),
}));

beforeEach(() => vi.clearAllMocks());

describe("listApprovedPtaMinutes", () => {
  it("delegates to the general MeetingMinutes approved-only read path, scoped to the calling organization", async () => {
    getApprovedMeetingMinutes.mockResolvedValueOnce([{ id: "minutes-1", status: "APPROVED" }]);
    const { listApprovedPtaMinutes } = await import("../minutes");

    const result = await listApprovedPtaMinutes("org-b");

    expect(getApprovedMeetingMinutes).toHaveBeenCalledWith("org-b");
    expect(result).toEqual([{ id: "minutes-1", status: "APPROVED" }]);
  });
});
