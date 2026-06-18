import { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import * as moneyUtils from '../shared/money.js';

const api = window.civicflow;
const { formatMoneyFromCents, resolveAmountCents } = moneyUtils;

const EMPTY_SUMMARY = {
  total_members: 0,
  active_members: 0,
  total_payments: 0,
  total_amount_cents: 0,
  campaign_total_cents: 0,
  event_total_cents: 0,
  unpaid_balances_cents: 0,
  payments_by_method: [],
  monthly_totals: [],
  yearly_totals: [],
  campaign_totals: [],
  event_totals: [],
  recent_payments: [],
  unpaid_balances: [],
};

const methodLabelMap = {
  STRIPE: 'Stripe',
  ZELLE: 'Zelle',
  CASHAPP: 'Cash App',
  VENMO: 'Venmo',
  CASH: 'Cash',
  CHECK: 'Check',
  OTHER: 'Other',
  MANUAL: 'Manual',
  UNKNOWN: 'Unknown',
};

const sourceLabelMap = {
  MEMBER_PROFILE: 'Member profile',
  CAMPAIGN: 'Campaign',
  EVENT: 'Event',
  FINANCES: 'Finances',
  LOCAL: 'Local',
};

const formatCurrency = (valueCents) => formatMoneyFromCents(valueCents);

const formatDate = (value) => {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};

const formatMethod = (method) => {
  const key = String(method || 'unknown').trim().toUpperCase();
  return methodLabelMap[key] || key || 'Unknown';
};

const formatSource = (source) => {
  const key = String(source || 'local').trim().toUpperCase();
  return sourceLabelMap[key] || key.replace(/_/g, ' ').toLowerCase();
};

const normalizeSummary = (data = {}) => ({
  total_members: Number(data?.total_members ?? data?.totalMembers ?? 0),
  active_members: Number(data?.active_members ?? data?.activeMembers ?? 0),
  total_payments: Number(data?.total_payments ?? data?.totalPayments ?? 0),
  total_amount_cents: Number(data?.total_amount_cents ?? data?.totalAmountCents ?? 0),
  campaign_total_cents: Number(data?.campaign_total_cents ?? data?.campaignTotalCents ?? 0),
  event_total_cents: Number(data?.event_total_cents ?? data?.eventTotalCents ?? 0),
  unpaid_balances_cents: Number(data?.unpaid_balances_cents ?? data?.unpaidBalancesCents ?? 0),
  payments_by_method: Array.isArray(data?.payments_by_method) ? data.payments_by_method : [],
  monthly_totals: Array.isArray(data?.monthly_totals) ? data.monthly_totals : [],
  yearly_totals: Array.isArray(data?.yearly_totals) ? data.yearly_totals : [],
  campaign_totals: Array.isArray(data?.campaign_totals) ? data.campaign_totals : [],
  event_totals: Array.isArray(data?.event_totals) ? data.event_totals : [],
  recent_payments: Array.isArray(data?.recent_payments) ? data.recent_payments : [],
  unpaid_balances: Array.isArray(data?.unpaid_balances) ? data.unpaid_balances : [],
});

function StatCard({ label, value, subtext }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-slate-900">{value}</p>
      {subtext ? <p className="mt-2 text-sm text-slate-500">{subtext}</p> : null}
    </div>
  );
}

export function Analytics() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);

  const loadSummary = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api?.analytics?.getSummary?.();
      if (!result || result.success === false) {
        throw new Error(result?.error || 'Failed to load analytics summary.');
      }
      setSummary(normalizeSummary(result?.data));
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error('Analytics summary failed to load', err);
      }
      setSummary(EMPTY_SUMMARY);
      setError('Analytics data is temporarily unavailable. Showing empty totals until it can be refreshed.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSummary();
  }, []);

  const methodChartData = useMemo(
    () => (summary.payments_by_method || []).map((row) => ({
      method: formatMethod(row.method),
      count: Number(row.count || 0),
      total_cents: resolveAmountCents(row.total_cents, row.total) ?? 0,
    })),
    [summary.payments_by_method],
  );

  const monthlyChartData = useMemo(
    () => (summary.monthly_totals || []).map((row) => ({
      month: row.month || 'N/A',
      total_cents: resolveAmountCents(row.total_cents, row.total) ?? 0,
      count: Number(row.count || 0),
    })),
    [summary.monthly_totals],
  );

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Analytics</h2>
          <p className="text-slate-600 mt-1">Local contribution, member, and revenue summary</p>
        </div>
        <button
          type="button"
          onClick={loadSummary}
          className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
        >
          Refresh
        </button>
      </div>

      {error ? (
        <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <StatCard label="Total Revenue" value={loading ? '--' : formatCurrency(summary.total_amount_cents)} subtext="Completed payments" />
        <StatCard label="Total Payments" value={loading ? '--' : summary.total_payments} subtext="Posted contribution and dues rows" />
        <StatCard label="Total Members" value={loading ? '--' : summary.total_members} subtext={`${summary.active_members} active`} />
        <StatCard label="Campaign Revenue" value={loading ? '--' : formatCurrency(summary.campaign_total_cents)} subtext="All campaign-linked contributions" />
        <StatCard label="Event Revenue" value={loading ? '--' : formatCurrency(summary.event_total_cents)} subtext="All event-linked revenue" />
        <StatCard label="Outstanding Balances" value={loading ? '--' : formatCurrency(summary.unpaid_balances_cents)} subtext="Active members currently past due" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="text-lg font-semibold text-slate-800 mb-4">Payments by Method</h3>
          <div className="h-72">
            {loading ? (
              <div className="h-full flex items-center justify-center text-slate-500">Loading...</div>
            ) : methodChartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-slate-500">No payment data available.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={methodChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="method" />
                  <YAxis />
                  <Tooltip formatter={(value, name) => (name === 'total_cents' ? formatCurrency(value) : value)} />
                  <Bar dataKey="count" fill="#16a34a" name="count" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="text-lg font-semibold text-slate-800 mb-4">Monthly Contribution Trend</h3>
          <div className="h-72">
            {loading ? (
              <div className="h-full flex items-center justify-center text-slate-500">Loading...</div>
            ) : monthlyChartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-slate-500">No monthly contribution history yet.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthlyChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip formatter={(value, name) => (name === 'total_cents' ? formatCurrency(value) : value)} />
                  <Line type="monotone" dataKey="total_cents" stroke="#0ea5e9" strokeWidth={2} name="total_cents" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="text-lg font-semibold text-slate-800 mb-4">Recent Payments</h3>
          {loading ? (
            <div className="text-slate-500">Loading...</div>
          ) : summary.recent_payments.length === 0 ? (
            <div className="text-slate-500">No recent payments available.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="pb-2 pr-4 font-medium">Contributor</th>
                    <th className="pb-2 pr-4 font-medium">Date</th>
                    <th className="pb-2 pr-4 font-medium">Method</th>
                    <th className="pb-2 pr-4 font-medium">Source</th>
                    <th className="pb-2 font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.recent_payments.map((payment) => (
                    <tr key={payment.id} className="border-b border-slate-100 last:border-b-0">
                      <td className="py-2 pr-4 text-slate-800">{payment.contributor_label || '—'}</td>
                      <td className="py-2 pr-4 text-slate-600">{formatDate(payment.occurred_on)}</td>
                      <td className="py-2 pr-4 text-slate-600">{formatMethod(payment.payment_method)}</td>
                      <td className="py-2 pr-4 text-slate-600">{formatSource(payment.source)}</td>
                      <td className="py-2 text-slate-800 font-medium">{formatCurrency(payment.amount_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="text-lg font-semibold text-slate-800 mb-4">Outstanding Member Balances</h3>
          {loading ? (
            <div className="text-slate-500">Loading...</div>
          ) : summary.unpaid_balances.length === 0 ? (
            <div className="text-slate-500">No unpaid member balances right now.</div>
          ) : (
            <div className="space-y-3">
              {summary.unpaid_balances.map((row) => (
                <div key={row.member_id} className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
                  <div>
                    <p className="font-medium text-slate-800">{row.member_name}</p>
                    <p className="text-sm text-slate-500 capitalize">{row.status?.replace(/_/g, ' ') || 'past due'}</p>
                  </div>
                  <div className="font-semibold text-amber-700">{formatCurrency(row.balance_cents)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="text-lg font-semibold text-slate-800 mb-4">Top Campaigns</h3>
          {loading ? (
            <div className="text-slate-500">Loading...</div>
          ) : summary.campaign_totals.length === 0 ? (
            <div className="text-slate-500">No campaign contributions yet.</div>
          ) : (
            <div className="space-y-3">
              {summary.campaign_totals.map((row) => (
                <div key={row.campaign_id || row.name} className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-800">{row.name}</p>
                    <p className="text-sm text-slate-500">{Number(row.count || 0)} payments</p>
                  </div>
                  <div className="font-semibold text-slate-800">{formatCurrency(row.total_cents)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="text-lg font-semibold text-slate-800 mb-4">Top Events</h3>
          {loading ? (
            <div className="text-slate-500">Loading...</div>
          ) : summary.event_totals.length === 0 ? (
            <div className="text-slate-500">No event revenue yet.</div>
          ) : (
            <div className="space-y-3">
              {summary.event_totals.map((row) => (
                <div key={row.event_id || row.name} className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-800">{row.name}</p>
                    <p className="text-sm text-slate-500">{Number(row.count || 0)} payments</p>
                  </div>
                  <div className="font-semibold text-slate-800">{formatCurrency(row.total_cents)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="text-lg font-semibold text-slate-800 mb-4">Yearly Totals</h3>
          {loading ? (
            <div className="text-slate-500">Loading...</div>
          ) : summary.yearly_totals.length === 0 ? (
            <div className="text-slate-500">No yearly trend data yet.</div>
          ) : (
            <div className="space-y-3">
              {summary.yearly_totals.map((row) => (
                <div key={row.year} className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-800">{row.year}</p>
                    <p className="text-sm text-slate-500">{Number(row.count || 0)} payments</p>
                  </div>
                  <div className="font-semibold text-slate-800">{formatCurrency(row.total_cents)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
