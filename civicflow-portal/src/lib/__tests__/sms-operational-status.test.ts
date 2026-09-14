import { describe, expect, it } from "vitest";

import { evaluateSmsPlatformStatus } from "@/lib/sms-operational-status";

const CONFIGURED = { fromNumber: "+15551234567", messagingServiceSid: null };
const UP = { platformEnabled: true, maintenanceMode: false, outboundPaused: false, testMode: false };

describe("evaluateSmsPlatformStatus", () => {
  it("is available when configured and all switches are on", () => {
    expect(evaluateSmsPlatformStatus(UP, CONFIGURED)).toEqual({ configured: true, available: true, testMode: false });
  });

  it("NOT_CONFIGURED when there are no credentials / no sender", () => {
    expect(evaluateSmsPlatformStatus(UP, null)).toMatchObject({ configured: false, available: false, unavailableCode: "NOT_CONFIGURED" });
    expect(evaluateSmsPlatformStatus(UP, { fromNumber: null, messagingServiceSid: null })).toMatchObject({
      available: false,
      unavailableCode: "NOT_CONFIGURED",
    });
  });

  it("accepts a messaging service SID as a valid sender", () => {
    expect(evaluateSmsPlatformStatus(UP, { fromNumber: null, messagingServiceSid: "MG123" })).toMatchObject({ available: true });
  });

  it("blocks PLATFORM_DISABLED / MAINTENANCE / OUTBOUND_PAUSED in that precedence", () => {
    expect(evaluateSmsPlatformStatus({ ...UP, platformEnabled: false }, CONFIGURED)).toMatchObject({ unavailableCode: "PLATFORM_DISABLED" });
    expect(evaluateSmsPlatformStatus({ ...UP, maintenanceMode: true }, CONFIGURED)).toMatchObject({ unavailableCode: "MAINTENANCE" });
    expect(evaluateSmsPlatformStatus({ ...UP, outboundPaused: true }, CONFIGURED)).toMatchObject({ unavailableCode: "OUTBOUND_PAUSED" });
  });

  it("reason strings match the sendSms() wording (single source of truth)", () => {
    expect(evaluateSmsPlatformStatus(UP, null).reason).toBe("SMS delivery is not configured");
    expect(evaluateSmsPlatformStatus({ ...UP, platformEnabled: false }, CONFIGURED).reason).toBe("SMS platform is currently disabled");
    expect(evaluateSmsPlatformStatus({ ...UP, maintenanceMode: true }, CONFIGURED).reason).toBe("SMS is in maintenance mode");
    expect(evaluateSmsPlatformStatus({ ...UP, outboundPaused: true }, CONFIGURED).reason).toBe("Outbound SMS is currently paused");
  });

  it("carries testMode (Safe Launch) as a restricted flag even when otherwise available", () => {
    expect(evaluateSmsPlatformStatus({ ...UP, testMode: true }, CONFIGURED)).toEqual({ configured: true, available: true, testMode: true });
  });
});
