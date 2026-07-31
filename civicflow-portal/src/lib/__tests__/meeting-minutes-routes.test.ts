import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return {
    ...actual,
    requirePermission: (...args: unknown[]) => requirePermissionMock(...args),
  };
});

const requirePermissionMock = vi.fn().mockResolvedValue({
  session: { userId: "staff-1", userEmail: "staff@org-a.example.com" },
  organizationId: "org-a",
  role: "ORG_ADMIN",
});

const getMeetingMinutesVersions = vi.fn();
const createMeetingMinutesDraft = vi.fn();
const editMeetingMinutesDraft = vi.fn();
const submitMeetingMinutesForReview = vi.fn();
const requestMeetingMinutesChanges = vi.fn();
const approveMeetingMinutes = vi.fn();

vi.mock("@/lib/meeting-minutes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/meeting-minutes")>();
  return {
    ...actual,
    getMeetingMinutesVersions: (...args: unknown[]) => getMeetingMinutesVersions(...args),
    createMeetingMinutesDraft: (...args: unknown[]) => createMeetingMinutesDraft(...args),
    editMeetingMinutesDraft: (...args: unknown[]) => editMeetingMinutesDraft(...args),
    submitMeetingMinutesForReview: (...args: unknown[]) => submitMeetingMinutesForReview(...args),
    requestMeetingMinutesChanges: (...args: unknown[]) => requestMeetingMinutesChanges(...args),
    approveMeetingMinutes: (...args: unknown[]) => approveMeetingMinutes(...args),
  };
});

vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

import { MeetingMinutesError } from "@/lib/meeting-minutes";
import { GET as listRoute, POST as createRoute } from "@/app/api/meetings/[id]/minutes/route";
import { PATCH as editRoute } from "@/app/api/meetings/[id]/minutes/[minutesId]/route";
import { POST as submitRoute } from "@/app/api/meetings/[id]/minutes/[minutesId]/submit/route";
import { POST as requestChangesRoute } from "@/app/api/meetings/[id]/minutes/[minutesId]/request-changes/route";
import { POST as approveRoute } from "@/app/api/meetings/[id]/minutes/[minutesId]/approve/route";

function jsonRequest(body: Record<string, unknown>) {
  return new Request("https://portal.test/api/meetings/meeting-1/minutes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function emptyRequest() {
  return new Request("https://portal.test/api/meetings/meeting-1/minutes/minutes-1/submit", { method: "POST" });
}

beforeEach(() => {
  requirePermissionMock.mockClear();
  getMeetingMinutesVersions.mockReset();
  createMeetingMinutesDraft.mockReset();
  editMeetingMinutesDraft.mockReset();
  submitMeetingMinutesForReview.mockReset();
  requestMeetingMinutesChanges.mockReset();
  approveMeetingMinutes.mockReset();
});

describe("GET /api/meetings/[id]/minutes", () => {
  it("requires meetings:read and returns the version history", async () => {
    getMeetingMinutesVersions.mockResolvedValueOnce([{ id: "minutes-1", version: 2 }]);

    const response = await listRoute(new Request("https://portal.test"), { params: Promise.resolve({ id: "meeting-1" }) });
    const body = await response.json();

    expect(requirePermissionMock).toHaveBeenCalledWith("meetings:read", "throw");
    expect(body.data).toEqual([{ id: "minutes-1", version: 2 }]);
  });
});

describe("POST /api/meetings/[id]/minutes (create draft)", () => {
  it("requires meetings:write", async () => {
    createMeetingMinutesDraft.mockResolvedValueOnce({ id: "minutes-1", status: "DRAFT" });

    await createRoute(jsonRequest({ title: "Minutes", bodyText: "Body" }), { params: Promise.resolve({ id: "meeting-1" }) });

    expect(requirePermissionMock).toHaveBeenCalledWith("meetings:write", "throw");
  });

  it("maps a MeetingMinutesError with a *_NOT_FOUND code to 404", async () => {
    createMeetingMinutesDraft.mockRejectedValueOnce(new MeetingMinutesError("MEETING_NOT_FOUND", "Meeting not found in this organization."));

    const response = await createRoute(jsonRequest({ title: "Minutes", bodyText: "Body" }), { params: Promise.resolve({ id: "meeting-1" }) });

    expect(response.status).toBe(404);
  });

  it("maps a MeetingMinutesError conflict code (e.g. draft already in progress) to 409", async () => {
    createMeetingMinutesDraft.mockRejectedValueOnce(
      new MeetingMinutesError("MEETING_MINUTES_DRAFT_IN_PROGRESS", "A draft or in-review version already exists for this meeting.")
    );

    const response = await createRoute(jsonRequest({ title: "Minutes", bodyText: "Body" }), { params: Promise.resolve({ id: "meeting-1" }) });

    expect(response.status).toBe(409);
  });

  it("rejects an empty title", async () => {
    const response = await createRoute(jsonRequest({ title: "", bodyText: "Body" }), { params: Promise.resolve({ id: "meeting-1" }) });
    expect(response.status).toBe(400);
    expect(createMeetingMinutesDraft).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/meetings/[id]/minutes/[minutesId] (edit)", () => {
  it("requires meetings:write and maps NOT_EDITABLE to 409", async () => {
    editMeetingMinutesDraft.mockRejectedValueOnce(new MeetingMinutesError("MEETING_MINUTES_NOT_EDITABLE", "Minutes in status APPROVED cannot be edited."));

    const response = await editRoute(jsonRequest({ title: "Updated" }), { params: Promise.resolve({ id: "meeting-1", minutesId: "minutes-1" }) });

    expect(requirePermissionMock).toHaveBeenCalledWith("meetings:write", "throw");
    expect(response.status).toBe(409);
  });
});

describe("POST .../submit", () => {
  it("requires meetings:write (the drafter submits their own draft)", async () => {
    submitMeetingMinutesForReview.mockResolvedValueOnce({ id: "minutes-1", status: "IN_REVIEW" });

    await submitRoute(emptyRequest(), { params: Promise.resolve({ id: "meeting-1", minutesId: "minutes-1" }) });

    expect(requirePermissionMock).toHaveBeenCalledWith("meetings:write", "throw");
  });
});

describe("POST .../request-changes", () => {
  it("requires meetings:minutes:review, distinct from meetings:write", async () => {
    requestMeetingMinutesChanges.mockResolvedValueOnce({ id: "minutes-1", status: "CHANGES_REQUESTED" });

    await requestChangesRoute(jsonRequest({ reason: "Please add the vote count." }), {
      params: Promise.resolve({ id: "meeting-1", minutesId: "minutes-1" }),
    });

    expect(requirePermissionMock).toHaveBeenCalledWith("meetings:minutes:review", "throw");
  });

  it("rejects a too-short reason", async () => {
    const response = await requestChangesRoute(jsonRequest({ reason: "x" }), {
      params: Promise.resolve({ id: "meeting-1", minutesId: "minutes-1" }),
    });
    expect(response.status).toBe(400);
    expect(requestMeetingMinutesChanges).not.toHaveBeenCalled();
  });
});

describe("POST .../approve", () => {
  it("requires meetings:minutes:approve, distinct from meetings:minutes:review", async () => {
    approveMeetingMinutes.mockResolvedValueOnce({ id: "minutes-1", status: "APPROVED" });

    await approveRoute(emptyRequest(), { params: Promise.resolve({ id: "meeting-1", minutesId: "minutes-1" }) });

    expect(requirePermissionMock).toHaveBeenCalledWith("meetings:minutes:approve", "throw");
  });

  it("maps an invalid-transition error to 409", async () => {
    approveMeetingMinutes.mockRejectedValueOnce(new MeetingMinutesError("MEETING_MINUTES_INVALID_TRANSITION", "Cannot approve minutes from status DRAFT."));

    const response = await approveRoute(emptyRequest(), { params: Promise.resolve({ id: "meeting-1", minutesId: "minutes-1" }) });

    expect(response.status).toBe(409);
  });
});
