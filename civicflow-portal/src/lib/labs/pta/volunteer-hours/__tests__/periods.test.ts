import { beforeEach, describe, expect, it, vi } from "vitest";

const createPeriod = vi.fn();
const updatePeriod = vi.fn();
const findManyPeriods = vi.fn();
const findFirstPeriod = vi.fn();
const findUniqueOrgSettings = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaVolunteerRequirementPeriod: {
      create: (...a: unknown[]) => createPeriod(...a),
      update: (...a: unknown[]) => updatePeriod(...a),
      findMany: (...a: unknown[]) => findManyPeriods(...a),
      findFirst: (...a: unknown[]) => findFirstPeriod(...a),
    },
    orgSettings: { findUnique: (...a: unknown[]) => findUniqueOrgSettings(...a) },
  },
}));

const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...a: unknown[]) => createAuditEvent(...a) }));

beforeEach(() => {
  vi.clearAllMocks();
  findUniqueOrgSettings.mockResolvedValue({ timezone: "America/Chicago" });
  findManyPeriods.mockResolvedValue([]);
  createPeriod.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "period-1",
    ...data,
  }));
});

const actor = { userId: "u1", userEmail: "officer@example.com" };

const baseInput = {
  name: "2026-2027 School Year",
  periodType: "SCHOOL_YEAR" as const,
  startsOn: new Date("2026-08-01"),
  endsOn: new Date("2027-06-01"),
  requiredMinutesDefault: 1200,
};

describe("createVolunteerRequirementPeriod — date validation", () => {
  it("rejects end date on or before start date", async () => {
    const { createVolunteerRequirementPeriod } = await import("../periods");
    await expect(
      createVolunteerRequirementPeriod("org-1", { ...baseInput, startsOn: new Date("2027-01-01"), endsOn: new Date("2026-01-01") }, actor)
    ).rejects.toMatchObject({ code: "PTA_VOLUNTEER_PERIOD_INVALID_DATES" });
  });

  it("rejects a negative or non-integer required-minutes value", async () => {
    const { createVolunteerRequirementPeriod } = await import("../periods");
    await expect(createVolunteerRequirementPeriod("org-1", { ...baseInput, requiredMinutesDefault: -5 }, actor)).rejects.toMatchObject({
      code: "PTA_VOLUNTEER_PERIOD_INVALID_DATES",
    });
  });

  it("rejects a volunteer deadline outside the period's start/end range", async () => {
    const { createVolunteerRequirementPeriod } = await import("../periods");
    await expect(
      createVolunteerRequirementPeriod("org-1", { ...baseInput, volunteerDeadline: new Date("2028-01-01") }, actor)
    ).rejects.toMatchObject({ code: "PTA_VOLUNTEER_PERIOD_INVALID_DATES" });
  });

  it("rejects a buyout window whose end precedes its start", async () => {
    const { createVolunteerRequirementPeriod } = await import("../periods");
    await expect(
      createVolunteerRequirementPeriod(
        "org-1",
        { ...baseInput, buyoutWindowStart: new Date("2026-12-01"), buyoutWindowEnd: new Date("2026-09-01") },
        actor
      )
    ).rejects.toMatchObject({ code: "PTA_VOLUNTEER_PERIOD_INVALID_DATES" });
  });

  it("rejects a blank name", async () => {
    const { createVolunteerRequirementPeriod } = await import("../periods");
    await expect(createVolunteerRequirementPeriod("org-1", { ...baseInput, name: "   " }, actor)).rejects.toMatchObject({
      code: "PTA_VOLUNTEER_PERIOD_INVALID_DATES",
    });
  });
});

describe("createVolunteerRequirementPeriod — active-period conflict detection", () => {
  it("allows two DRAFT periods with the same dates and scope — DRAFT never conflicts", async () => {
    findManyPeriods.mockResolvedValue([]); // conflict query only ever looks at status: ACTIVE
    const { createVolunteerRequirementPeriod } = await import("../periods");
    await expect(createVolunteerRequirementPeriod("org-1", { ...baseInput, status: "DRAFT" }, actor)).resolves.toBeTruthy();
    expect(findManyPeriods).not.toHaveBeenCalled();
  });

  it("rejects an ACTIVE period whose dates overlap another ACTIVE period in the same (null) scope", async () => {
    findManyPeriods.mockResolvedValue([
      { id: "existing", name: "Existing Active Period", startsOn: new Date("2026-06-01"), endsOn: new Date("2027-01-01") },
    ]);
    const { createVolunteerRequirementPeriod } = await import("../periods");
    await expect(createVolunteerRequirementPeriod("org-1", { ...baseInput, status: "ACTIVE" }, actor)).rejects.toMatchObject({
      code: "PTA_VOLUNTEER_PERIOD_CONFLICT",
    });
  });

  it("allows overlapping ACTIVE periods when they carry different scopeLabels — intentional separate grouping", async () => {
    // The conflict query itself filters by scopeLabel, so a properly-scoped
    // candidate set returning empty means "no conflict in MY scope."
    findManyPeriods.mockResolvedValue([]);
    const { createVolunteerRequirementPeriod } = await import("../periods");
    await expect(
      createVolunteerRequirementPeriod("org-1", { ...baseInput, status: "ACTIVE", scopeLabel: "Elementary Campus" }, actor)
    ).resolves.toBeTruthy();
    expect(findManyPeriods).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ scopeLabel: "Elementary Campus", status: "ACTIVE" }) })
    );
  });

  it("allows a new ACTIVE period whose dates do not intersect an existing ACTIVE period in the same scope", async () => {
    findManyPeriods.mockResolvedValue([
      { id: "existing", name: "Fall Term", startsOn: new Date("2025-08-01"), endsOn: new Date("2026-01-01") },
    ]);
    const { createVolunteerRequirementPeriod } = await import("../periods");
    await expect(createVolunteerRequirementPeriod("org-1", { ...baseInput, status: "ACTIVE" }, actor)).resolves.toBeTruthy();
  });
});

describe("createVolunteerRequirementPeriod — snapshot + audit", () => {
  it("snapshots the org's OrgSettings.timezone onto the period at creation", async () => {
    findUniqueOrgSettings.mockResolvedValue({ timezone: "America/Denver" });
    const { createVolunteerRequirementPeriod } = await import("../periods");
    await createVolunteerRequirementPeriod("org-1", baseInput, actor);
    expect(createPeriod).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ timezone: "America/Denver" }) }));
  });

  it("falls back to America/New_York when the org has no OrgSettings row", async () => {
    findUniqueOrgSettings.mockResolvedValue(null);
    const { createVolunteerRequirementPeriod } = await import("../periods");
    await createVolunteerRequirementPeriod("org-1", baseInput, actor);
    expect(createPeriod).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ timezone: "America/New_York" }) }));
  });

  it("writes an audit event on create", async () => {
    const { createVolunteerRequirementPeriod } = await import("../periods");
    await createVolunteerRequirementPeriod("org-1", baseInput, actor);
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", action: "pta.volunteer_hours.period_created", actorUserId: "u1" })
    );
  });
});

describe("getVolunteerRequirementPeriod / updateVolunteerRequirementPeriod", () => {
  it("throws PTA_VOLUNTEER_PERIOD_NOT_FOUND for a missing or cross-org id", async () => {
    findFirstPeriod.mockResolvedValue(null);
    const { getVolunteerRequirementPeriod } = await import("../periods");
    await expect(getVolunteerRequirementPeriod("org-1", "nope")).rejects.toMatchObject({ code: "PTA_VOLUNTEER_PERIOD_NOT_FOUND" });
    expect(findFirstPeriod).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "nope", organizationId: "org-1" } }));
  });

  it("excludes the period being edited from its own conflict check", async () => {
    findFirstPeriod.mockResolvedValue({ id: "period-1", status: "ACTIVE", requiredMinutesDefault: 1200 });
    findManyPeriods.mockResolvedValue([]);
    updatePeriod.mockResolvedValue({ id: "period-1", status: "ACTIVE" });
    const { updateVolunteerRequirementPeriod } = await import("../periods");
    await updateVolunteerRequirementPeriod("org-1", "period-1", { ...baseInput, status: "ACTIVE" }, actor);
    expect(findManyPeriods).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { not: "period-1" } }) }));
  });
});
