import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

// Capture what the platform sender hands to the transport, but keep the REAL
// buildPushData (which runs the REAL validateDeepLink, since @/lib/deep-links is
// not mocked here) so this proves the route survives payload construction.
const capturedSend = vi.fn().mockResolvedValue({ sent: 1, failed: 0 });
vi.mock("@/lib/push", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/push")>();
  return { ...actual, sendPushToTokens: (...args: unknown[]) => capturedSend(...args) };
});

import { PLATFORM_DEEP_LINK_ALLOWLIST, sendPlatformTokensPush } from "@/lib/notifications/send";
import { buildPushData } from "@/lib/push";
import { validateDeepLink } from "@/lib/deep-links";

describe("platform deep-link contract (server)", () => {
  beforeEach(() => capturedSend.mockClear());

  it("the allow-list is the smallest truthful contract (only /inbox today)", () => {
    expect([...PLATFORM_DEEP_LINK_ALLOWLIST]).toEqual(["/inbox"]);
  });

  // Table-driven: every advertised platform route must survive all three gates.
  it.each([...PLATFORM_DEEP_LINK_ALLOWLIST])("route %s survives sendPlatformTokensPush + buildPushData + validateDeepLink", async (route) => {
    // 1. sendPlatformTokensPush approves it and stamps the server-authored scope.
    await sendPlatformTokensPush({ tokens: ["ExponentPushToken[x]"], body: "System notice.", deepLink: route });
    const input = capturedSend.mock.calls[0][1] as { deepLink: string | null; notificationScope?: string };
    expect(input.deepLink).toBe(route);
    expect(input.notificationScope).toBe("platform");

    // 2. buildPushData keeps it (and the scope) — it is not nullified downstream.
    const data = buildPushData({ title: "Unestra", body: "b", deepLink: route, notificationScope: "platform" });
    expect(data.deepLink).toBe(route);
    expect(data.notificationScope).toBe("platform");

    // 3. the portal deep-link validator accepts it end-to-end.
    expect(validateDeepLink(route)).toBe(route);
  });

  it("an unapproved route fails closed at every gate (never trusted)", async () => {
    await sendPlatformTokensPush({ tokens: ["ExponentPushToken[x]"], body: "b", deepLink: "/settings/billing" });
    const input = capturedSend.mock.calls[0][1] as { deepLink: string | null; notificationScope?: string };
    // sendPlatformTokensPush drops it to null (not on the allow-list)…
    expect(input.deepLink).toBeNull();
    // …the scope protection is still stamped…
    expect(input.notificationScope).toBe("platform");
    // …and the portal validator would reject it anyway.
    expect(validateDeepLink("/settings/billing")).toBeNull();
    expect(validateDeepLink("/settings/security")).toBeNull();
  });
});
