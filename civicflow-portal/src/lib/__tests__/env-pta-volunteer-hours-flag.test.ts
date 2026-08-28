import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

describe("isPtaVolunteerHoursPlatformEnabled", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("is false when the env var is unset", async () => {
    delete process.env.PTA_VOLUNTEER_HOURS_PLATFORM_ENABLED;
    const { isPtaVolunteerHoursPlatformEnabled } = await import("@/lib/env");
    expect(isPtaVolunteerHoursPlatformEnabled()).toBe(false);
  });

  it("is true for '1'", async () => {
    process.env.PTA_VOLUNTEER_HOURS_PLATFORM_ENABLED = "1";
    const { isPtaVolunteerHoursPlatformEnabled } = await import("@/lib/env");
    expect(isPtaVolunteerHoursPlatformEnabled()).toBe(true);
  });

  it("is true for 'true'", async () => {
    process.env.PTA_VOLUNTEER_HOURS_PLATFORM_ENABLED = "true";
    const { isPtaVolunteerHoursPlatformEnabled } = await import("@/lib/env");
    expect(isPtaVolunteerHoursPlatformEnabled()).toBe(true);
  });

  it("is false for any other value — no partial-match / truthy-string leniency", async () => {
    process.env.PTA_VOLUNTEER_HOURS_PLATFORM_ENABLED = "yes";
    const { isPtaVolunteerHoursPlatformEnabled } = await import("@/lib/env");
    expect(isPtaVolunteerHoursPlatformEnabled()).toBe(false);
  });
});
