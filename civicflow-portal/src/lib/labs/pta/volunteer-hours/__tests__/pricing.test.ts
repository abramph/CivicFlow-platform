import { beforeEach, describe, expect, it, vi } from "vitest";

const createWindow = vi.fn();
const updateWindow = vi.fn();
const deleteWindow = vi.fn();
const findManyWindows = vi.fn();
const findFirstWindow = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaVolunteerPricingWindow: {
      create: (...a: unknown[]) => createWindow(...a),
      update: (...a: unknown[]) => updateWindow(...a),
      delete: (...a: unknown[]) => deleteWindow(...a),
      findMany: (...a: unknown[]) => findManyWindows(...a),
      findFirst: (...a: unknown[]) => findFirstWindow(...a),
    },
  },
}));

const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...a: unknown[]) => createAuditEvent(...a) }));

const getVolunteerRequirementPeriod = vi.fn();
vi.mock("../periods", () => ({ getVolunteerRequirementPeriod: (...a: unknown[]) => getVolunteerRequirementPeriod(...a) }));

beforeEach(() => {
  vi.clearAllMocks();
  getVolunteerRequirementPeriod.mockResolvedValue({ id: "period-1", timezone: "America/Chicago" });
  findManyWindows.mockResolvedValue([]);
  createWindow.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "window-1", ...data }));
});

const actor = { userId: "u1", userEmail: "officer@example.com" };

// FC-6: PricingWindowInput.startAt/endAt are now zone-less-or-absolute
// strings, not Date objects — see src/lib/labs/pta/volunteer-hours/timezone.ts.
// These carry an explicit "Z" suffix so resolveOrgWallTimeToUtc treats them
// as already-absolute instants (short-circuits the org-timezone math),
// keeping these tests' exact instant values identical to before FC-6.
const baseInput = {
  name: "Contract signing through Aug 15",
  startAt: "2026-06-01T00:00:00Z",
  endAt: "2026-08-15T00:00:00Z",
  rateType: "FULL_BUYOUT" as const,
  amountCents: 25_000,
};

describe("createPricingWindow — validation", () => {
  it("rejects a blank name", async () => {
    const { createPricingWindow } = await import("../pricing");
    await expect(createPricingWindow("org-1", "period-1", { ...baseInput, name: "  " }, actor)).rejects.toMatchObject({
      code: "PTA_VALIDATION_ERROR",
    });
  });

  it("rejects endAt on or before startAt", async () => {
    const { createPricingWindow } = await import("../pricing");
    await expect(
      createPricingWindow("org-1", "period-1", { ...baseInput, startAt: "2026-09-01T00:00:00Z", endAt: "2026-08-01T00:00:00Z" }, actor)
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });

  it("rejects a negative amount", async () => {
    const { createPricingWindow } = await import("../pricing");
    await expect(createPricingWindow("org-1", "period-1", { ...baseInput, amountCents: -1 }, actor)).rejects.toMatchObject({
      code: "PTA_VALIDATION_ERROR",
    });
  });

  it("snapshots the period's timezone onto the window", async () => {
    getVolunteerRequirementPeriod.mockResolvedValue({ id: "period-1", timezone: "America/Denver" });
    const { createPricingWindow } = await import("../pricing");
    await createPricingWindow("org-1", "period-1", baseInput, actor);
    expect(createWindow).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ timezone: "America/Denver" }) }));
  });

  it("writes an audit event on create", async () => {
    const { createPricingWindow } = await import("../pricing");
    await createPricingWindow("org-1", "period-1", baseInput, actor);
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "pta.volunteer_hours.pricing_window_created" }));
  });
});

describe("createPricingWindow — overlap prevention", () => {
  it("rejects two overlapping ACTIVE windows of the same rateType", async () => {
    findManyWindows.mockResolvedValue([
      { id: "existing", name: "Standard rate", startAt: new Date("2026-08-01"), endAt: new Date("2026-10-01") },
    ]);
    const { createPricingWindow } = await import("../pricing");
    await expect(createPricingWindow("org-1", "period-1", baseInput, actor)).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });

  it("allows adjacent (non-overlapping, touching) windows of the same rateType", async () => {
    findManyWindows.mockResolvedValue([
      { id: "existing", name: "Standard rate", startAt: new Date(baseInput.endAt), endAt: new Date("2026-10-01") },
    ]);
    const { createPricingWindow } = await import("../pricing");
    await expect(createPricingWindow("org-1", "period-1", baseInput, actor)).resolves.toBeTruthy();
  });

  it("allows overlapping windows of DIFFERENT rateTypes — the overlap query itself is scoped per rateType", async () => {
    findManyWindows.mockResolvedValue([]);
    const { createPricingWindow } = await import("../pricing");
    await createPricingWindow("org-1", "period-1", { ...baseInput, rateType: "PER_HOUR" }, actor);
    expect(findManyWindows).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ rateType: "PER_HOUR", active: true }) }));
  });

  it("allows an overlapping window when the new one is created inactive — never live, never conflicts", async () => {
    const { createPricingWindow } = await import("../pricing");
    await expect(createPricingWindow("org-1", "period-1", { ...baseInput, active: false }, actor)).resolves.toBeTruthy();
    expect(findManyWindows).not.toHaveBeenCalled();
  });

  it("excludes the window being edited from its own conflict check", async () => {
    findFirstWindow.mockResolvedValue({ id: "window-1", organizationId: "org-1", periodId: "period-1" });
    findManyWindows.mockResolvedValue([]);
    updateWindow.mockResolvedValue({ id: "window-1", amountCents: baseInput.amountCents, active: true });
    const { updatePricingWindow } = await import("../pricing");
    await updatePricingWindow("org-1", "period-1", "window-1", baseInput, actor);
    expect(findManyWindows).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { not: "window-1" } }) }));
  });
});

describe("resolveVolunteerBuyoutRate", () => {
  it("queries for an ACTIVE window of the requested type containing the instant, most-recent-first", async () => {
    findFirstWindow.mockResolvedValue({ id: "window-1", amountCents: 1_500, rateType: "PER_HOUR" });
    const { resolveVolunteerBuyoutRate } = await import("../pricing");
    const at = new Date("2026-09-01");
    const result = await resolveVolunteerBuyoutRate("org-1", "period-1", "PER_HOUR", at);
    expect(result).toMatchObject({ amountCents: 1_500 });
    expect(findFirstWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org-1",
          periodId: "period-1",
          rateType: "PER_HOUR",
          active: true,
          startAt: { lte: at },
          endAt: { gt: at },
        }),
      })
    );
  });

  it("returns null when nothing is configured for that moment/type — server never fabricates a rate", async () => {
    findFirstWindow.mockResolvedValue(null);
    const { resolveVolunteerBuyoutRate } = await import("../pricing");
    await expect(resolveVolunteerBuyoutRate("org-1", "period-1", "FULL_BUYOUT")).resolves.toBeNull();
  });
});
