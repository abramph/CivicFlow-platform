/**
 * Static-render assertions for the super-admin SMS Organizations table, using
 * react-dom/server (already a dependency) — the repo has no jsdom/RTL harness,
 * and the table's interactive logic is unit-tested separately in
 * sms-admin-enrollment.test.ts. Here we prove the context-aware control that
 * each org row *renders* in its initial state.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The rows call useRouter(); a static render just needs a stub.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
}));

import { SmsOrganizationsTable } from "@/components/admin/SmsOrganizationsTable";

type Row = Parameters<typeof SmsOrganizationsTable>[0]["organizations"][number];

function orgRow(overrides: Partial<Row>): Row {
  return {
    id: "org-1",
    name: "Test Org",
    billingExempt: false,
    smsAddOnActive: false,
    plan: "STARTER",
    planPriceCents: 1000,
    smsMonthlyLimit: 1000,
    smsUsedThisPeriod: 0,
    smsOverageRateCents: 2,
    suspendedAt: null,
    ...overrides,
  };
}

function render(rows: Row[]): string {
  return renderToStaticMarkup(createElement(SmsOrganizationsTable, { organizations: rows }));
}

describe("SmsOrganizationsTable render", () => {
  // (Req 9) a non-exempt (paid) org gets no super-admin Enable/Disable control.
  it("non-exempt org shows 'Managed through organization billing' and no Enable/Disable control", () => {
    const markup = render([orgRow({ billingExempt: false, smsAddOnActive: false })]);
    expect(markup).toContain("Managed through organization billing");
    expect(markup).not.toContain(">Enable</button>");
    expect(markup).not.toContain(">Disable</button>");
  });

  it("non-exempt org that is somehow active still shows no Disable control", () => {
    const markup = render([orgRow({ billingExempt: false, smsAddOnActive: true })]);
    expect(markup).toContain("Managed through organization billing");
    expect(markup).not.toContain(">Disable</button>");
  });

  // (Req 1) an inactive billing-exempt org offers an Enable control (which opens the form).
  it("billing-exempt inactive org offers an Enable control", () => {
    const markup = render([orgRow({ billingExempt: true, smsAddOnActive: false })]);
    expect(markup).toContain(">Enable</button>");
    expect(markup).not.toContain("Managed through organization billing");
  });

  // (Req 11) the existing exempt enrollment (Unestra Demo Community: 1/1,000 used) renders Enabled.
  it("billing-exempt active org renders usage 1 / 1000 and a Disable control", () => {
    const markup = render([
      orgRow({ name: "Unestra Demo Community", billingExempt: true, smsAddOnActive: true, smsUsedThisPeriod: 1, smsMonthlyLimit: 1000 }),
    ]);
    expect(markup).toContain("1 / 1000");
    expect(markup).toContain(">Disable</button>");
  });

  // (Req 10) no Stripe identifier — and not even the word "stripe" — appears in the rendered UI.
  it("never renders a Stripe identifier for any org type", () => {
    const markup = render([
      orgRow({ id: "a", name: "Paid Org", billingExempt: false, smsAddOnActive: true }),
      orgRow({ id: "b", name: "Exempt Off", billingExempt: true, smsAddOnActive: false }),
      orgRow({ id: "c", name: "Exempt On", billingExempt: true, smsAddOnActive: true }),
    ]);
    expect(markup).not.toMatch(/\b(sub|si|price|cus|in|prod)_[A-Za-z0-9]+/);
    expect(markup.toLowerCase()).not.toContain("stripe");
  });
});
