import { beforeEach, describe, expect, it, vi } from "vitest";

const upsertOrgSettings = vi.fn();
const updateOrgSettings = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgSettings: {
      upsert: (...args: unknown[]) => upsertOrgSettings(...args),
      update: (...args: unknown[]) => updateOrgSettings(...args),
    },
  },
}));

vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return {
    ...actual,
    requirePermission: vi.fn().mockResolvedValue({
      session: { userId: "staff-1", userEmail: "treasurer@example.com" },
      organizationId: "org-a",
    }),
  };
});

vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

import { PATCH } from "@/app/api/settings/dues/route";

function patchRequest(body: unknown) {
  return new Request("https://portal.test/api/settings/dues", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    duesStartRule: "JOIN_DATE",
    delinquentAfterMonths: 3,
    autoMarkDelinquent: true,
    gracePeriodDays: 0,
    financialEditWindowHours: 24,
    requireReasonForFinancialEdits: true,
    allowFinanceCorrections: true,
    lockReceiptsAfterIssue: true,
    ...overrides,
  };
}

/** UNION-WEB-DASH: duesCollectionMethod is presentation-only (never a
 * payroll integration) -- these tests only cover that the new field
 * round-trips and validates correctly, mirroring the existing dues policy
 * fields' coverage shape. */
describe("PATCH /api/settings/dues — duesCollectionMethod", () => {
  beforeEach(() => {
    upsertOrgSettings.mockReset().mockResolvedValue({ id: "settings-1", organizationId: "org-a" });
    updateOrgSettings.mockReset().mockResolvedValue({ id: "settings-1", organizationId: "org-a", duesCollectionMethod: "PAYROLL_DEDUCTION" });
  });

  it("accepts PAYROLL_DEDUCTION and passes it straight through to the update", async () => {
    const response = await PATCH(patchRequest(basePayload({ duesCollectionMethod: "PAYROLL_DEDUCTION" })));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(updateOrgSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-a" },
        data: expect.objectContaining({ duesCollectionMethod: "PAYROLL_DEDUCTION" }),
      })
    );
  });

  it("accepts null to clear an already-configured method back to unconfigured", async () => {
    const response = await PATCH(patchRequest(basePayload({ duesCollectionMethod: null })));

    expect(response.status).toBe(200);
    expect(updateOrgSettings).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ duesCollectionMethod: null }) })
    );
  });

  it("never guesses a value when the field is omitted entirely -- stays untouched (undefined), not defaulted", async () => {
    const response = await PATCH(patchRequest(basePayload()));

    expect(response.status).toBe(200);
    const call = updateOrgSettings.mock.calls[0][0];
    expect(call.data.duesCollectionMethod).toBeUndefined();
  });

  it("rejects an invalid method value", async () => {
    const response = await PATCH(patchRequest(basePayload({ duesCollectionMethod: "VENMO" })));

    expect(response.status).toBe(400);
    expect(updateOrgSettings).not.toHaveBeenCalled();
  });

  it.each(["UNESTRA_DIRECT", "EXTERNAL", "MIXED", "NONE"])("accepts %s", async (method) => {
    const response = await PATCH(patchRequest(basePayload({ duesCollectionMethod: method })));
    expect(response.status).toBe(200);
  });
});
