function money(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** feature/pta-treasurer-expenditure-experience (E1) — extracted unchanged
 * from the original PtaFinanceDashboard's summary-tile section (same
 * markup, same values, same behavior); now its own Overview section. */
export function PtaFinanceOverview({
  summary,
}: {
  summary: {
    contributionsTotal: number;
    expendituresTotal: number;
    pendingReimbursements: { count: number; total: number };
    approvedUnpaidReimbursements: { count: number; total: number };
  };
}) {
  const net = summary.contributionsTotal - summary.expendituresTotal;

  return (
    <div className="flex flex-wrap gap-4">
      <div className="rounded-xl bg-slate-50 px-4 py-3">
        <p className="text-xl font-bold text-slate-900">{money(summary.contributionsTotal)}</p>
        <p className="text-xs text-slate-500">income (contributions)</p>
      </div>
      <div className="rounded-xl bg-slate-50 px-4 py-3">
        <p className="text-xl font-bold text-slate-900">{money(summary.expendituresTotal)}</p>
        <p className="text-xs text-slate-500">spending</p>
      </div>
      <div className="rounded-xl bg-slate-50 px-4 py-3">
        <p className={`text-xl font-bold ${net >= 0 ? "text-emerald-700" : "text-red-700"}`}>{money(net)}</p>
        <p className="text-xs text-slate-500">net this year</p>
      </div>
      <div className="rounded-xl bg-amber-50 px-4 py-3">
        <p className="text-xl font-bold text-amber-800">
          {summary.pendingReimbursements.count} / {money(summary.pendingReimbursements.total)}
        </p>
        <p className="text-xs text-amber-700">reimbursements awaiting review</p>
      </div>
      <div className="rounded-xl bg-sky-50 px-4 py-3">
        <p className="text-xl font-bold text-sky-800">
          {summary.approvedUnpaidReimbursements.count} / {money(summary.approvedUnpaidReimbursements.total)}
        </p>
        <p className="text-xs text-sky-700">approved, not yet paid</p>
      </div>
    </div>
  );
}
