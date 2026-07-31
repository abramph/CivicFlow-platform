import { describe, expect, it } from "vitest";
import { setupBannerDismissCookieName } from "@/lib/dashboard-setup";

describe("setupBannerDismissCookieName", () => {
  it("scopes the cookie name to the organization id, so dismissing one org never hides the banner for another", () => {
    expect(setupBannerDismissCookieName("org-a")).toBe("cf_setup_dismissed_org-a");
    expect(setupBannerDismissCookieName("org-b")).toBe("cf_setup_dismissed_org-b");
    expect(setupBannerDismissCookieName("org-a")).not.toBe(setupBannerDismissCookieName("org-b"));
  });
});
