import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Guards the domain-migration cutover mechanism: every customer-facing link
 * builder derives its base from getMobileAppWebBaseUrl(), which must resolve to
 * the new canonical domain once the environment points there — so flipping
 * NEXTAUTH_URL (or MOBILE_APP_WEB_BASE_URL) is all it takes to stop minting
 * app.civicflowapp.com links.
 */
describe("getMobileAppWebBaseUrl (domain-migration cutover)", () => {
  const OLD = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...OLD, NODE_ENV: "test" } as NodeJS.ProcessEnv;
  });
  afterEach(() => {
    process.env = OLD;
  });

  async function load() {
    return import("@/lib/env");
  }

  it("uses NEXTAUTH_URL when no explicit member base is set", async () => {
    process.env.NEXTAUTH_URL = "https://app.getunestra.com";
    delete process.env.MOBILE_APP_WEB_BASE_URL;
    const { getMobileAppWebBaseUrl } = await load();
    expect(getMobileAppWebBaseUrl()).toBe("https://app.getunestra.com");
  });

  it("prefers MOBILE_APP_WEB_BASE_URL over NEXTAUTH_URL", async () => {
    process.env.NEXTAUTH_URL = "https://app.civicflowapp.com";
    process.env.MOBILE_APP_WEB_BASE_URL = "https://app.getunestra.com";
    const { getMobileAppWebBaseUrl } = await load();
    expect(getMobileAppWebBaseUrl()).toBe("https://app.getunestra.com");
  });

  it("strips a trailing slash so link concatenation stays well-formed", async () => {
    process.env.NEXTAUTH_URL = "https://app.getunestra.com/";
    delete process.env.MOBILE_APP_WEB_BASE_URL;
    const { getMobileAppWebBaseUrl } = await load();
    expect(getMobileAppWebBaseUrl()).toBe("https://app.getunestra.com");
    const { getMobileAppWebBaseUrl: again } = await load();
    expect(`${again()}/accept-invite`).toBe("https://app.getunestra.com/accept-invite");
  });
});
