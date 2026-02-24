import { useState, useEffect } from 'react';
import { DollarSign, Download, Plus, Send } from 'lucide-react';
import EmailReportModal from '../components/EmailReportModal';
import PaymentModal from '../components/PaymentModal';

const api = window.civicflow;

const emitInvalidation = (keys) => {
  if (typeof window === 'undefined') return;
  const detail = Array.isArray(keys) ? keys : [];
  window.dispatchEvent(new CustomEvent('civicflow:invalidate', { detail }));
};

function getDateRange(daysBack = 90) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - daysBack);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

export function Finances() {
  const [transactions, setTransactions] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [orgName, setOrgName] = useState('Civicflow');
  const [orgId, setOrgId] = useState(1);
  const [filters, setFilters] = useState(() => getDateRange(90));
  const [typeFilter, setTypeFilter] = useState('');
  const [exporting, setExporting] = useState(false);
  const [currentRole, setCurrentRole] = useState('Admin');
  const [emailReportModal, setEmailReportModal] = useState(null);
  const [paymentModalContext, setPaymentModalContext] = useState(null);
  const typeLabel = (txn) => {
    const t = String(txn?.transaction_type || txn?.type || '').trim().toUpperCase();
    const map = {
      DUES: 'Dues Payment',
      DONATION: 'Donation',
      CAMPAIGN_CONTRIBUTION: 'Campaign Contribution',
      EVENT_REVENUE: 'Event Revenue',
      OTHER_INCOME: 'Other Income',
    };
    if (t === 'CAMPAIGN_CONTRIBUTION' && txn?.campaign_name) return `Campaign Contribution (${txn.campaign_name})`;
    if (t === 'EVENT_REVENUE' && txn?.event_name) return `Event Revenue (${txn.event_name})`;
    if (map[t]) return map[t];
    return t.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
  };

  const contributorLabel = (txn) => {
    const memberName = [txn.member_first_name, txn.member_last_name].filter(Boolean).join(' ').trim();
    if (memberName) return memberName;
    if (txn.contributor_name) return txn.contributor_name;
    const ct = String(txn.contributor_type || '').toUpperCase();
    if (ct === 'CAMPAIGN_REVENUE') return 'Campaign contribution';
    if (ct === 'EVENT_REVENUE') return 'Event revenue';
    if (ct === 'NON_MEMBER') return 'Non-member';
    return '—';
  };

  const loadData = () => {
    setLoading(true);
    setError(null);
    const q = { ...filters };
    if (typeFilter) q.type = typeFilter;
    Promise.all([api?.transactions?.list(q), api?.members?.list()])
      .then(([txns, membersData]) => {
        setTransactions(Array.isArray(txns) ? txns : []);
        setMembers(Array.isArray(membersData) ? membersData : []);
      })
      .catch((err) => {
        setError(err?.message ?? 'Failed to load transactions');
        setTransactions([]);
        setMembers([]);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
    api?.roles?.getCurrent?.().then((r) => {
      if (r?.role) setCurrentRole(r.role);
    }).catch(() => {});
    api?.organization?.get?.().then((org) => {
      if (org?.name) setOrgName(org.name);
      if (org?.id) setOrgId(org.id);
    }).catch(() => {});
  }, [filters.startDate, filters.endDate, typeFilter]);

  useEffect(() => {
    const handler = (e) => {
      const keys = Array.isArray(e?.detail) ? e.detail : [];
      if (keys.includes('transactions')) {
        loadData();
      }
    };
    window.addEventListener('civicflow:invalidate', handler);
    return () => window.removeEventListener('civicflow:invalidate', handler);
  }, [filters.startDate, filters.endDate, typeFilter]);

  const isCompleted = (t) => String(t?.status || 'COMPLETED').toUpperCase() === 'COMPLETED';
  const incomeCents = transactions
    .filter((t) => isCompleted(t) && (t.amount_cents ?? 0) > 0)
    .reduce((s, t) => s + t.amount_cents, 0);
  const expenseCents = transactions
    .filter((t) => isCompleted(t) && (t.amount_cents ?? 0) < 0)
    .reduce((s, t) => s + Math.abs(t.amount_cents), 0);
  const runningTotal = incomeCents - expenseCents;

  const formatCurrency = (cents) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(
      (cents ?? 0) / 100
    );

  const handleExport = async () => {
    setExporting(true);
    try {
      const result = await api.export.transactionsCsv(filters);
      if (!result?.canceled && result?.success) {
        setError(null);
      }
    } catch (err) {
      setError(err?.message ?? 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const openPaymentModal = ({ memberId, orgId: modalOrgId, type }) => {
    setPaymentModalContext({
      memberId: memberId ?? null,
      orgId: modalOrgId ?? orgId ?? 1,
      type: type || 'DONATION',
    });
  };

  const getPaymentBadge = (txn) => {
    const method = String(txn?.payment_method || '').toUpperCase();
    const methodStyles = {
      STRIPE: 'bg-blue-100 text-blue-700',
      ZELLE: 'bg-amber-100 text-amber-700',
      CASHAPP: 'bg-emerald-100 text-emerald-700',
      VENMO: 'bg-emerald-100 text-emerald-700',
      CASH: 'bg-slate-100 text-slate-700',
      CHECK: 'bg-slate-100 text-slate-700',
      OTHER: 'bg-slate-100 text-slate-700',
      IMPORT: 'bg-purple-100 text-purple-700',
    };
    if (methodStyles[method]) {
      const label = method === 'CASHAPP' ? 'Cash App' : method;
      return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium mr-2 ${methodStyles[method]}`}>{label}</span>;
    }
    const lower = String(txn?.note || '').toLowerCase();
    if (lower.includes('stripe')) {
      return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700 mr-2">Online Payment</span>;
    }
    if (lower.includes('manual')) {
      return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 mr-2">Manual Payment</span>;
    }
    return null;
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Financials (Ledger)</h2>
          <p className="text-slate-600 mt-1">Track income and expenses. Export to CSV.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            <Download size={20} />
            Export CSV
          </button>
          {currentRole === 'Admin' && transactions.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setEmailReportModal({
                  reportType: 'org_financial',
                  params: { startDate: filters.startDate, endDate: filters.endDate },
                  subject: orgName + ' – Financial Report (' + filters.startDate + ' to ' + filters.endDate + ')',
                  body: 'Attached is the financial report for ' + filters.startDate + ' to ' + filters.endDate + ' from ' + orgName + '.',
                  attachmentName: 'Financial_Report_' + filters.startDate + '_' + filters.endDate + '.pdf',
                });
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700"
            >
              <Send size={20} />
              Email Report
            </button>
          )}
          <button
            type="button"
            onClick={() => openPaymentModal({ memberId: null, orgId, type: 'DUES' })}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700"
          >
            <Plus size={20} />
            Add Transaction
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="rounded-xl border-2 border-emerald-200 bg-emerald-500/10 p-4">
          <p className="text-sm font-semibold text-slate-600">Income</p>
          <p className="text-2xl font-bold text-slate-800">{formatCurrency(incomeCents)}</p>
        </div>
        <div className="rounded-xl border-2 border-amber-200 bg-amber-500/10 p-4">
          <p className="text-sm font-semibold text-slate-600">Expenses</p>
          <p className="text-2xl font-bold text-slate-800">{formatCurrency(expenseCents)}</p>
        </div>
        <div className="rounded-xl border-2 border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-600">Net</p>
          <p className={`text-2xl font-bold ${runningTotal >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
            {formatCurrency(runningTotal)}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 mb-6">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Start</label>
          <input
            type="date"
            value={filters.startDate}
            onChange={(e) => setFilters((f) => ({ ...f, startDate: e.target.value }))}
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">End</label>
          <input
            type="date"
            value={filters.endDate}
            onChange={(e) => setFilters((f) => ({ ...f, endDate: e.target.value }))}
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Transaction Type</label>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm"
          >
            <option value="">All</option>
            <option value="DUES">Dues</option>
            <option value="DONATION">Donations</option>
            <option value="CAMPAIGN_CONTRIBUTION">Campaign Contributions</option>
            <option value="EVENT_REVENUE">Event Revenue</option>
            <option value="OTHER_INCOME">Other Income</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="text-slate-500 py-12 text-center">Loading…</div>
      ) : transactions.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <DollarSign className="mx-auto h-12 w-12 text-slate-300" />
          <p className="mt-4 text-slate-500">No transactions in this range.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80">
                <th className="text-left text-xs font-semibold uppercase text-slate-600 px-6 py-4">Date</th>
                <th className="text-left text-xs font-semibold uppercase text-slate-600 px-6 py-4">Type</th>
                <th className="text-left text-xs font-semibold uppercase text-slate-600 px-6 py-4">Contributor</th>
                <th className="text-right text-xs font-semibold uppercase text-slate-600 px-6 py-4">Amount</th>
                <th className="text-left text-xs font-semibold uppercase text-slate-600 px-6 py-4">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {transactions.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50/50">
                  <td className="px-6 py-4 text-slate-900">{t.occurred_on}</td>
                  <td className="px-6 py-4">
                    <span>{typeLabel(t)}</span>
                  </td>
                  <td className="px-6 py-4 text-slate-600">{contributorLabel(t)}</td>
                  <td className={`px-6 py-4 text-right font-medium ${t.amount_cents >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                    {formatCurrency(t.amount_cents)}
                  </td>
                  <td className="px-6 py-4 text-slate-600">
                    {getPaymentBadge(t)}
                    {t.note ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Email Report Modal */}
      <EmailReportModal
        open={!!emailReportModal}
        onClose={() => setEmailReportModal(null)}
        reportType={emailReportModal?.reportType}
        reportParams={emailReportModal?.params}
        defaultTo=""
        defaultSubject={emailReportModal?.subject || ''}
        defaultBody={emailReportModal?.body || ''}
        attachmentName={emailReportModal?.attachmentName || 'Financial_Report.pdf'}
        memberStatus={null}
        auditAction="EMAIL_FINANCIAL_REPORT_SENT"
        auditEntityType="report"
        auditEntityId={null}
        auditMetadata={{ dateRange: filters.startDate + ' to ' + filters.endDate }}
      />

      <PaymentModal
        open={!!paymentModalContext}
        onClose={() => setPaymentModalContext(null)}
        context={paymentModalContext}
        members={members}
        allowMemberSelection
        onSuccess={() => {
          emitInvalidation(['transactions', 'dashboard', 'dues', 'reports']);
          loadData();
        }}
      />
    </div>
  );
}
