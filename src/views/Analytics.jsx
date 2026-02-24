import { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';

const api = window.civicflow;

const formatCurrency = (value) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(Number(value || 0));

export function Analytics() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState({
    total_payments: 0,
    total_amount: 0,
    payments_by_method: [],
    monthly_totals: [],
  });

  const loadSummary = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api?.analytics?.getSummary?.();
      if (!result || result.success === false) {
        throw new Error(result?.error || 'Failed to load analytics summary.');
      }
      setSummary({
        total_payments: Number(result?.data?.total_payments || 0),
        total_amount: Number(result?.data?.total_amount || 0),
        payments_by_method: Array.isArray(result?.data?.payments_by_method) ? result.data.payments_by_method : [],
        monthly_totals: Array.isArray(result?.data?.monthly_totals) ? result.data.monthly_totals : [],
      });
    } catch (err) {
      setError(err?.message || 'Failed to load analytics summary.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSummary();
  }, []);

  const methodChartData = useMemo(
    () => (summary.payments_by_method || []).map((row) => ({
      method: String(row.method || 'UNKNOWN').toUpperCase(),
      count: Number(row.count || 0),
      total: Number(row.total || 0),
    })),
    [summary.payments_by_method],
  );

  const monthlyChartData = useMemo(
    () => (summary.monthly_totals || []).map((row) => ({
      month: row.month || 'N/A',
      total: Number(row.total || 0),
      count: Number(row.count || 0),
    })),
    [summary.monthly_totals],
  );

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Analytics</h2>
          <p className="text-slate-600 mt-1">Cloud payment activity summary</p>
        </div>
        <button
          type="button"
          onClick={loadSummary}
          className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <p className="text-sm font-medium text-slate-500">Total Revenue</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{formatCurrency(summary.total_amount)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <p className="text-sm font-medium text-slate-500">Total Payments</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{summary.total_payments}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h3 className="text-lg font-semibold text-slate-800 mb-4">Payments by Method</h3>
        <div className="h-72">
          {loading ? (
            <div className="h-full flex items-center justify-center text-slate-500">Loading…</div>
          ) : methodChartData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-slate-500">No data available.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={methodChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="method" />
                <YAxis />
                <Tooltip formatter={(value, name) => (name === 'total' ? formatCurrency(value) : value)} />
                <Bar dataKey="count" fill="#16a34a" name="count" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h3 className="text-lg font-semibold text-slate-800 mb-4">Monthly Trend</h3>
        <div className="h-72">
          {loading ? (
            <div className="h-full flex items-center justify-center text-slate-500">Loading…</div>
          ) : monthlyChartData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-slate-500">No data available.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip formatter={(value, name) => (name === 'total' ? formatCurrency(value) : value)} />
                <Line type="monotone" dataKey="total" stroke="#0ea5e9" strokeWidth={2} name="total" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
