import { useState, useEffect } from 'react';
import { ArrowLeft, Calendar, Plus, MapPin, Receipt } from 'lucide-react';
import PaymentModal from '../components/PaymentModal';

const api = window.civicflow;
const emitInvalidation = (keys) => {
  if (typeof window === 'undefined') return;
  const detail = Array.isArray(keys) ? keys : [];
  window.dispatchEvent(new CustomEvent('civicflow:invalidate', { detail }));
};

export function EventDetail({ eventId, onNavigate }) {
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [members, setMembers] = useState([]);
  const [organizationId, setOrganizationId] = useState(1);
  const [paymentModalContext, setPaymentModalContext] = useState(null);
  const [receiptGeneratingId, setReceiptGeneratingId] = useState(null);
  const [reportRows, setReportRows] = useState([]);

  const loadEvent = () => {
    if (!eventId) return;
    setLoading(true);
    setError(null);
    Promise.allSettled([
      api.events?.getDetails?.(eventId),
      api.reports?.eventSummary?.(eventId),
    ])
      .then(([detailResult, summaryResult]) => {
        if (detailResult.status === 'fulfilled') {
          setEvent(detailResult.value);
        } else {
          setEvent(null);
          setError(detailResult.reason?.message ?? 'Failed to load event');
        }
        setReportRows(summaryResult.status === 'fulfilled' && Array.isArray(summaryResult.value) ? summaryResult.value : []);
      })
      .catch((err) => {
        setError(err?.message ?? 'Failed to load event');
        setEvent(null);
        setReportRows([]);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadEvent();
  }, [eventId]);

  useEffect(() => {
    api.members?.list?.().then((m) => setMembers(Array.isArray(m) ? m : [])).catch(() => {});
    api.organization?.get?.().then((org) => {
      if (org?.id) setOrganizationId(org.id);
    }).catch(() => {});
  }, []);

  const openPaymentModal = ({ memberId, orgId, type, campaignId, eventId: selectedEventId, transactionId, mode }) => {
    setPaymentModalContext({
      memberId: memberId ?? null,
      orgId: orgId ?? organizationId ?? 1,
      type: type || 'EVENT_REVENUE',
      transaction_type: type || 'EVENT_REVENUE',
      campaignId: campaignId ?? null,
      eventId: selectedEventId ?? eventId ?? null,
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
        <p className="text-slate-500">Loading event…</p>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="p-8">
        <button
          type="button"
          onClick={() => onNavigate?.('events')}
          className="flex items-center gap-2 text-slate-600 hover:text-slate-800 mb-4"
        >
          <ArrowLeft size={20} />
          Back to Events
        </button>
        <p className="text-slate-500">Event not found.</p>
      </div>
    );
  }

  const paymentRows = reportRows.filter((row) => row.payment_method || row.transaction_type);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <button
          type="button"
          onClick={() => onNavigate?.('events')}
          className="flex items-center gap-2 text-slate-600 hover:text-slate-800"
        >
          <ArrowLeft size={20} />
          Back to Events
        </button>
      </div>

      {error && (
        <div role="alert" className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800">
          {error}
        </div>
      )}

      <div className="rounded-xl border-2 border-slate-200 bg-white p-6 shadow-sm mb-6">
        <div className="flex justify-between items-start">
          <div className="flex gap-4">
            <div className="shrink-0 w-14 h-14 rounded-lg bg-sky-100 flex items-center justify-center">
              <Calendar className="h-7 w-7 text-sky-600" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-slate-800">{event.name}</h2>
              <p className="text-sm text-slate-600 mt-1">{formatDate(event.date)}</p>
              {event.location && (
                <p className="text-sm text-slate-500 mt-1 flex items-center gap-1">
                  <MapPin size={14} />
                  {event.location}
                </p>
              )}
              <p className="text-lg font-semibold text-emerald-700 mt-3">
                Total raised: {formatCurrency(event.raised_cents)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onNavigate?.('reports', { reportType: 'event_contribution', eventId })}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-medium hover:bg-slate-50"
            >
              View Report
            </button>
            <button
              type="button"
              onClick={() => openPaymentModal({ memberId: null, orgId: organizationId, type: 'EVENT_REVENUE', campaignId: null, eventId })}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700"
            >
              <Plus size={20} />
              Add Contribution
            </button>
          </div>
        </div>

        {event.notes && <p className="text-sm text-slate-600 mt-4">{event.notes}</p>}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-800 mb-4">Contributions</h3>
        {!event.contributions?.length ? (
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
            {event.contributions.map((c) => (
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
                    onClick={() => openPaymentModal({ transactionId: c.id, eventId: event.id, mode: 'edit' })}
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

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm mt-6">
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

      <PaymentModal
        open={!!paymentModalContext}
        onClose={() => setPaymentModalContext(null)}
        context={paymentModalContext}
        members={members}
        allowMemberSelection
        onSuccess={() => {
          emitInvalidation(['transactions', 'dashboard', 'dues', 'reports']);
          loadEvent();
        }}
      />
    </div>
  );
}
