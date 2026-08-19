import { beforeEach, describe, expect, it, vi } from "vitest";

const requireMobileMembership = vi.fn();
const pauseSchedule = vi.fn();
const resumeSchedule = vi.fn();
const cancelSchedule = vi.fn();
const changeAmount = vi.fn();
const retryFailedPayment = vi.fn();
const setProcessingCostCoverage = vi.fn();

vi.mock("@/lib/mobile-auth", () => ({
  requireMobileMembership: (...args: unknown[]) => requireMobileMembership(...args),
}));
vi.mock("@/lib/giving/recurring-self-service", () => ({
  pauseSchedule: (...a: unknown[]) => pauseSchedule(...a),
  resumeSchedule: (...a: unknown[]) => resumeSchedule(...a),
  cancelSchedule: (...a: unknown[]) => cancelSchedule(...a),
  changeAmount: (...a: unknown[]) => changeAmount(...a),
  retryFailedPayment: (...a: unknown[]) => retryFailedPayment(...a),
  setProcessingCostCoverage: (...a: unknown[]) => setProcessingCostCoverage(...a),
}));

import { POST } from "@/app/api/mobile/giving/recurring/manage/route";

function buildRequest(body: object) {
  return new Request("https://app.getunestra.com/api/mobile/giving/recurring/manage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/mobile/giving/recurring/manage — MOBILE-COVER coverage action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireMobileMembership.mockResolvedValue({
      session: { userId: "user-1" },
      organizationId: "org-1",
      memberId: "member-1",
    });
  });

  it("action 'coverage' forwards ONLY the boolean to the shared §41 self-service lib", async () => {
    setProcessingCostCoverage.mockResolvedValueOnce({ id: "sched-1" });

    const response = await POST(
      buildRequest({ organizationId: "org-1", scheduleId: "sched-1", action: "coverage", coverProcessingCosts: true })
    );

    expect(response.status).toBe(200);
    expect(setProcessingCostCoverage).toHaveBeenCalledWith({
      organizationId: "org-1",
      contributorUserId: "user-1",
      scheduleId: "sched-1",
      coverProcessingCosts: true,
    });
  });

  it("action 'coverage' without the boolean is a 400, and nothing is mutated", async () => {
    const response = await POST(buildRequest({ organizationId: "org-1", scheduleId: "sched-1", action: "coverage" }));

    expect(response.status).toBe(400);
    expect(setProcessingCostCoverage).not.toHaveBeenCalled();
  });

  it("injected amount/rate fields cannot reach the coverage toggle — the lib gets the boolean alone", async () => {
    setProcessingCostCoverage.mockResolvedValueOnce({ id: "sched-1" });

    await POST(
      buildRequest({
        organizationId: "org-1",
        scheduleId: "sched-1",
        action: "coverage",
        coverProcessingCosts: false,
        coverageCents: 1,
        feeAmount: -500,
        totalAmount: 1,
        processorRate: 0.0001,
      } as never)
    );

    expect(setProcessingCostCoverage).toHaveBeenCalledTimes(1);
    expect(setProcessingCostCoverage.mock.calls[0][0]).toEqual({
      organizationId: "org-1",
      contributorUserId: "user-1",
      scheduleId: "sched-1",
      coverProcessingCosts: false,
    });
  });

  it("existing actions are untouched: pause still routes to pauseSchedule", async () => {
    pauseSchedule.mockResolvedValueOnce(undefined);

    const response = await POST(buildRequest({ organizationId: "org-1", scheduleId: "sched-1", action: "pause" }));

    expect(response.status).toBe(200);
    expect(pauseSchedule).toHaveBeenCalledWith({
      organizationId: "org-1",
      contributorUserId: "user-1",
      scheduleId: "sched-1",
    });
    expect(setProcessingCostCoverage).not.toHaveBeenCalled();
  });
});
