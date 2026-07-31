import { describe, expect, it } from "vitest";
import { getNavigationProfile, getLandingRoute } from "@/lib/vertical-navigation";

describe("getNavigationProfile", () => {
  it("gives PTA its own fully distinct nav — no Community-only labels leak through", () => {
    const nav = getNavigationProfile("PTA");
    const hrefs = nav.map((n) => n.href);
    expect(hrefs).toContain("/labs/pta/dashboard");
    expect(hrefs).toContain("/labs/pta/households");
    // Never the generic Community dashboard/members routes as primary items.
    expect(hrefs).not.toContain("/dashboard");
    expect(hrefs).not.toContain("/members");
    expect(nav.every((n) => n.label !== "Dashboard")).toBe(true);
  });

  it("Community, Union, and HOA share the same underlying routes (one platform, differentiated labels)", () => {
    const community = getNavigationProfile("COMMUNITY").map((n) => n.href).sort();
    const union = getNavigationProfile("UNION").map((n) => n.href).sort();
    const hoa = getNavigationProfile("HOA").map((n) => n.href).sort();
    expect(union).toEqual(community);
    expect(hoa).toEqual(community);
  });

  it("relabels the dashboard/dues/users items per vertical without changing the destination route", () => {
    const community = getNavigationProfile("COMMUNITY");
    const union = getNavigationProfile("UNION");
    const hoa = getNavigationProfile("HOA");

    expect(community.find((n) => n.href === "/dashboard")?.label).toBe("Dashboard");
    expect(union.find((n) => n.href === "/dashboard")?.label).toBe("Union Dashboard");
    expect(hoa.find((n) => n.href === "/dashboard")?.label).toBe("Community Dashboard");

    expect(union.find((n) => n.href === "/dues")?.label).toBe("Union Dues");
    expect(hoa.find((n) => n.href === "/dues")?.label).toBe("Assessments");

    expect(union.find((n) => n.href === "/settings/users")?.label).toBe("Officers");
    expect(hoa.find((n) => n.href === "/settings/users")?.label).toBe("Board");
  });

  it("never points at a route that doesn't exist for unsupported Union/HOA modules (no Documents item)", () => {
    const union = getNavigationProfile("UNION");
    const hoa = getNavigationProfile("HOA");
    expect(union.some((n) => /document/i.test(n.label))).toBe(false);
    expect(hoa.some((n) => /document/i.test(n.label))).toBe(false);
  });

  it("gates the same items with the same permissions across Community/Union/HOA", () => {
    const community = getNavigationProfile("COMMUNITY");
    const union = getNavigationProfile("UNION");
    const communityDues = community.find((n) => n.href === "/settings/dues");
    const unionDues = union.find((n) => n.href === "/settings/dues");
    expect(communityDues?.permission).toBe("dues:read");
    expect(unionDues?.permission).toBe("dues:read");
  });
});

describe("getLandingRoute", () => {
  it("sends PTA to its own Labs dashboard", () => {
    expect(getLandingRoute("PTA")).toBe("/labs/pta/dashboard");
  });

  it("sends every other vertical to the generic dashboard", () => {
    expect(getLandingRoute("COMMUNITY")).toBe("/dashboard");
    expect(getLandingRoute("UNION")).toBe("/dashboard");
    expect(getLandingRoute("HOA")).toBe("/dashboard");
  });
});
