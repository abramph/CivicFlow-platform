import { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, Download, Filter, LineChart as LineChartIcon } from 'lucide-react';

const api = window.civicflow;

const TYPE_OPTIONS = [
  { value: 'DUES', label: 'Dues Payment' },
  { value: 'DONATION', label: 'Donation' },
  { value: 'CAMPAIGN_CONTRIBUTION', label: 'Campaign Contributions' },
  { value: 'EVENT_REVENUE', label: 'Event Revenue' },
  { value: 'OTHER_INCOME', label: 'Other Income' },
];

const PAYMENT_METHOD_LABELS = {
  STRIPE: 'Stripe',
  ZELLE: 'Zelle',
  CASHAPP: 'Cash App',
  VENMO: 'Venmo',
  CASH: 'Cash',
  CHECK: 'Check',
  OTHER: 'Other',
  IMPORT: 'Import',
  MANUAL: 'Manual',
};

function formatPaymentLabel(method) {
  const key = String(method || '').toUpperCase();
  if (!key) return PAYMENT_METHOD_LABELS.MANUAL;
  return PAYMENT_METHOD_LABELS[key] || key;
}

function startOfMonthISO() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return toLocalDateISO(start);
}

function todayISO() {
  return toLocalDateISO(new Date());
}

function toLocalDateISO(value) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatCurrency(cents) {
  const dollars = (Number(cents || 0) / 100);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(dollars);
}

function formatTxnTypeWithContext(txn) {
  const type = String(txn?.transaction_type || txn?.type || '').toUpperCase();
  if (type === 'CAMPAIGN_CONTRIBUTION' && txn?.campaign_name) return `Campaign Contribution (${txn.campaign_name})`;
  if (type === 'EVENT_REVENUE' && txn?.event_name) return `Event Revenue (${txn.event_name})`;
  if (type === 'DUES') return 'Dues Payment';
  if (type === 'DONATION') return 'Donation';
  if (type === 'CAMPAIGN_CONTRIBUTION') return 'Campaign Contribution';
  if (type === 'EVENT_REVENUE') return 'Event Revenue';
  if (type === 'OTHER_INCOME') return 'Other Income';
  return type || '—';
}

function contributorDisplay(txn) {
  if (txn?.first_name || txn?.last_name) {
    return `${txn.last_name || ''}${txn.last_name ? ', ' : ''}${txn.first_name || ''}`.trim();
  }
  if (txn?.contributor_name) return txn.contributor_name;
  return '—';
}

function LineChart({ data, height = 200 }) {
  if (!data || data.length === 0) {
    return <div className="text-sm text-slate-500">No data for selected range.</div>;
  }
  const width = 620;
  const padding = 24;
  const values = data.map((d) => Number(d.total || 0));
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const range = max - min || 1;

  const points = data.map((d, i) => {
    const total = Number(d?.total ?? 0);
    const safeTotal = Number.isFinite(total) ? total : 0;
    const x = padding + (i * (width - padding * 2)) / Math.max(data.length - 1, 1);
    const y = padding + ((max - safeTotal) * (height - padding * 2)) / range;
    return { x, y };
  });

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-[200px]">
      <path d={path} fill="none" stroke="#10b981" strokeWidth="3" />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3" fill="#10b981" />
      ))}
    </svg>
  );
}

function BarChart({ data }) {
  if (!data || data.length === 0) {
    return <div className="text-sm text-slate-500">No data for selected range.</div>;
  }
  const maxVal = Math.max(...data.map((d) => Math.abs(Number(d.total || 0))), 1);
  const labelForType = (value) => {
    const v = String(value || '').toUpperCase();
    if (v === 'DUES') return 'Dues Payment';
    if (v === 'DONATION') return 'Donation';
    if (v === 'CAMPAIGN_CONTRIBUTION') return 'Campaign Contributions';
    if (v === 'EVENT_REVENUE') return 'Event Revenue';
    if (v === 'OTHER_INCOME') return 'Other Income';
    return v || 'Unknown';
  };
  return (
    <div className="space-y-3">
      {data.map((d, index) => {
        const value = Number(d.total || 0);
        const safeValue = Number.isFinite(value) ? value : 0;
        const widthPct = Math.round((Math.abs(safeValue) / maxVal) * 100);
        const color = safeValue >= 0 ? 'bg-emerald-500' : 'bg-red-500';
        const rowKey = `${String(d?.transaction_type ?? 'unknown')}-${index}`;
        return (
          <div key={rowKey} className="flex items-center gap-3">
            <div className="w-36 text-sm text-slate-700">{labelForType(d.transaction_type)}</div>
            <div className="flex-1 h-3 bg-slate-100 rounded">
              <div className={`h-3 rounded ${color}`} style={{ width: `${widthPct}%` }} />
            </div>
            <div className="w-28 text-right text-sm text-slate-700">{formatCurrency(safeValue)}</div>
          </div>
        );
      })}
    </div>
  );
}

export function ReportsDashboard({ initialTypes }) {
  const [startDate, setStartDate] = useState(startOfMonthISO);
  const [endDate, setEndDate] = useState(todayISO);
  const defaultTypes = Array.isArray(initialTypes) && initialTypes.length > 0
    ? initialTypes
    : TYPE_OPTIONS.map((t) => t.value);
  const [selectedTypes, setSelectedTypes] = useState(defaultTypes);
  const [paymentMethod, setPaymentMethod] = useState('');
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [memberId, setMemberId] = useState('');
  const [groupBy, setGroupBy] = useState('day');
  const [members, setMembers] = useState([]);
  const [orgId, setOrgId] = useState(1);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [kpis, setKpis] = useState(null);
  const [timeseries, setTimeseries] = useState([]);
  const [byType, setByType] = useState([]);
  const [byMember, setByMember] = useState([]);
  const [recent, setRecent] = useState([]);
  const [recentSortBy, setRecentSortBy] = useState('date');
  const [recentSortDir, setRecentSortDir] = useState('desc');
  const [refreshTick, setRefreshTick] = useState(0);

  const cacheRef = useRef(new Map());

  useEffect(() => {
    let cancelled = false;
    Promise.all([api?.members?.list?.(), api?.organization?.get?.()])
      .then(([membersList, org]) => {
        if (cancelled) return;
        setMembers(Array.isArray(membersList) ? membersList : []);
        if (org?.id) setOrgId(org.id);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (Array.isArray(initialTypes) && initialTypes.length > 0) {
      setSelectedTypes(initialTypes);
    }
  }, [initialTypes]);

  useEffect(() => {
    const onInvalidate = (event) => {
      const keys = Array.isArray(event?.detail) ? event.detail : [];
      if (!keys.length) return;
      if (!keys.includes('reports') && !keys.includes('transactions') && !keys.includes('dashboard')) return;
      cacheRef.current.clear();
      setRefreshTick((tick) => tick + 1);
    };
    window.addEventListener('civicflow:invalidate', onInvalidate);
    return () => window.removeEventListener('civicflow:invalidate', onInvalidate);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api?.reports?.getPaymentMethods?.(orgId)
      .then((methods) => {
        if (cancelled) return;
        const list = Array.isArray(methods)
          ? methods
            .map((m) => String(m?.payment_method || '').trim().toUpperCase())
            .filter(Boolean)
          : [];
        setPaymentMethods([...new Set(list)]);
      })
      .catch(() => {
        if (!cancelled) setPaymentMethods([]);
      });
    return () => { cancelled = true; };
  }, [orgId]);

  const filters = useMemo(() => ({
    orgId,
    startDate,
    endDate,
    types: selectedTypes,
    paymentMethod: paymentMethod || null,
    memberId: memberId ? Number(memberId) : null,
    groupBy,
  }), [orgId, startDate, endDate, selectedTypes, paymentMethod, memberId, groupBy, refreshTick]);

  useEffect(() => {
    const key = JSON.stringify(filters);
    if (cacheRef.current.has(key)) {
      const cached = cacheRef.current.get(key);
      setKpis(cached.kpis);
      setTimeseries(cached.timeseries);
      setByType(cached.byType);
      setByMember(cached.byMember);
      setRecent(cached.recent);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      api?.reports?.getKpis?.(filters),
      api?.reports?.getTimeseries?.(filters),
      api?.reports?.getByType?.(filters),
      api?.reports?.getByMember?.(filters),
      api?.reports?.getRecent?.(filters),
    ])
      .then(([kpiRes, tsRes, typeRes, memberRes, recentRes]) => {
        if (cancelled) return;
        if (kpiRes?.error) {
          setError(kpiRes.error);
          return;
        }
        const normalizedKpis = kpiRes
          ? {
              ...kpiRes,
              total_income: Number(kpiRes.total_income ?? kpiRes.revenue_cents ?? 0),
              total_expense: Number(kpiRes.total_expense ?? kpiRes.expenses_cents ?? 0),
              net_total: Number(kpiRes.net_total ?? kpiRes.net_cents ?? 0),
              dues_collected: Number(kpiRes.dues_collected ?? 0),
              outstanding_dues: Number(kpiRes.outstanding_dues ?? 0),
            }
          : null;

        const normalizedTimeseries = Array.isArray(tsRes)
          ? tsRes.map((row) => ({ ...row, total: Number(row.total ?? row.total_cents ?? 0) }))
          : [];

        const normalizedByType = Array.isArray(typeRes)
          ? typeRes.map((row) => ({
              ...row,
              transaction_type: row.transaction_type || row.type || '',
              total: Number(row.total ?? row.total_cents ?? 0),
            }))
          : [];

        const normalizedByMember = Array.isArray(memberRes)
          ? memberRes.map((row) => ({ ...row, total: Number(row.total ?? row.total_cents ?? 0) }))
          : [];

        const payload = {
          kpis: normalizedKpis,
          timeseries: normalizedTimeseries,
          byType: normalizedByType,
          byMember: normalizedByMember,
          recent: Array.isArray(recentRes) ? recentRes : [],
        };
        cacheRef.current.set(key, payload);
        setKpis(payload.kpis);
        setTimeseries(payload.timeseries);
        setByType(payload.byType);
        setByMember(payload.byMember);
        setRecent(payload.recent);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message ?? 'Failed to load report data');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [filters]);

  const sortedRecent = useMemo(() => {
    const rows = Array.isArray(recent) ? [...recent] : [];
    const direction = recentSortDir === 'asc' ? 1 : -1;

    const valueFor = (row) => {
      if (recentSortBy === 'type') return formatTxnTypeWithContext(row).toLowerCase();
      if (recentSortBy === 'contributor') return contributorDisplay(row).toLowerCase();
      if (recentSortBy === 'method') return formatPaymentLabel(row?.payment_method).toLowerCase();
      if (recentSortBy === 'amount') return Number(row?.amount_cents ?? 0);
      return String(row?.occurred_on || '');
    };

    return rows.sort((a, b) => {
      const av = valueFor(a);
      const bv = valueFor(b);
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * direction;
      return String(av).localeCompare(String(bv)) * direction;
    });
  }, [recent, recentSortBy, recentSortDir]);

  const toggleType = (value) => {
    setSelectedTypes((prev) => (
      prev.includes(value) ? prev.filter((t) => t !== value) : [...prev, value]
    ));
  };

  const handleExport = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api?.reports?.exportCsv?.(filters);
      if (result?.error) throw new Error(result.error);
      if (result?.canceled) return;
    } catch (err) {
      setError(err?.message ?? 'Failed to export CSV');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Financial Reports Dashboard</h2>
          <p className="text-slate-600">Filter, analyze, and export your financial data.</p>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          <Download className="h-4 w-4" />
          Export CSV
        </button>
      </div>

      {error && (
        <div role="alert" className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800">
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-6">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
          <Filter className="h-5 w-5 text-slate-500" />
          <h3 className="text-lg font-semibold text-slate-800">Filters</h3>
        </div>
        <div className="p-6 grid grid-cols-1 lg:grid-cols-4 gap-4">
          <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Payment Method</label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">All Methods</option>
              {paymentMethods.map((method) => (
                <option key={method} value={method}>{formatPaymentLabel(method)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Member</label>
            <select
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">All Members</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {[m.last_name, m.first_name].filter(Boolean).join(', ') || `Member #${m.id}`}
                </option>
              ))}
            </select>
          </div>
          <div className="lg:col-span-4">
            <label className="block text-sm font-medium text-slate-700 mb-1">Transaction Types</label>
            <div className="flex flex-wrap gap-3">
              {TYPE_OPTIONS.map((opt) => (
                <label key={opt.value} className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={selectedTypes.includes(opt.value)}
                    onChange={() => toggleType(opt.value)}
                    className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Group By</label>
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
            >
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
            </select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500">Total Income</p>
          <p className="text-xl font-semibold text-emerald-700">{formatCurrency(kpis?.total_income)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500">Total Expense</p>
          <p className="text-xl font-semibold text-red-600">{formatCurrency(kpis?.total_expense)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500">Net Total</p>
          <p className="text-xl font-semibold text-slate-800">{formatCurrency(kpis?.net_total)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500">Dues Collected</p>
          <p className="text-xl font-semibold text-slate-800">{formatCurrency(kpis?.dues_collected)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500">Outstanding Dues</p>
          <p className="text-xl font-semibold text-amber-700">{formatCurrency(kpis?.outstanding_dues)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <div className="flex items-center gap-2 mb-4">
            <LineChartIcon className="h-5 w-5 text-slate-500" />
            <h3 className="text-lg font-semibold text-slate-800">Net Over Time</h3>
          </div>
          <LineChart data={timeseries.map((d) => ({ ...d, total: d.total }))} />
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <div className="flex items-center gap-2 mb-4">
            <Calendar className="h-5 w-5 text-slate-500" />
            <h3 className="text-lg font-semibold text-slate-800">Totals by Transaction Type</h3>
          </div>
          <BarChart data={byType} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h3 className="text-lg font-semibold text-slate-800 mb-4">Top Members by Payments</h3>
          {byMember.length === 0 ? (
            <p className="text-sm text-slate-500">No member payments in this range.</p>
          ) : (
            <div className="space-y-2">
              {byMember.map((m, index) => (
                <div key={`${m.member_id ?? 'unknown'}-${index}`} className="flex items-center justify-between text-sm">
                  <span className="text-slate-700">
                    {m.first_name || m.last_name
                      ? `${m.last_name || ''}${m.last_name ? ', ' : ''}${m.first_name || ''}`.trim()
                      : 'Unknown'}
                  </span>
                  <span className="font-medium text-slate-800">{formatCurrency(m.total)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h3 className="text-lg font-semibold text-slate-800">Recent Transactions</h3>
            <div className="flex items-center gap-2">
              <select
                value={recentSortBy}
                onChange={(e) => setRecentSortBy(e.target.value)}
                className="px-2 py-1.5 rounded-lg border border-slate-300 text-sm"
              >
                <option value="date">Date</option>
                <option value="type">Transaction Type</option>
                <option value="contributor">Contributor</option>
                <option value="method">Method</option>
                <option value="amount">Amount</option>
              </select>
              <button
                type="button"
                onClick={() => setRecentSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50"
              >
                {recentSortDir === 'asc' ? 'Asc' : 'Desc'}
              </button>
            </div>
          </div>
          {recent.length === 0 ? (
            <p className="text-sm text-slate-500">No transactions in this range.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="text-left py-2">Date</th>
                    <th className="text-left py-2">Member</th>
                    <th className="text-left py-2">Type</th>
                    <th className="text-left py-2">Method</th>
                    <th className="text-right py-2">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedRecent.map((r, index) => (
                    <tr key={r.id ?? `${r.occurred_on ?? 'date'}-${r.amount_cents ?? 0}-${index}`}>
                      <td className="py-2 text-slate-600">{r.occurred_on}</td>
                      <td className="py-2 text-slate-700">{contributorDisplay(r)}</td>
                      <td className="py-2 text-slate-600">{formatTxnTypeWithContext(r)}</td>
                      <td className="py-2 text-slate-600">{formatPaymentLabel(r.payment_method)}</td>
                      <td className="py-2 text-right font-medium text-slate-800">{formatCurrency(r.amount_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
