import { getAnalytics } from "@/lib/apiClient";
import { requirePortalSession } from "@/lib/session";

function toCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(Number(value || 0));
}

export default async function DashboardPage() {
  const session = await requirePortalSession();
  const analytics = await getAnalytics(session);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Dashboard</h2>
        <p className="mt-1 text-sm text-slate-600">Organization analytics snapshot</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Total Revenue</p>
          <p className="mt-2 text-3xl font-semibold">{toCurrency(analytics.total_amount)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Total Payments</p>
          <p className="mt-2 text-3xl font-semibold">{analytics.total_payments}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="font-semibold">Payments by Method</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {analytics.payments_by_method.length === 0 ? (
              <li className="text-slate-500">No data.</li>
            ) : analytics.payments_by_method.map((row) => (
              <li key={row.method} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <span>{row.method}</span>
                <span className="font-medium">{row.count} ({toCurrency(row.total)})</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="font-semibold">Monthly Totals</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {analytics.monthly_totals.length === 0 ? (
              <li className="text-slate-500">No data.</li>
            ) : analytics.monthly_totals.map((row) => (
              <li key={row.month} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <span>{row.month}</span>
                <span className="font-medium">{toCurrency(row.total)} ({row.count})</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
