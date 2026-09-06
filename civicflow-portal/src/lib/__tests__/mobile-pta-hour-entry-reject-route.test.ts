import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Build 27 — the mobile reject route is the approve route's exact sibling:
 * same guard pair (staff permission + PTA vertical), same service layer.
 * The service enforces PENDING-only finalization and requires a reason;
 * this file proves the route wiring and its authorization order.
 */

const requireMobileStaffPermission = vi.fn();
const requirePtaVerticalForMobile = vi.fn();
vi.mock("@/lib/mobile-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mobile-auth")>();
  return {
    ...actual,
    requireMobileStaffPermission: (...a: unknown[]) => requireMobileStaffPermission(...a),
    requirePtaVerticalForMobile: (...a: unknown[]) => requirePtaVerticalForMobile(...a),
  };
});

const rejectPtaVolunteerHourEntry = vi.fn();
vi.mock("@/lib/labs/pta/volunteers", () => ({
  rejectPtaVolunteerHourEntry: (...a: unknown[]) => rejectPtaVolunteerHourEntry(...a),
}));

import { POST } from "@/app/api/mobile/pta/volunteers/hour-entries/[entryId]/reject/route";
import { PERMISSIONS } from "@/lib/rbac";

function request(body: unknown) {
  return new Request("https://portal.test/api/mobile/pta/volunteers/hour-entries/entry-1/reject", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const params = { params: Promise.resolve({ entryId: "entry-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileStaffPermission.mockResolvedValue({ organizationId: "org-a", session: { userId: "officer-1", email: "officer@example.com" } });
  requirePtaVerticalForMobile.mockResolvedValue(undefined);
  rejectPtaVolunteerHourEntry.mockResolvedValue({ id: "entry-1", status: "REJECTED" });
});

describe("POST /api/mobile/pta/volunteers/hour-entries/[entryId]/reject", () => {
  it("requires the exact hour-approval permission and the PTA vertical, then rejects with the reason", async () => {
    const res = await POST(request({ organizationId: "org-a", reason: "Shift was cancelled." }), params);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(requireMobileStaffPermission).toHaveBeenCalledWith(expect.any(Request), "org-a", PERMISSIONS.PTA_VOLUNTEER_HOURS_APPROVE);
    expect(requirePtaVerticalForMobile).toHaveBeenCalledWith("org-a");
    expect(rejectPtaVolunteerHourEntry).toHaveBeenCalledWith("org-a", "entry-1", "Shift was cancelled.", "officer-1", "officer@example.com");
  });

  it("rejects an empty reason with 400 before any service call", async () => {
    const res = await POST(request({ organizationId: "org-a", reason: "  " }), params);
    expect(res.status).toBe(400);
    expect(rejectPtaVolunteerHourEntry).not.toHaveBeenCalled();
  });

  it("propagates the permission guard's denial", async () => {
    const { MobileForbiddenError } = await import("@/lib/mobile-auth");
    requireMobileStaffPermission.mockRejectedValueOnce(new MobileForbiddenError("no"));
    const res = await POST(request({ organizationId: "org-a", reason: "x" }), params);
    expect(res.status).toBe(403);
    expect(rejectPtaVolunteerHourEntry).not.toHaveBeenCalled();
  });
});
