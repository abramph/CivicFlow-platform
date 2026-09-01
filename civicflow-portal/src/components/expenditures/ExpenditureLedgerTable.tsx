import Link from "next/link";
import { formatCurrency, formatDate, formatText } from "@/lib/formatting";
import { describeCommitteeAttribution } from "@/lib/expenditures";

type Option = { id: string; label: string };

export interface ExpenditureRow {
  id: string;
  date: Date;
  vendor: string | null;
  description: string;
  amount: unknown;
  category: string | null;
  categoryRef: { name: string } | null;
  receiptUrl: string | null;
  voidedAt: Date | null;
  committee: { id: string; name: string } | null;
  committeeNameAtPosting: string | null;
  reimbursement: { id: string; payeeName: string } | null;
}

export interface ExpenditureFilterValues {
  dateFrom?: string;
  dateTo?: string;
  categoryId?: string;
  paymentMethodId?: string;
  committeeId?: string;
  status?: string;
  vendor?: string;
  origin?: string;
}

const selectClassName = "block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";

/** Plain GET form -- every filter is a query-string parameter, so the
 * resulting URL is refresh-safe, back/forward-safe, and shareable without
 * any client-side state or JavaScript required to reproduce a given view. */
export function ExpenditureFilterForm({
  basePath,
  categories,
  paymentMethods,
  committees,
  current,
}: {
  basePath: string;
  categories: Option[];
  paymentMethods: Option[];
  committees: Option[];
  current: ExpenditureFilterValues;
}) {
  return (
    <form method="get" action={basePath} className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-4">
      <label className="space-y-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
        <span>From</span>
        <input type="date" name="dateFrom" defaultValue={current.dateFrom ?? ""} className={selectClassName} />
      </label>
      <label className="space-y-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
        <span>To</span>
        <input type="date" name="dateTo" defaultValue={current.dateTo ?? ""} className={selectClassName} />
      </label>
      <label className="space-y-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
        <span>Vendor / payee</span>
        <input type="text" name="vendor" defaultValue={current.vendor ?? ""} placeholder="Search vendor" className={selectClassName} />
      </label>
      <label className="space-y-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
        <span>Category</span>
        <select name="categoryId" defaultValue={current.categoryId ?? ""} className={selectClassName}>
          <option value="">Any category</option>
          {categories.map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
        <span>Payment method</span>
        <select name="paymentMethodId" defaultValue={current.paymentMethodId ?? ""} className={selectClassName}>
          <option value="">Any method</option>
          {paymentMethods.map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
        <span>Status</span>
        <select name="status" defaultValue={current.status ?? ""} className={selectClassName}>
          <option value="">Active + voided</option>
          <option value="ACTIVE">Active only</option>
          <option value="VOIDED">Voided only</option>
        </select>
      </label>
      <label className="space-y-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
        <span>Origin</span>
        <select name="origin" defaultValue={current.origin ?? ""} className={selectClassName}>
          <option value="">Direct + reimbursement</option>
          <option value="DIRECT">Direct entry only</option>
          <option value="REIMBURSEMENT">From reimbursement only</option>
        </select>
      </label>
      {committees.length > 0 ? (
        <label className="space-y-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
          <span>Committee</span>
          <select name="committeeId" defaultValue={current.committeeId ?? ""} className={selectClassName}>
            <option value="">Any committee</option>
            {committees.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
        <button type="submit" className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">Apply filters</button>
        <Link href={basePath} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50">Clear filters</Link>
      </div>
    </form>
  );
}

/** Shared ledger table, rendered by both the generic /expenditures list and
 * the PTA Treasurer's nested /labs/pta/finance/expenditures list -- one
 * implementation, two mount points, so there is exactly one place that
 * decides how a row is displayed. reimbursementsBasePath is only passed by
 * the PTA context, where a safe, organization-scoped reimbursements view
 * exists to link into; the generic route omits it, so reimbursement-origin
 * rows still show their badge but without a dead-end link. */
export function ExpenditureLedgerTable({
  rows,
  basePath,
  reimbursementsBasePath,
  showCommitteeColumn,
}: {
  rows: ExpenditureRow[];
  basePath: string;
  reimbursementsBasePath?: string;
  /** feature/pta-treasurer-expenditure-experience -- PTA-only, same as the
   * Committee field on ExpenditureForm and the Committee filter on
   * ExpenditureFilterForm: a non-PTA organization never has any
   * PtaCommittee rows, so this column would only ever render as a wall of
   * "—" for it. Both list pages pass this from the same
   * getOrganizationCommitteeOptions() check the filter form already uses,
   * so the whole ledger view -- not just the filter and create/edit forms
   * -- stays vertical-agnostic-by-default rather than leaking a PTA-only
   * concept into every other vertical's UI. */
  showCommitteeColumn?: boolean;
}) {
  const columnCount = 8 + (showCommitteeColumn ? 1 : 0);
  return (
    // min-w-0 is required alongside overflow-x-auto here, not decorative:
    // without it, this div (a block child inside a flex/grid ancestor chain
    // with no explicit width constraint of its own) sizes itself to fit the
    // table's full intrinsic width instead of its allocated space, which
    // defeats overflow-x-auto and blows out every ancestor up to <main> at
    // narrow viewports. With it, the div can shrink below the table's
    // content width, so the table scrolls inside it instead of the whole
    // page scrolling horizontally.
    <div className="min-w-0 overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-left text-slate-700">
          <tr>
            <th className="px-4 py-3">Date</th>
            <th className="px-4 py-3">Vendor / Payee</th>
            <th className="px-4 py-3">Description</th>
            <th className="px-4 py-3">Category</th>
            {showCommitteeColumn ? <th className="px-4 py-3">Committee</th> : null}
            <th className="px-4 py-3">Origin</th>
            <th className="px-4 py-3">Amount</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Supporting Record</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columnCount} className="px-4 py-6 text-center text-slate-600">
                No expenditures have been recorded yet.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-100">
                <td className="px-4 py-3 text-slate-900">{formatDate(row.date)}</td>
                <td className="px-4 py-3 text-slate-900">
                  <Link href={`${basePath}/${row.id}`} className="font-semibold text-emerald-700 hover:underline">
                    {formatText(row.vendor, "Direct expense")}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-900">{row.description}</td>
                <td className="px-4 py-3 text-slate-900">{formatText(row.categoryRef?.name ?? row.category, "Uncategorized")}</td>
                {showCommitteeColumn ? (
                  <td className="px-4 py-3 text-slate-900" title={describeCommitteeAttribution(row).helper}>{describeCommitteeAttribution(row).display}</td>
                ) : null}
                <td className="px-4 py-3 text-slate-900">
                  {row.reimbursement ? (
                    <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-800" title={`Created from reimbursement to ${row.reimbursement.payeeName}`}>
                      {reimbursementsBasePath ? (
                        <Link href={`${reimbursementsBasePath}?highlight=${row.reimbursement.id}`} className="hover:underline">
                          Created from reimbursement
                        </Link>
                      ) : (
                        "Created from reimbursement"
                      )}
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">Direct entry</span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-900">{formatCurrency(row.amount)}</td>
                <td className="px-4 py-3 text-slate-900">
                  {row.voidedAt ? <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700">Voided</span> : <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">Active</span>}
                </td>
                <td className="px-4 py-3 text-slate-900">
                  {row.receiptUrl ? (
                    <Link href={row.receiptUrl} className="text-emerald-700 hover:underline">
                      View receipt
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
