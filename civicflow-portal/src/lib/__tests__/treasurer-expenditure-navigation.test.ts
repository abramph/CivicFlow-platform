import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * feature/pta-treasurer-expenditure-experience (E1) — the investigation
 * that preceded this feature found the expenditure ledger was invisible to
 * PTA Treasurers purely because of a missing navigation entry, not RBAC.
 * The fix adds nested Treasurer routes gated on the CORRECT, specific
 * permission (expenditures:read/write) rather than the page's previous
 * catch-all (budget:read). These tests exist to make that specific,
 * previously-absent gate a regression-proof fact: every Expenditures
 * sub-route must request exactly "expenditures:read" or
 * "expenditures:write" from getPtaPageGate, and must fetch zero data when
 * access is denied.
 *
 * No component-rendering library (e.g. @testing-library/react) exists
 * anywhere in this codebase's test suite (verified: zero *.test.tsx files,
 * no such dependency in package.json) -- introducing one would be a new
 * testing-infrastructure decision out of scope for this feature. These
 * tests instead call the page's async server-component function directly
 * (the same pattern this codebase already uses for API route handlers,
 * e.g. expenditures-routes.test.ts) and assert on its permission requests
 * and data-fetch behavior, not on rendered DOM. Real browser rendering,
 * active-tab styling, keyboard navigation, and responsive layout were
 * additionally verified against the local dev server (see the final
 * report's "Local dev-server verification" section).
 */

const getPtaPageGate = vi.fn();
vi.mock("@/lib/labs/pta/guard", () => ({ getPtaPageGate: (...a: unknown[]) => getPtaPageGate(...a) }));

const findManyCategory = vi.fn().mockResolvedValue([]);
const findManyPaymentMethod = vi.fn().mockResolvedValue([]);
const findManyCommittee = vi.fn().mockResolvedValue([]);
const findFirstExpenditure = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/prisma", () => ({
  prisma: {
    category: { findMany: (...a: unknown[]) => findManyCategory(...a) },
    paymentMethodConfig: { findMany: (...a: unknown[]) => findManyPaymentMethod(...a) },
    ptaCommittee: { findMany: (...a: unknown[]) => findManyCommittee(...a) },
    expenditure: { findFirst: (...a: unknown[]) => findFirstExpenditure(...a) },
  },
}));

const listExpenditures = vi.fn().mockResolvedValue([]);
vi.mock("@/lib/expenditures", async () => {
  const actual = await vi.importActual<typeof import("@/lib/expenditures")>("@/lib/expenditures");
  return { ...actual, listExpenditures: (...a: unknown[]) => listExpenditures(...a) };
});

const getExpenditureFormOptions = vi.fn().mockResolvedValue({ categories: [], paymentMethods: [], campaigns: [], events: [], committees: [] });
vi.mock("@/lib/expenditure-options", () => ({ getExpenditureFormOptions: (...a: unknown[]) => getExpenditureFormOptions(...a) }));

const getFinancialEditPolicy = vi.fn().mockResolvedValue({ editWindowHours: 24, requireReasonForFinancialEdits: false, allowFinanceCorrections: true, lockReceiptsAfterIssue: false });
vi.mock("@/lib/financial-edit-policy", async () => {
  const actual = await vi.importActual<typeof import("@/lib/financial-edit-policy")>("@/lib/financial-edit-policy");
  return { ...actual, getFinancialEditPolicy: (...a: unknown[]) => getFinancialEditPolicy(...a) };
});

vi.mock("next/navigation", () => ({ usePathname: () => "/labs/pta/finance/overview" }));

import TreasurerExpendituresPage from "@/app/labs/pta/finance/expenditures/page";
import TreasurerNewExpenditurePage from "@/app/labs/pta/finance/expenditures/new/page";
import TreasurerExpenditureDetailPage from "@/app/labs/pta/finance/expenditures/[id]/page";
import TreasurerEditExpenditurePage from "@/app/labs/pta/finance/expenditures/[id]/edit/page";
import { TREASURER_TABS, TreasurerTabs } from "@/components/labs/pta/TreasurerTabs";
import type { ReactElement } from "react";

const denied = { organizationId: "org-1", session: { userId: "u-1" }, role: "STAFF", can: () => false, access: { available: false } };
const granted = { organizationId: "org-1", session: { userId: "u-1" }, role: "FINANCE", can: () => true, access: { available: true } };

beforeEach(() => {
  vi.clearAllMocks();
  getPtaPageGate.mockResolvedValue(granted);
});

describe("TreasurerExpendituresPage (list)", () => {
  it("requests expenditures:read, not budget:read", async () => {
    await TreasurerExpendituresPage({ searchParams: Promise.resolve({}) });
    expect(getPtaPageGate).toHaveBeenCalledWith("expenditures:read");
  });

  it("fetches zero ledger data and renders nothing when access is denied", async () => {
    getPtaPageGate.mockResolvedValueOnce(denied);
    const result = await TreasurerExpendituresPage({ searchParams: Promise.resolve({}) });
    expect(result).toBeNull();
    expect(listExpenditures).not.toHaveBeenCalled();
    expect(findManyCategory).not.toHaveBeenCalled();
  });

  it("scopes the ledger query to the gated organizationId", async () => {
    await TreasurerExpendituresPage({ searchParams: Promise.resolve({}) });
    expect(listExpenditures).toHaveBeenCalledWith("org-1", expect.anything());
  });
});

describe("TreasurerNewExpenditurePage", () => {
  it("requests expenditures:write, not budget:read", async () => {
    await TreasurerNewExpenditurePage();
    expect(getPtaPageGate).toHaveBeenCalledWith("expenditures:write");
  });

  it("fetches zero form options when access is denied", async () => {
    getPtaPageGate.mockResolvedValueOnce(denied);
    const result = await TreasurerNewExpenditurePage();
    expect(result).toBeNull();
    expect(getExpenditureFormOptions).not.toHaveBeenCalled();
  });
});

describe("TreasurerExpenditureDetailPage", () => {
  it("requests expenditures:read, not budget:read", async () => {
    await TreasurerExpenditureDetailPage({ params: Promise.resolve({ id: "exp-1" }) });
    expect(getPtaPageGate).toHaveBeenCalledWith("expenditures:read");
  });

  it("fetches zero expenditure data when access is denied -- proves an unauthorized caller can never receive ledger data", async () => {
    getPtaPageGate.mockResolvedValueOnce(denied);
    const result = await TreasurerExpenditureDetailPage({ params: Promise.resolve({ id: "exp-1" }) });
    expect(result).toBeNull();
    expect(findFirstExpenditure).not.toHaveBeenCalled();
  });

  it("scopes the detail lookup to the gated organizationId, not just the URL id", async () => {
    await TreasurerExpenditureDetailPage({ params: Promise.resolve({ id: "exp-1" }) });
    expect(findFirstExpenditure.mock.calls[0][0].where).toMatchObject({ id: "exp-1", organizationId: "org-1" });
  });
});

describe("TreasurerEditExpenditurePage", () => {
  it("requests expenditures:write, not budget:read", async () => {
    await TreasurerEditExpenditurePage({ params: Promise.resolve({ id: "exp-1" }) });
    expect(getPtaPageGate).toHaveBeenCalledWith("expenditures:write");
  });

  it("fetches zero data when access is denied", async () => {
    getPtaPageGate.mockResolvedValueOnce(denied);
    const result = await TreasurerEditExpenditurePage({ params: Promise.resolve({ id: "exp-1" }) });
    expect(result).toBeNull();
    expect(findFirstExpenditure).not.toHaveBeenCalled();
    expect(getExpenditureFormOptions).not.toHaveBeenCalled();
  });
});

describe("TREASURER_TABS", () => {
  it("is exactly the four required internal sections, in order", () => {
    expect(TREASURER_TABS.map((t) => t.label)).toEqual(["Overview", "Budget", "Expenditures", "Reimbursements"]);
    expect(TREASURER_TABS.map((t) => t.href)).toEqual([
      "/labs/pta/finance/overview",
      "/labs/pta/finance/budget",
      "/labs/pta/finance/expenditures",
      "/labs/pta/finance/reimbursements",
    ]);
  });

  it("every tab is nested under the single top-level Treasurer route", () => {
    for (const tab of TREASURER_TABS) {
      expect(tab.href.startsWith("/labs/pta/finance/")).toBe(true);
    }
  });
});

/**
 * Real defect found in local browser verification: TreasurerLayout only
 * gates on budget:read (deliberately, so STAFF/READ_ONLY viewers who lack
 * expenditures:read can still reach Overview/Budget/Reimbursements), but
 * TreasurerTabs rendered all four tabs unconditionally -- so a STAFF viewer
 * (budget:read + reimbursements:submit, but no expenditures:read) saw a
 * clickable "Expenditures" tab that dead-ended at /dashboard?error=forbidden
 * the moment they clicked it. Fixed by threading the real
 * expenditures:read check down as canReadExpenditures. These tests call the
 * component function directly (same no-DOM-renderer approach as the rest of
 * this file) and inspect the returned element tree's tab hrefs/labels.
 */
describe("TreasurerTabs (canReadExpenditures gating)", () => {
  function renderedHrefs(element: ReactElement): string[] {
    const children = (element.props as { children: ReactElement | ReactElement[] }).children;
    const list = Array.isArray(children) ? children : [children];
    return list.map((child) => (child.props as { href: string }).href);
  }

  it("shows all four tabs when the viewer can read expenditures", () => {
    const element = TreasurerTabs({ canReadExpenditures: true }) as ReactElement;
    expect(renderedHrefs(element)).toEqual(TREASURER_TABS.map((t) => t.href));
  });

  it("omits Expenditures -- and only Expenditures -- when the viewer cannot read expenditures", () => {
    const element = TreasurerTabs({ canReadExpenditures: false }) as ReactElement;
    const hrefs = renderedHrefs(element);
    expect(hrefs).not.toContain("/labs/pta/finance/expenditures");
    expect(hrefs).toEqual(["/labs/pta/finance/overview", "/labs/pta/finance/budget", "/labs/pta/finance/reimbursements"]);
  });

  it("defaults to showing Expenditures when the prop is omitted", () => {
    const element = TreasurerTabs({}) as ReactElement;
    expect(renderedHrefs(element)).toContain("/labs/pta/finance/expenditures");
  });
});
