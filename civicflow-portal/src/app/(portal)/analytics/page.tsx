import { getAnalytics } from "@/lib/apiClient";
import { requirePortalSession } from "@/lib/session";

function toCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(Number(value || 0));
}

export default async function AnalyticsPage() {
  const session = await requirePortalSession();
  const analytics = await getAnalytics(session);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Analytics</h2>
        <p className="mt-1 text-sm text-slate-600">Detailed cloud analytics summary</p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="font-semibold">Payments by Method</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="px-3 py-2">Method</th>
                <th className="px-3 py-2">Count</th>
                <th className="px-3 py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {analytics.payments_by_method.map((row) => (
                <tr key={row.method} className="border-b border-slate-100">
                  <td className="px-3 py-2">{row.method}</td>
                  <td className="px-3 py-2">{row.count}</td>
                  <td className="px-3 py-2">{toCurrency(row.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="font-semibold">Monthly Totals</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="px-3 py-2">Month</th>
                <th className="px-3 py-2">Count</th>
                <th className="px-3 py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {analytics.monthly_totals.map((row) => (
                <tr key={row.month} className="border-b border-slate-100">
                  <td className="px-3 py-2">{row.month}</td>
                  <td className="px-3 py-2">{row.count}</td>
                  <td className="px-3 py-2">{toCurrency(row.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
