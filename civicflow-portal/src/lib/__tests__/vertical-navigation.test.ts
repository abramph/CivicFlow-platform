import { describe, expect, it } from "vitest";
import { getNavigationProfile, getLandingRoute, getOnboardingRoute } from "@/lib/vertical-navigation";

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

  it("Union shares Community's routes plus one addition: /union/cases (Union Case Center, UNION-CASE-B)", () => {
    const community = getNavigationProfile("COMMUNITY").map((n) => n.href).sort();
    const union = getNavigationProfile("UNION").map((n) => n.href).sort();
    expect(union).toEqual([...community, "/union/cases"].sort());

    const caseCenterItem = getNavigationProfile("UNION").find((n) => n.href === "/union/cases");
    expect(caseCenterItem?.label).toBe("Case Center");
    expect(caseCenterItem?.permission).toBe("union:cases:read");
  });

  // UNION-WEB-DASH: Union's primary areas (membership, case center,
  // activity/communications) must come before financial administration in
  // the nav -- most Union members pay dues via employer payroll checkoff,
  // not Unestra. Community keeps its existing order (finance cluster
  // first) unchanged -- same item set, just a different relative order.
  it("orders Union's nav with Events/Communications before the dues/finance cluster, unlike Community", () => {
    const union = getNavigationProfile("UNION").map((n) => n.href);
    const unionEventsIndex = union.indexOf("/events");
    const unionDuesIndex = union.indexOf("/dues");
    expect(unionEventsIndex).toBeGreaterThan(-1);
    expect(unionDuesIndex).toBeGreaterThan(-1);
    expect(unionEventsIndex).toBeLessThan(unionDuesIndex);

    const community = getNavigationProfile("COMMUNITY").map((n) => n.href);
    const communityEventsIndex = community.indexOf("/events");
    const communityDuesIndex = community.indexOf("/dues");
    expect(communityEventsIndex).toBeGreaterThan(communityDuesIndex);
  });

  it("HOA shares Community's routes plus three additions: /hoa/properties (PR #43), /hoa/violations (HOA Violations MVP), and /hoa/architectural-requests", () => {
    const community = getNavigationProfile("COMMUNITY").map((n) => n.href).sort();
    const hoa = getNavigationProfile("HOA").map((n) => n.href).sort();
    expect(hoa).toEqual([...community, "/hoa/properties", "/hoa/violations", "/hoa/architectural-requests"].sort());

    const propertiesItem = getNavigationProfile("HOA").find((n) => n.href === "/hoa/properties");
    expect(propertiesItem?.label).toBe("Properties");
    expect(propertiesItem?.permission).toBe("hoa:properties:read");

    const violationsItem = getNavigationProfile("HOA").find((n) => n.href === "/hoa/violations");
    expect(violationsItem?.label).toBe("Violations");
    expect(violationsItem?.permission).toBe("hoa:violations:read");

    const architecturalRequestsItem = getNavigationProfile("HOA").find((n) => n.href === "/hoa/architectural-requests");
    expect(architecturalRequestsItem?.label).toBe("Architectural Requests");
    expect(architecturalRequestsItem?.permission).toBe("hoa:architectural-requests:read");
  });

  it("does not add /hoa/properties, /hoa/violations, or /hoa/architectural-requests for Community or Union -- their roles technically hold the hoa:* permissions (permissions aren't vertical-scoped) but the nav item must not create a dead-end link for a non-HOA org", () => {
    expect(getNavigationProfile("COMMUNITY").some((n) => n.href === "/hoa/properties")).toBe(false);
    expect(getNavigationProfile("UNION").some((n) => n.href === "/hoa/properties")).toBe(false);
    expect(getNavigationProfile("COMMUNITY").some((n) => n.href === "/hoa/violations")).toBe(false);
    expect(getNavigationProfile("UNION").some((n) => n.href === "/hoa/violations")).toBe(false);
    expect(getNavigationProfile("COMMUNITY").some((n) => n.href === "/hoa/architectural-requests")).toBe(false);
    expect(getNavigationProfile("UNION").some((n) => n.href === "/hoa/architectural-requests")).toBe(false);
  });

  it("does not add /union/cases for Community or HOA -- same dead-end-link reasoning as the HOA items above", () => {
    expect(getNavigationProfile("COMMUNITY").some((n) => n.href === "/union/cases")).toBe(false);
    expect(getNavigationProfile("HOA").some((n) => n.href === "/union/cases")).toBe(false);
  });

  it("relabels the dashboard/dues/users items per vertical without changing the destination route", () => {
    const community = getNavigationProfile("COMMUNITY");
    const union = getNavigationProfile("UNION");
    const hoa = getNavigationProfile("HOA");

    expect(community.find((n) => n.href === "/dashboard")?.label).toBe("Dashboard");
    expect(union.find((n) => n.href === "/dashboard")?.label).toBe("Union Dashboard");
    expect(hoa.find((n) => n.href === "/dashboard")?.label).toBe("HOA Dashboard");

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

  // CHURCH-VERT-B: church does not collect dues -- giving is voluntary, not
  // a fixed obligation, so the dues-specific nav items would only ever
  // dead-end for a Church org (same reasoning as the HOA/Union additions
  // above, just in reverse: an omission instead of an addition).
  it("Church shares Community's routes minus the three dues-specific items (/dues, /dues/reminders, /settings/dues)", () => {
    const community = getNavigationProfile("COMMUNITY").map((n) => n.href).sort();
    const church = getNavigationProfile("CHURCH").map((n) => n.href).sort();
    const duesOnlyRoutes = ["/dues", "/dues/reminders", "/settings/dues"];
    expect(church).toEqual(community.filter((href) => !duesOnlyRoutes.includes(href)).sort());
  });

  it("never points a Church org at a dues-specific nav item", () => {
    const church = getNavigationProfile("CHURCH");
    expect(church.some((n) => n.href === "/dues")).toBe(false);
    expect(church.some((n) => n.href === "/dues/reminders")).toBe(false);
    expect(church.some((n) => n.href === "/settings/dues")).toBe(false);
  });

  it("still gives Church its own dashboard label and the shared Giving Setup item", () => {
    const church = getNavigationProfile("CHURCH");
    expect(church.find((n) => n.href === "/dashboard")?.label).toBe("Church Dashboard");
    expect(church.find((n) => n.href === "/settings/giving")?.label).toBe("Giving Setup");
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
    expect(getLandingRoute("CHURCH")).toBe("/dashboard");
  });
});

describe("getOnboardingRoute", () => {
  it("sends a brand-new PTA organization to its own rich Labs checklist", () => {
    expect(getOnboardingRoute("PTA")).toBe("/labs/pta/onboarding");
  });

  it("sends Community, Union, HOA, and Church to the shared generic onboarding checklist", () => {
    expect(getOnboardingRoute("COMMUNITY")).toBe("/onboarding/checklist");
    expect(getOnboardingRoute("UNION")).toBe("/onboarding/checklist");
    expect(getOnboardingRoute("HOA")).toBe("/onboarding/checklist");
    expect(getOnboardingRoute("CHURCH")).toBe("/onboarding/checklist");
  });
});
