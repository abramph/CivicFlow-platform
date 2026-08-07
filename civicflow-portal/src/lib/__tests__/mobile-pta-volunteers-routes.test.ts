import { beforeEach, describe, expect, it, vi } from "vitest";

const requireMobilePtaHouseholdAccess = vi.fn();
const requireMobileStaffPermission = vi.fn();
const requirePtaVerticalForMobile = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/mobile-auth", () => ({
  requireMobilePtaHouseholdAccess: (...args: unknown[]) => requireMobilePtaHouseholdAccess(...args),
  requireMobileStaffPermission: (...args: unknown[]) => requireMobileStaffPermission(...args),
  requirePtaVerticalForMobile: (...args: unknown[]) => requirePtaVerticalForMobile(...args),
  MobileAuthError: class MobileAuthError extends Error {
    status = 401;
  },
  MobileForbiddenError: class MobileForbiddenError extends Error {
    status = 403;
  },
}));

const claimPtaVolunteerSlot = vi.fn();
const cancelPtaVolunteerSignup = vi.fn();
const checkInPtaVolunteer = vi.fn();
const approvePtaVolunteerHourEntry = vi.fn();
const getPtaVolunteerHourTotalsForHousehold = vi.fn();
vi.mock("@/lib/labs/pta/volunteers", () => ({
  claimPtaVolunteerSlot: (...args: unknown[]) => claimPtaVolunteerSlot(...args),
  cancelPtaVolunteerSignup: (...args: unknown[]) => cancelPtaVolunteerSignup(...args),
  checkInPtaVolunteer: (...args: unknown[]) => checkInPtaVolunteer(...args),
  approvePtaVolunteerHourEntry: (...args: unknown[]) => approvePtaVolunteerHourEntry(...args),
  getPtaVolunteerHourTotalsForHousehold: (...args: unknown[]) => getPtaVolunteerHourTotalsForHousehold(...args),
}));

vi.mock("@/lib/labs/pta/profile", () => ({
  getPtaProfile: vi.fn().mockResolvedValue({ currentSchoolYear: "2026-2027" }),
}));

vi.mock("@/lib/labs/pta/errors", () => {
  class PtaError extends Error {
    status: number;
    constructor(code: string, message: string) {
      super(message);
      this.status = code === "PTA_CANCELLATION_DEADLINE_PASSED" ? 409 : code === "PTA_SELF_APPROVAL_FORBIDDEN" ? 403 : 400;
    }
  }
  return { PtaError };
});

import { POST as claimRoute } from "@/app/api/mobile/pta/volunteers/slots/[slotId]/claim/route";
import { POST as cancelRoute } from "@/app/api/mobile/pta/volunteers/slots/[slotId]/cancel/route";
import { POST as checkinRoute } from "@/app/api/mobile/pta/volunteers/signups/[signupId]/checkin/route";
import { POST as approveRoute } from "@/app/api/mobile/pta/volunteers/hour-entries/[entryId]/approve/route";
import { GET as hoursRoute } from "@/app/api/mobile/pta/volunteers/hours/route";
import { PtaError } from "@/lib/labs/pta/errors";

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  requireMobilePtaHouseholdAccess.mockReset();
  requireMobileStaffPermission.mockReset();
  requirePtaVerticalForMobile.mockReset();
  requirePtaVerticalForMobile.mockResolvedValue(undefined);
  claimPtaVolunteerSlot.mockReset();
  cancelPtaVolunteerSignup.mockReset();
  checkInPtaVolunteer.mockReset();
  approvePtaVolunteerHourEntry.mockReset();
  getPtaVolunteerHourTotalsForHousehold.mockReset();
});

describe("POST /api/mobile/pta/volunteers/slots/[slotId]/claim", () => {
  it("never accepts a client-supplied householdAdultId — only the verified caller's own adult id is used", async () => {
    requireMobilePtaHouseholdAccess.mockResolvedValueOnce({
      organizationId: "org-real",
      session: { userId: "user-1", email: "parent@example.com" },
      adult: { id: "adult-real", householdId: "household-1" },
    });
    claimPtaVolunteerSlot.mockResolvedValueOnce({ id: "signup-1", status: "SIGNED_UP" });

    const response = await claimRoute(
      jsonRequest("https://portal.test/api/mobile/pta/volunteers/slots/slot-1/claim", {
        organizationId: "org-real",
        householdAdultId: "adult-attacker-supplied",
      }),
      { params: Promise.resolve({ slotId: "slot-1" }) }
    );

    expect(response.status).toBe(200);
    expect(claimPtaVolunteerSlot).toHaveBeenCalledWith("org-real", "slot-1", "adult-real", "user-1", "parent@example.com");
  });

  it("requires organizationId in the body", async () => {
    const response = await claimRoute(jsonRequest("https://portal.test/api/mobile/pta/volunteers/slots/slot-1/claim", {}), {
      params: Promise.resolve({ slotId: "slot-1" }),
    });
    expect(response.status).toBe(400);
    expect(requireMobilePtaHouseholdAccess).not.toHaveBeenCalled();
  });
});

describe("POST /api/mobile/pta/volunteers/slots/[slotId]/cancel", () => {
  it("maps a cancellation-deadline-passed error to 409, not a generic 400/500", async () => {
    requireMobilePtaHouseholdAccess.mockResolvedValueOnce({
      organizationId: "org-real",
      session: { userId: "user-1", email: "parent@example.com" },
      adult: { id: "adult-real", householdId: "household-1" },
    });
    cancelPtaVolunteerSignup.mockRejectedValueOnce(new PtaError("PTA_CANCELLATION_DEADLINE_PASSED", "too late"));

    const response = await cancelRoute(
      jsonRequest("https://portal.test/api/mobile/pta/volunteers/slots/slot-1/cancel", { organizationId: "org-real" }),
      { params: Promise.resolve({ slotId: "slot-1" }) }
    );

    expect(response.status).toBe(409);
  });
});

describe("POST /api/mobile/pta/volunteers/signups/[signupId]/checkin", () => {
  it("requires the pta:volunteers:checkin permission via requireMobileStaffPermission, not requireMobilePtaHouseholdAccess", async () => {
    requireMobileStaffPermission.mockResolvedValueOnce({
      organizationId: "org-real",
      session: { userId: "officer-1", email: "coordinator@example.com" },
      role: "STAFF",
    });
    checkInPtaVolunteer.mockResolvedValueOnce({ id: "attendance-1", checkInAt: new Date() });

    const response = await checkinRoute(
      jsonRequest("https://portal.test/api/mobile/pta/volunteers/signups/signup-1/checkin", { organizationId: "org-real" }),
      { params: Promise.resolve({ signupId: "signup-1" }) }
    );

    expect(response.status).toBe(200);
    expect(requireMobileStaffPermission).toHaveBeenCalledWith(expect.anything(), "org-real", "pta:volunteers:checkin");
    expect(requireMobilePtaHouseholdAccess).not.toHaveBeenCalled();
  });

  it("propagates a 403 when the caller lacks the checkin permission", async () => {
    const { MobileForbiddenError } = await import("@/lib/mobile-auth");
    requireMobileStaffPermission.mockRejectedValueOnce(new MobileForbiddenError("Permission denied: pta:volunteers:checkin"));

    const response = await checkinRoute(
      jsonRequest("https://portal.test/api/mobile/pta/volunteers/signups/signup-1/checkin", { organizationId: "org-real" }),
      { params: Promise.resolve({ signupId: "signup-1" }) }
    );

    expect(response.status).toBe(403);
    expect(checkInPtaVolunteer).not.toHaveBeenCalled();
  });
});

describe("POST /api/mobile/pta/volunteers/hour-entries/[entryId]/approve", () => {
  it("maps self-approval rejection to 403", async () => {
    requireMobileStaffPermission.mockResolvedValueOnce({
      organizationId: "org-real",
      session: { userId: "officer-1", email: "coordinator@example.com" },
      role: "ORG_OWNER",
    });
    approvePtaVolunteerHourEntry.mockRejectedValueOnce(new PtaError("PTA_SELF_APPROVAL_FORBIDDEN", "no self approval"));

    const response = await approveRoute(
      jsonRequest("https://portal.test/api/mobile/pta/volunteers/hour-entries/entry-1/approve", { organizationId: "org-real" }),
      { params: Promise.resolve({ entryId: "entry-1" }) }
    );

    expect(response.status).toBe(403);
  });

  it("requires the pta:volunteer-hours:approve permission specifically, not pta:volunteers:checkin", async () => {
    requireMobileStaffPermission.mockResolvedValueOnce({
      organizationId: "org-real",
      session: { userId: "officer-1", email: "coordinator@example.com" },
      role: "ORG_OWNER",
    });
    approvePtaVolunteerHourEntry.mockResolvedValueOnce({ id: "entry-1", status: "APPROVED" });

    await approveRoute(jsonRequest("https://portal.test/api/mobile/pta/volunteers/hour-entries/entry-1/approve", { organizationId: "org-real" }), {
      params: Promise.resolve({ entryId: "entry-1" }),
    });

    expect(requireMobileStaffPermission).toHaveBeenCalledWith(expect.anything(), "org-real", "pta:volunteer-hours:approve");
  });
});

describe("GET /api/mobile/pta/volunteers/hours", () => {
  it("reports 'not required' (null), never a bare 0, when no requirement is configured", async () => {
    requireMobilePtaHouseholdAccess.mockResolvedValueOnce({
      organizationId: "org-real",
      session: { userId: "user-1", email: "parent@example.com" },
      adult: { id: "adult-real", householdId: "household-1" },
    });
    getPtaVolunteerHourTotalsForHousehold.mockResolvedValueOnce({
      approvedMinutes: 120,
      pendingMinutes: 0,
      requiredMinutes: null,
      remainingMinutes: null,
    });

    const response = await hoursRoute(
      new Request("https://portal.test/api/mobile/pta/volunteers/hours?organizationId=org-real", {
        headers: { Authorization: "Bearer test-token" },
      })
    );
    const data = await response.json();

    expect(data.data.requiredMinutes).toBeNull();
    expect(data.data.remainingMinutes).toBeNull();
    expect(data.data.approvedMinutes).toBe(120);
  });
});
