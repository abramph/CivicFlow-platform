import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Bridge-level authorization for the family-facing progression read.
 * parent-progression.ts already covers the data/publication rules against a
 * mocked Prisma, so this file proves only what the route itself owns:
 * authenticate before any work, never accept a client-supplied household
 * id, enforce PTA vertical + tenant scope through the shared mobile guard,
 * and expose no write verb.
 */

const requireMobilePtaHouseholdAccess = vi.fn();
vi.mock("@/lib/mobile-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mobile-auth")>();
  return { ...actual, requireMobilePtaHouseholdAccess: (...a: unknown[]) => requireMobilePtaHouseholdAccess(...a) };
});

const getPtaParentProgressionSummary = vi.fn();
vi.mock("@/lib/labs/pta/parent-progression", () => ({
  getPtaParentProgressionSummary: (...a: unknown[]) => getPtaParentProgressionSummary(...a),
}));

import { MobileAuthError, MobileForbiddenError } from "@/lib/mobile-auth";
import { PtaError } from "@/lib/labs/pta/errors";
import * as route from "../route";

const ORG_ID = "org-1";
const HOUSEHOLD_ID = "household-1";
const ACCESS = {
  organizationId: ORG_ID,
  adult: { id: "adult-1", householdId: HOUSEHOLD_ID, billingMemberId: null },
  session: { userId: "user-1", email: "parent@example.org" },
};

const SUMMARY = {
  currentSchoolYear: "2026-2027",
  nextSchoolYear: "2027-2028",
  students: [
    {
      studentId: "s-1",
      displayName: "Ada",
      currentGrade: "5th Grade",
      currentClassroom: "Room 12",
      nextGrade: "6th Grade",
      nextClassroom: "Room 20",
      status: "CONFIRMED" as const,
    },
  ],
};

function request(url: string) {
  return new Request(url, { method: "GET", headers: { authorization: "Bearer token" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireMobilePtaHouseholdAccess.mockResolvedValue(ACCESS);
  getPtaParentProgressionSummary.mockResolvedValue(SUMMARY);
});

describe("GET /api/mobile/pta/progression", () => {
  it("requires organizationId in the query string", async () => {
    const response = await route.GET(request("https://x.test/api/mobile/pta/progression"));
    expect(response.status).toBe(400);
    expect(requireMobilePtaHouseholdAccess).not.toHaveBeenCalled();
    expect(getPtaParentProgressionSummary).not.toHaveBeenCalled();
  });

  it("authenticates through the shared mobile PTA household guard before doing any work", async () => {
    await route.GET(request(`https://x.test/api/mobile/pta/progression?organizationId=${ORG_ID}`));
    expect(requireMobilePtaHouseholdAccess).toHaveBeenCalledTimes(1);
    // The guard itself enforces bearer auth, PTA vertical + active org, the
    // caller's own household linkage, and organization access.
    expect(requireMobilePtaHouseholdAccess.mock.calls[0][1]).toBe(ORG_ID);
  });

  it("resolves the household ONLY from the authenticated linkage, never from the client", async () => {
    await route.GET(
      request(
        `https://x.test/api/mobile/pta/progression?organizationId=${ORG_ID}&householdId=household-of-another-family&studentId=s-999`
      )
    );
    // Extra query parameters are ignored entirely: the service is called
    // with the server-resolved household id.
    expect(getPtaParentProgressionSummary).toHaveBeenCalledWith(ORG_ID, HOUSEHOLD_ID);
  });

  it("uses the guard's verified organization id, not the raw query value", async () => {
    requireMobilePtaHouseholdAccess.mockResolvedValue({ ...ACCESS, organizationId: "org-verified" });
    await route.GET(request("https://x.test/api/mobile/pta/progression?organizationId=org-claimed"));
    expect(getPtaParentProgressionSummary).toHaveBeenCalledWith("org-verified", HOUSEHOLD_ID);
  });

  it("returns the family summary envelope on success", async () => {
    const response = await route.GET(request(`https://x.test/api/mobile/pta/progression?organizationId=${ORG_ID}`));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({ ok: true, data: SUMMARY });
  });

  it("never leaks preview, batch, outcome or audit fields in the response", async () => {
    const response = await route.GET(request(`https://x.test/api/mobile/pta/progression?organizationId=${ORG_ID}`));
    const body = JSON.stringify(await response.json());
    for (const forbidden of [
      "batchId",
      "idempotencyKey",
      "commitIdempotencyKey",
      "outcome",
      "NEEDS_REVIEW",
      "PLANNED",
      "actorUserId",
      "actorEmail",
      "notes",
      "previewedAt",
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });

  it("propagates an unauthenticated failure without querying progression data", async () => {
    requireMobilePtaHouseholdAccess.mockRejectedValue(new MobileAuthError());
    const response = await route.GET(request(`https://x.test/api/mobile/pta/progression?organizationId=${ORG_ID}`));
    expect(response.status).toBe(401);
    expect(getPtaParentProgressionSummary).not.toHaveBeenCalled();
  });

  it("denies a caller with no PTA household linkage in this organization (staff-only or cross-family)", async () => {
    requireMobilePtaHouseholdAccess.mockRejectedValue(
      new MobileForbiddenError("Your account is not linked to a PTA household in this organization")
    );
    const response = await route.GET(request(`https://x.test/api/mobile/pta/progression?organizationId=${ORG_ID}`));
    expect(response.status).toBe(403);
    expect(getPtaParentProgressionSummary).not.toHaveBeenCalled();
  });

  it("denies a non-PTA vertical organization (Community/Nonprofit, Church, Union) via the shared vertical lock", async () => {
    // requirePtaVerticalForMobile, called inside the guard, throws exactly
    // this for any organization whose primaryVertical is not PTA.
    requireMobilePtaHouseholdAccess.mockRejectedValue(new MobileForbiddenError("PTA is not available for this organization"));
    const response = await route.GET(request("https://x.test/api/mobile/pta/progression?organizationId=org-community"));
    expect(response.status).toBe(403);
    expect(getPtaParentProgressionSummary).not.toHaveBeenCalled();
  });

  it("returns the standard unavailable response when the platform progression flag is off", async () => {
    getPtaParentProgressionSummary.mockRejectedValue(
      new PtaError("PTA_STUDENT_PROGRESSION_PLATFORM_DISABLED", "Student progression is not enabled on this platform.")
    );
    const response = await route.GET(request(`https://x.test/api/mobile/pta/progression?organizationId=${ORG_ID}`));
    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload.code).toBe("PTA_STUDENT_PROGRESSION_PLATFORM_DISABLED");
    expect(payload.data).toBeUndefined();
  });

  it("returns the standard unavailable response when the organization progression flag is off", async () => {
    getPtaParentProgressionSummary.mockRejectedValue(
      new PtaError("PTA_STUDENT_PROGRESSION_DISABLED", "Student progression has not been turned on for this organization.")
    );
    const response = await route.GET(request(`https://x.test/api/mobile/pta/progression?organizationId=${ORG_ID}`));
    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload.code).toBe("PTA_STUDENT_PROGRESSION_DISABLED");
    expect(payload.data).toBeUndefined();
  });

  it("exposes no write verb — administrative progression stays portal-only", () => {
    expect(route).not.toHaveProperty("POST");
    expect(route).not.toHaveProperty("PATCH");
    expect(route).not.toHaveProperty("PUT");
    expect(route).not.toHaveProperty("DELETE");
  });
});
