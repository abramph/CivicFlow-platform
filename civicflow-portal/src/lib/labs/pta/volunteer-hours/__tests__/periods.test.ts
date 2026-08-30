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

// FC-6: these are zone-less wall-clock date strings ("YYYY-MM-DD") — exactly
// what the settings UI's <input type="date"> sends — resolved server-side
// against the org's (or, for updates, the existing period's own
// already-snapshotted) timezone. Never `Date` objects at this layer anymore.
const baseInput = {
  name: "2026-2027 School Year",
  periodType: "SCHOOL_YEAR" as const,
  startsOn: "2026-08-01",
  endsOn: "2027-06-01",
  requiredMinutesDefault: 1200,
};

describe("createVolunteerRequirementPeriod — date validation", () => {
  it("rejects end date on or before start date", async () => {
    const { createVolunteerRequirementPeriod } = await import("../periods");
    await expect(
      createVolunteerRequirementPeriod("org-1", { ...baseInput, startsOn: "2027-01-01", endsOn: "2026-01-01" }, actor)
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
      createVolunteerRequirementPeriod("org-1", { ...baseInput, volunteerDeadline: "2028-01-01" }, actor)
    ).rejects.toMatchObject({ code: "PTA_VOLUNTEER_PERIOD_INVALID_DATES" });
  });

  it("rejects a buyout window whose end precedes its start", async () => {
    const { createVolunteerRequirementPeriod } = await import("../periods");
    await expect(
      createVolunteerRequirementPeriod(
        "org-1",
        { ...baseInput, buyoutWindowStart: "2026-12-01", buyoutWindowEnd: "2026-09-01" },
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

  it("FC-6: rejects an unparseable date string rather than silently coercing it", async () => {
    const { createVolunteerRequirementPeriod } = await import("../periods");
    await expect(createVolunteerRequirementPeriod("org-1", { ...baseInput, startsOn: "not-a-date" }, actor)).rejects.toThrow();
  });
});

describe("RV-6: buyoutWindowEnd resolves to the START of the FOLLOWING day, not the typed day's own midnight", () => {
  it("stores buyoutWindowEnd shifted one day forward from what the admin typed", async () => {
    const { createVolunteerRequirementPeriod } = await import("../periods");
    await createVolunteerRequirementPeriod(
      "org-1",
      { ...baseInput, buyoutWindowStart: "2026-08-01", buyoutWindowEnd: "2026-09-30" },
      actor
    );
    const call = createPeriod.mock.calls[0][0] as { data: { buyoutWindowEnd: Date } };
    // "2026-09-30" in America/Chicago (findUniqueOrgSettings default in
    // beforeEach) shifts to the start of 2026-10-01 CDT (UTC-5).
    expect(call.data.buyoutWindowEnd.toISOString()).toBe("2026-10-01T05:00:00.000Z");
  });

  it("a buyoutWindowEnd equal to the period's own endsOn date validates successfully -- the entire last day of the period stays buyable", async () => {
    const { createVolunteerRequirementPeriod } = await import("../periods");
    await expect(
      createVolunteerRequirementPeriod("org-1", { ...baseInput, buyoutWindowEnd: baseInput.endsOn }, actor)
    ).resolves.toBeTruthy();
  });

  it("a buyoutWindowEnd one day past the period's endsOn is still rejected -- the widened range check has a real ceiling, not an accidental always-pass", async () => {
    const { createVolunteerRequirementPeriod } = await import("../periods");
    await expect(
      createVolunteerRequirementPeriod("org-1", { ...baseInput, buyoutWindowEnd: "2027-06-02" }, actor) // endsOn is "2027-06-01"
    ).rejects.toMatchObject({ code: "PTA_VOLUNTEER_PERIOD_INVALID_DATES" });
  });

  it("update: buyoutWindowEnd equal to the existing period's own endsOn date validates successfully", async () => {
    findFirstPeriod.mockResolvedValue({ id: "period-1", status: "ACTIVE", requiredMinutesDefault: 1200, timezone: "America/Chicago" });
    findManyPeriods.mockResolvedValue([]);
    updatePeriod.mockResolvedValue({ id: "period-1" });
    const { updateVolunteerRequirementPeriod } = await import("../periods");
    await expect(
      updateVolunteerRequirementPeriod("org-1", "period-1", { ...baseInput, buyoutWindowEnd: baseInput.endsOn }, actor)
    ).resolves.toBeTruthy();
  });

  it("a buyout window closing on the period's start date is still a same-day window and validates (start < shifted end)", async () => {
    const { createVolunteerRequirementPeriod } = await import("../periods");
    await expect(
      createVolunteerRequirementPeriod("org-1", { ...baseInput, buyoutWindowStart: "2026-09-01", buyoutWindowEnd: "2026-09-01" }, actor)
    ).resolves.toBeTruthy();
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

  it("FC-6: resolves the wall-clock startsOn/endsOn against the org's timezone, not raw UTC midnight", async () => {
    findUniqueOrgSettings.mockResolvedValue({ timezone: "America/New_York" });
    const { createVolunteerRequirementPeriod } = await import("../periods");
    await createVolunteerRequirementPeriod("org-1", baseInput, actor);
    const call = createPeriod.mock.calls[0][0] as { data: { startsOn: Date } };
    // "2026-08-01" midnight America/New_York (EDT, UTC-4) -> 2026-08-01T04:00:00.000Z,
    // NOT 2026-08-01T00:00:00.000Z (which is what naive UTC-midnight coercion would give,
    // and which is actually the evening of July 31 in New York).
    expect(call.data.startsOn.toISOString()).toBe("2026-08-01T04:00:00.000Z");
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
    findFirstPeriod.mockResolvedValue({ id: "period-1", status: "ACTIVE", requiredMinutesDefault: 1200, timezone: "America/Chicago" });
    findManyPeriods.mockResolvedValue([]);
    updatePeriod.mockResolvedValue({ id: "period-1", status: "ACTIVE" });
    const { updateVolunteerRequirementPeriod } = await import("../periods");
    await updateVolunteerRequirementPeriod("org-1", "period-1", { ...baseInput, status: "ACTIVE" }, actor);
    expect(findManyPeriods).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { not: "period-1" } }) }));
  });

  it("FC-6: resolves an update's wall-clock dates against the EXISTING period's own snapshotted timezone, never OrgSettings' current one", async () => {
    findFirstPeriod.mockResolvedValue({ id: "period-1", status: "ACTIVE", requiredMinutesDefault: 1200, timezone: "America/Los_Angeles" });
    findManyPeriods.mockResolvedValue([]);
    updatePeriod.mockResolvedValue({ id: "period-1", status: "ACTIVE" });
    const { updateVolunteerRequirementPeriod } = await import("../periods");
    await updateVolunteerRequirementPeriod("org-1", "period-1", baseInput, actor);
    // "2026-08-01" midnight America/Los_Angeles (PDT, UTC-7) -> 2026-08-01T07:00:00.000Z.
    // findUniqueOrgSettings (America/Chicago) must never be consulted for an update.
    const call = updatePeriod.mock.calls[0][0] as { data: { startsOn: Date } };
    expect(call.data.startsOn.toISOString()).toBe("2026-08-01T07:00:00.000Z");
    expect(findUniqueOrgSettings).not.toHaveBeenCalled();
  });

  it("FC-6: still runs the conflict check when status is omitted from a partial update on an already-ACTIVE period", async () => {
    findFirstPeriod.mockResolvedValue({ id: "period-1", status: "ACTIVE", requiredMinutesDefault: 1200, timezone: "America/Chicago" });
    findManyPeriods.mockResolvedValue([{ id: "other-active", name: "Other Active Period", startsOn: new Date("2026-01-01"), endsOn: new Date("2027-01-01") }]);
    const { updateVolunteerRequirementPeriod } = await import("../periods");
    const { status: _status, ...withoutStatus } = { ...baseInput, status: "ACTIVE" as const };
    void _status;
    await expect(updateVolunteerRequirementPeriod("org-1", "period-1", withoutStatus, actor)).rejects.toMatchObject({
      code: "PTA_VOLUNTEER_PERIOD_CONFLICT",
    });
  });
});

describe("RV-4: buyout policy fields — validation, defaults, and preserve-on-omit", () => {
  it("create: defaults to full-buyout-allowed=true, no min/max/service floor, and a 60-minute increment when nothing is provided", async () => {
    const { createVolunteerRequirementPeriod } = await import("../periods");
    await createVolunteerRequirementPeriod("org-1", baseInput, actor);
    expect(createPeriod).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          buyoutFullAllowed: true,
          buyoutMinPurchaseMinutes: null,
          buyoutMaxPurchaseMinutes: null,
          buyoutMinServiceMinutes: null,
          buyoutIncrementMinutes: 60,
        }),
      })
    );
  });

  it("create: persists explicitly-provided policy values, shown/entered in minutes", async () => {
    const { createVolunteerRequirementPeriod } = await import("../periods");
    await createVolunteerRequirementPeriod(
      "org-1",
      { ...baseInput, buyoutFullAllowed: false, buyoutMinPurchaseMinutes: 120, buyoutMaxPurchaseMinutes: 600, buyoutIncrementMinutes: 30 },
      actor
    );
    expect(createPeriod).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ buyoutFullAllowed: false, buyoutMinPurchaseMinutes: 120, buyoutMaxPurchaseMinutes: 600, buyoutIncrementMinutes: 30 }),
      })
    );
  });

  it("rejects a purchase increment that isn't 15, 30, or 60 minutes", async () => {
    const { createVolunteerRequirementPeriod } = await import("../periods");
    await expect(
      createVolunteerRequirementPeriod("org-1", { ...baseInput, buyoutIncrementMinutes: 45 }, actor)
    ).rejects.toMatchObject({ code: "PTA_VOLUNTEER_PERIOD_INVALID_BUYOUT_POLICY" });
  });

  it("rejects a negative min-purchase value", async () => {
    const { createVolunteerRequirementPeriod } = await import("../periods");
    await expect(
      createVolunteerRequirementPeriod("org-1", { ...baseInput, buyoutMinPurchaseMinutes: -60 }, actor)
    ).rejects.toMatchObject({ code: "PTA_VOLUNTEER_PERIOD_INVALID_BUYOUT_POLICY" });
  });

  it("rejects a min/max purchase that isn't an exact multiple of the configured increment", async () => {
    const { createVolunteerRequirementPeriod } = await import("../periods");
    await expect(
      createVolunteerRequirementPeriod("org-1", { ...baseInput, buyoutIncrementMinutes: 60, buyoutMinPurchaseMinutes: 90 }, actor)
    ).rejects.toMatchObject({ code: "PTA_VOLUNTEER_PERIOD_INVALID_BUYOUT_POLICY" });
  });

  it("rejects a minimum purchase greater than the maximum purchase", async () => {
    const { createVolunteerRequirementPeriod } = await import("../periods");
    await expect(
      createVolunteerRequirementPeriod("org-1", { ...baseInput, buyoutMinPurchaseMinutes: 600, buyoutMaxPurchaseMinutes: 300 }, actor)
    ).rejects.toMatchObject({ code: "PTA_VOLUNTEER_PERIOD_INVALID_BUYOUT_POLICY" });
  });

  it("rejects a maximum purchase beyond the period's default required hours minus its mandatory-service floor", async () => {
    const { createVolunteerRequirementPeriod } = await import("../periods");
    // requiredMinutesDefault is 1200 (20h) in baseInput; a 300min service floor
    // leaves 900min max buyable, so 960 must be rejected.
    await expect(
      createVolunteerRequirementPeriod(
        "org-1",
        { ...baseInput, buyoutMinServiceMinutes: 300, buyoutMaxPurchaseMinutes: 960 },
        actor
      )
    ).rejects.toMatchObject({ code: "PTA_VOLUNTEER_PERIOD_INVALID_BUYOUT_POLICY" });
  });

  it("rejects full-buyout-allowed=true together with a mandatory-service floor > 0 -- never silently coerced", async () => {
    const { createVolunteerRequirementPeriod } = await import("../periods");
    await expect(
      createVolunteerRequirementPeriod("org-1", { ...baseInput, buyoutFullAllowed: true, buyoutMinServiceMinutes: 300 }, actor)
    ).rejects.toMatchObject({ code: "PTA_VOLUNTEER_PERIOD_INVALID_BUYOUT_POLICY" });
  });

  it("allows full-buyout-allowed=false together with a mandatory-service floor", async () => {
    const { createVolunteerRequirementPeriod } = await import("../periods");
    await expect(
      createVolunteerRequirementPeriod("org-1", { ...baseInput, buyoutFullAllowed: false, buyoutMinServiceMinutes: 300 }, actor)
    ).resolves.toBeTruthy();
  });

  it("update: an omitted policy field preserves the period's existing stored value, never resetting to a default", async () => {
    findFirstPeriod.mockResolvedValue({
      id: "period-1",
      status: "ACTIVE",
      requiredMinutesDefault: 1200,
      timezone: "America/Chicago",
      buyoutFullAllowed: false,
      buyoutMinPurchaseMinutes: 120,
      buyoutMaxPurchaseMinutes: 900,
      buyoutMinServiceMinutes: 300,
      buyoutIncrementMinutes: 30,
    });
    updatePeriod.mockResolvedValue({ id: "period-1" });
    const { updateVolunteerRequirementPeriod } = await import("../periods");
    // baseInput carries none of the buyout policy fields -- an unrelated
    // edit (e.g. renaming the period) must not disturb any of them.
    await updateVolunteerRequirementPeriod("org-1", "period-1", { ...baseInput, name: "Renamed Period" }, actor);
    expect(updatePeriod).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          buyoutFullAllowed: false,
          buyoutMinPurchaseMinutes: 120,
          buyoutMaxPurchaseMinutes: 900,
          buyoutMinServiceMinutes: 300,
          buyoutIncrementMinutes: 30,
        }),
      })
    );
  });

  it("update: an explicit null clears a previously-set min/max/service-floor value, distinct from omitting the field", async () => {
    findFirstPeriod.mockResolvedValue({
      id: "period-1",
      status: "ACTIVE",
      requiredMinutesDefault: 1200,
      timezone: "America/Chicago",
      buyoutFullAllowed: false,
      buyoutMinPurchaseMinutes: 120,
      buyoutMaxPurchaseMinutes: 900,
      buyoutMinServiceMinutes: 300,
      buyoutIncrementMinutes: 60,
    });
    updatePeriod.mockResolvedValue({ id: "period-1" });
    const { updateVolunteerRequirementPeriod } = await import("../periods");
    await updateVolunteerRequirementPeriod(
      "org-1",
      "period-1",
      { ...baseInput, buyoutMinPurchaseMinutes: null, buyoutMaxPurchaseMinutes: null, buyoutMinServiceMinutes: null },
      actor
    );
    expect(updatePeriod).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ buyoutMinPurchaseMinutes: null, buyoutMaxPurchaseMinutes: null, buyoutMinServiceMinutes: null }),
      })
    );
  });

  it("update: still validates the fully-resolved policy (existing + incoming merged), not just the fields being changed", async () => {
    findFirstPeriod.mockResolvedValue({
      id: "period-1",
      status: "ACTIVE",
      requiredMinutesDefault: 1200,
      timezone: "America/Chicago",
      buyoutFullAllowed: false,
      buyoutMinPurchaseMinutes: 600,
      buyoutMaxPurchaseMinutes: 900,
      buyoutMinServiceMinutes: null,
      buyoutIncrementMinutes: 60,
    });
    const { updateVolunteerRequirementPeriod } = await import("../periods");
    // Only lowering the max is submitted -- but combined with the EXISTING
    // (unsubmitted, preserved) min of 600, min > max must still be caught.
    await expect(
      updateVolunteerRequirementPeriod("org-1", "period-1", { ...baseInput, buyoutMaxPurchaseMinutes: 300 }, actor)
    ).rejects.toMatchObject({ code: "PTA_VOLUNTEER_PERIOD_INVALID_BUYOUT_POLICY" });
  });
});
