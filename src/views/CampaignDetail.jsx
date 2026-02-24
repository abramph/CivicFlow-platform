import { useState, useEffect } from 'react';
import { ArrowLeft, Target, Plus, Receipt } from 'lucide-react';
import PaymentModal from '../components/PaymentModal';

const api = window.civicflow;
const emitInvalidation = (keys) => {
  if (typeof window === 'undefined') return;
  const detail = Array.isArray(keys) ? keys : [];
  window.dispatchEvent(new CustomEvent('civicflow:invalidate', { detail }));
};

export function CampaignDetail({ campaignId, onNavigate }) {
  const [campaign, setCampaign] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [members, setMembers] = useState([]);
  const [organizationId, setOrganizationId] = useState(1);
  const [paymentModalContext, setPaymentModalContext] = useState(null);
  const [receiptGeneratingId, setReceiptGeneratingId] = useState(null);
  const [reportRows, setReportRows] = useState([]);
  const [topMembers, setTopMembers] = useState([]);

  const loadCampaign = () => {
    if (!campaignId) return;
    setLoading(true);
    setError(null);
    Promise.allSettled([
      api.campaigns?.getDetails?.(campaignId),
      api.reports?.campaignSummary?.(campaignId),
      api.reports?.campaignTopMembers?.(campaignId),
    ])
      .then(([detailResult, summaryResult, topResult]) => {
        if (detailResult.status === 'fulfilled') {
          setCampaign(detailResult.value);
        } else {
          setCampaign(null);
          setError(detailResult.reason?.message ?? 'Failed to load campaign');
        }
        setReportRows(summaryResult.status === 'fulfilled' && Array.isArray(summaryResult.value) ? summaryResult.value : []);
        setTopMembers(topResult.status === 'fulfilled' && Array.isArray(topResult.value) ? topResult.value : []);
      })
      .catch((err) => {
        setError(err?.message ?? 'Failed to load campaign');
        setCampaign(null);
        setReportRows([]);
        setTopMembers([]);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadCampaign();
  }, [campaignId]);

  useEffect(() => {
    api.members?.list?.().then((m) => setMembers(Array.isArray(m) ? m : [])).catch(() => {});
    api.organization?.get?.().then((org) => {
      if (org?.id) setOrganizationId(org.id);
    }).catch(() => {});
  }, []);

  const openPaymentModal = ({ memberId, orgId, type, campaignId: selectedCampaignId, eventId: selectedEventId, transactionId, mode }) => {
    setPaymentModalContext({
      memberId: memberId ?? null,
      orgId: orgId ?? organizationId ?? 1,
      type: type || 'CAMPAIGN_CONTRIBUTION',
      transaction_type: type || 'CAMPAIGN_CONTRIBUTION',
      campaignId: selectedCampaignId ?? campaignId ?? null,
      eventId: selectedEventId ?? null,
      transactionId: transactionId ?? null,
      mode: mode ?? 'create',
    });
  };

  const handleReceipt = async (txnId) => {
    setReceiptGeneratingId(txnId);
    try {
      const result = await api.receipt?.savePdfDialog?.(txnId);
      if (result?.ok) {
        // success
      } else if (result?.canceled) {
        // user cancelled
      } else {
        setError(result?.error ?? 'Failed to generate receipt');
      }
    } catch (err) {
      setError(err?.message ?? 'Failed to generate receipt');
    } finally {
      setReceiptGeneratingId(null);
    }
  };

  const formatCurrency = (cents) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format((cents ?? 0) / 100);
  const formatDate = (d) => {
    if (!d) return '—';
    try {
      return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return d;
    }
  };

  if (loading) {
    return (
      <div className="p-8">
        <p className="text-slate-500">Loading campaign…</p>
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="p-8">
        <button
          type="button"
          onClick={() => onNavigate?.('campaigns')}
          className="flex items-center gap-2 text-slate-600 hover:text-slate-800 mb-4"
        >
          <ArrowLeft size={20} />
          Back to Campaigns
        </button>
        <p className="text-slate-500">Campaign not found.</p>
      </div>
    );
  }

  const goalCents = campaign.goal_amount_cents ?? 0;
  const raisedCents = campaign.raised_cents ?? 0;
  const pct = goalCents > 0 ? Math.min(100, Math.round((raisedCents / goalCents) * 100)) : 0;
  const paymentRows = reportRows.filter((row) => row.payment_method || row.transaction_type);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <button
          type="button"
          onClick={() => onNavigate?.('campaigns')}
          className="flex items-center gap-2 text-slate-600 hover:text-slate-800"
        >
          <ArrowLeft size={20} />
          Back to Campaigns
        </button>
      </div>

      {error && (
        <div role="alert" className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800">
          {error}
        </div>
      )}

      <div className="rounded-xl border-2 border-slate-200 bg-white p-6 shadow-sm mb-6">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
              <Target className="h-8 w-8 text-emerald-600" />
              {campaign.name}
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              {formatDate(campaign.start_date)} – {formatDate(campaign.end_date)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onNavigate?.('reports', { reportType: 'campaign_contribution', campaignId })}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-medium hover:bg-slate-50"
            >
              View Report
            </button>
            <button
              type="button"
              onClick={() => openPaymentModal({ memberId: null, orgId: organizationId, type: 'CAMPAIGN_CONTRIBUTION', campaignId, eventId: null })}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700"
            >
              <Plus size={20} />
              Add Contribution
            </button>
          </div>
        </div>

        <div className="mt-6">
          <div className="flex justify-between text-sm text-slate-600 mb-2">
            <span>Goal: {goalCents > 0 ? formatCurrency(goalCents) : 'No goal'}</span>
            <span>Raised: {formatCurrency(raisedCents)}</span>
            {goalCents > 0 && <span className="font-medium">{pct}%</span>}
          </div>
          {goalCents > 0 && (
            <div className="h-3 rounded-full bg-slate-200 overflow-hidden">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>

        {campaign.notes && <p className="text-sm text-slate-600 mt-4">{campaign.notes}</p>}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-800 mb-4">Contributions</h3>
        {!campaign.contributions?.length ? (
          <p className="text-slate-500">No contributions yet. Add one above.</p>
        ) : (
          <div className="space-y-3">
            <div className="hidden md:grid md:grid-cols-6 gap-2 pb-2 border-b border-slate-100 text-xs font-semibold uppercase text-slate-500">
              <div className="md:col-span-2">Contributor</div>
              <div>Type</div>
              <div>Method</div>
              <div className="text-right">Amount</div>
              <div className="text-right">Actions</div>
            </div>
            {campaign.contributions.map((c) => (
              <div key={c.id} className="grid grid-cols-1 gap-2 py-2 border-b border-slate-100 last:border-0 md:grid-cols-6 md:items-center">
                <div className="md:col-span-2">
                  <div className="font-medium text-slate-800">{c.display_name || 'Unknown'}</div>
                  <div className="text-sm text-slate-500">{formatDate(c.occurred_on)}</div>
                </div>
                <div className="text-sm text-slate-600">{String(c.transaction_type || c.type || '').toUpperCase() || '—'}</div>
                <div className="text-sm text-slate-600">{(c.payment_method || 'OTHER').toString().toUpperCase()}</div>
                <div className="text-sm font-medium text-emerald-700 md:text-right">{formatCurrency(c.amount_cents)}</div>
                <div className="flex items-center gap-2 md:justify-end">
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => openPaymentModal({ transactionId: c.id, campaignId: campaign.id, mode: 'edit' })}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleReceipt(c.id)}
                    disabled={receiptGeneratingId === c.id}
                    className="p-1.5 rounded hover:bg-slate-100 text-slate-600"
                    title="Generate receipt"
                  >
                    <Receipt size={18} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 mt-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-800 mb-4">Payment Method Breakdown</h3>
          {paymentRows.length === 0 ? (
            <p className="text-slate-500">No payment data yet.</p>
          ) : (
            <div className="space-y-2">
              {paymentRows.map((row, idx) => (
                <div key={`${row.payment_method}-${row.transaction_type}-${idx}`} className="flex items-center justify-between text-sm">
                  <div className="text-slate-600">
                    {(row.payment_method || 'OTHER').toString().toUpperCase()} · {(row.transaction_type || '').toString().toUpperCase()}
                  </div>
                  <div className="font-medium text-slate-800">
                    {formatCurrency(row.total_cents)} ({row.transaction_count})
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-800 mb-4">Top Contributors</h3>
          {topMembers.length === 0 ? (
            <p className="text-slate-500">No contributors yet.</p>
          ) : (
            <div className="space-y-2">
              {topMembers.map((row, idx) => {
                const name = row.member_id
                  ? [row.first_name, row.last_name].filter(Boolean).join(' ') || `Member #${row.member_id}`
                  : 'Non-member';
                return (
                  <div key={`${row.member_id ?? 'none'}-${idx}`} className="flex items-center justify-between text-sm">
                    <span className="text-slate-700">{name}</span>
                    <span className="font-medium text-emerald-700">{formatCurrency(row.total_cents)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <PaymentModal
        open={!!paymentModalContext}
        onClose={() => setPaymentModalContext(null)}
        context={paymentModalContext}
        members={members}
        allowMemberSelection
        onSuccess={() => {
          emitInvalidation(['transactions', 'dashboard', 'dues', 'reports']);
          loadCampaign();
        }}
      />
    </div>
  );
}
