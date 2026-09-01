import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { ExpenditureLedgerTable, type ExpenditureRow } from "@/components/expenditures/ExpenditureLedgerTable";

/**
 * Real defect found in local browser verification: the ledger list pages
 * already computed showCommitteeColumn={committees.length > 0} (same check
 * the filter form uses to hide its own Committee dropdown for non-PTA
 * orgs), but ExpenditureLedgerTable always rendered a "Committee" header
 * and cell regardless -- a wall of "-" for every non-PTA organization. No
 * component-rendering library exists in this codebase (see
 * treasurer-expenditure-navigation.test.ts's comment on the same point), so
 * this calls the component function directly and inspects the returned
 * element tree, the same no-DOM-renderer approach used there.
 */

function row(overrides: Partial<ExpenditureRow> = {}): ExpenditureRow {
  return {
    id: "exp-1",
    date: new Date("2026-09-01"),
    vendor: "Fictional Vendor",
    description: "Test expenditure",
    amount: "10.00",
    category: null,
    categoryRef: null,
    receiptUrl: null,
    voidedAt: null,
    committee: null,
    committeeNameAtPosting: null,
    reimbursement: null,
    ...overrides,
  };
}

function headerCells(table: ReactElement): string[] {
  const tableEl = (table.props as { children: ReactElement }).children;
  const [thead] = ((tableEl.props as { children: ReactElement[] }).children as ReactElement[]);
  const tr = (thead.props as { children: ReactElement }).children;
  const ths = (tr.props as { children: ReactElement[] }).children;
  return ths.flat().filter(Boolean).map((th) => (th.props as { children: string }).children);
}

describe("ExpenditureLedgerTable showCommitteeColumn gating", () => {
  it("renders a Committee header when showCommitteeColumn is true", () => {
    const element = ExpenditureLedgerTable({ rows: [row()], basePath: "/expenditures", showCommitteeColumn: true }) as ReactElement;
    expect(headerCells(element)).toContain("Committee");
  });

  it("omits the Committee header when showCommitteeColumn is false", () => {
    const element = ExpenditureLedgerTable({ rows: [row()], basePath: "/expenditures", showCommitteeColumn: false }) as ReactElement;
    expect(headerCells(element)).not.toContain("Committee");
  });

  it("omits the Committee header when showCommitteeColumn is not passed at all", () => {
    const element = ExpenditureLedgerTable({ rows: [row()], basePath: "/expenditures" }) as ReactElement;
    expect(headerCells(element)).not.toContain("Committee");
  });
});
