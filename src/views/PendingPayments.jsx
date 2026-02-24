import { useEffect, useState } from 'react';
import { CheckCircle, XCircle, RefreshCcw } from 'lucide-react';

const api = window.civicflow;

const emitInvalidation = (keys) => {
  if (typeof window === 'undefined') return;
  const detail = Array.isArray(keys) ? keys : [];
  window.dispatchEvent(new CustomEvent('civicflow:invalidate', { detail }));
};

const toAppUrl = (filePath) => {
  if (!filePath) return null;
  let normalized = String(filePath).replace(/\\/g, '/');
  if (/^[A-Za-z]\//.test(normalized)) {
    normalized = normalized.replace(/^([A-Za-z])\//, '$1:/');
  }
  return `app://${normalized}`;
};

const formatCurrency = (cents) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(
    (cents ?? 0) / 100
  );

export function PendingPayments() {
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentRole, setCurrentRole] = useState('Admin');
  const [syncing, setSyncing] = useState(false);

  const loadData = () => {
    setLoading(true);
    setError(null);
    api?.payments?.listPendingExternal?.()
      .then((rows) => setPending(Array.isArray(rows) ? rows : []))
      .catch((err) => {
        setError(err?.message || 'Failed to load pending payments.');
        setPending([]);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
    api?.roles?.getCurrent?.().then((r) => {
      if (r?.role) setCurrentRole(r.role);
    }).catch(() => {});
  }, []);

  const handleApprove = async (payment) => {
    if (!confirm('Approve this payment?')) return;
    try {
      const payload = {
        id: payment?.id,
        review_type: payment?.review_type || 'TRANSACTION',
      };
      const result = await api?.payments?.approveExternal?.(payload);
      if (result?.error) throw new Error(result.error);
      emitInvalidation(['transactions', 'dashboard', 'dues', 'reports']);
      loadData();
    } catch (err) {
      setError(err?.message || 'Failed to approve payment.');
    }
  };

  const handleReject = async (payment) => {
    if (!confirm('Reject this payment?')) return;
    const note = prompt('Optional admin note for rejection:', '') || '';
    try {
      const payload = {
        id: payment?.id,
        review_type: payment?.review_type || 'TRANSACTION',
        note,
      };
      const result = await api?.payments?.rejectExternal?.(payload);
      if (result?.error) throw new Error(result.error);
      emitInvalidation(['transactions', 'dashboard', 'dues', 'reports']);
      loadData();
    } catch (err) {
      setError(err?.message || 'Failed to reject payment.');
    }
  };

  const handleSyncFromCloud = async () => {
    setSyncing(true);
    setError(null);
    try {
      const result = await window?.electron?.invoke?.('payments:syncFromCloud');
      if (result?.error || result?.success === false) throw new Error(result?.error || 'Failed to sync cloud payments.');
      const count = Number(result?.count || 0);
      alert(`${count} new payment confirmations imported`);
      loadData();
    } catch (err) {
      setError(err?.message || 'Failed to sync payment confirmations.');
    } finally {
      setSyncing(false);
    }
  };

  if (currentRole !== 'Admin') {
    return (
      <div className="p-8">
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-xl font-semibold text-slate-800">Pending Payments</h2>
          <p className="text-slate-600 mt-2">Admin access required.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Pending Payments</h2>
          <p className="text-slate-600 mt-1">Verify Cash App, Zelle, and Venmo submissions.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadData}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
          >
            <RefreshCcw size={18} />
            Refresh
          </button>
          <button
            type="button"
            onClick={handleSyncFromCloud}
            disabled={syncing}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {syncing ? 'Syncing…' : 'Sync Payment Confirmations'}
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800">
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-6 text-slate-500">Loading…</div>
        ) : pending.length === 0 ? (
          <div className="p-6 text-slate-500">No pending payments.</div>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-6 py-3 text-left font-medium">Member</th>
                  <th className="px-6 py-3 text-right font-medium">Amount</th>
                  <th className="px-6 py-3 text-left font-medium">Method</th>
                  <th className="px-6 py-3 text-left font-medium">Date</th>
                  <th className="px-6 py-3 text-left font-medium">Proof</th>
                  <th className="px-6 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {pending.map((t) => {
                  const memberName = [t.member_first_name, t.member_last_name].filter(Boolean).join(' ') || '—';
                  const proofUrl = toAppUrl(t.proof_url);
                  const method = (t.payment_method || '').toString().toUpperCase() || '—';
                  return (
                    <tr key={`${t.review_type || 'TRANSACTION'}-${t.id}`} className="hover:bg-slate-50">
                      <td className="px-6 py-4 text-slate-800">{memberName}</td>
                      <td className="px-6 py-4 text-right font-medium text-slate-800">{formatCurrency(t.amount_cents)}</td>
                      <td className="px-6 py-4 text-slate-600">{method}</td>
                      <td className="px-6 py-4 text-slate-600">{t.occurred_on}</td>
                      <td className="px-6 py-4">
                        {proofUrl ? (
                          <div className="flex items-center gap-3">
                            <img src={proofUrl} alt="Proof" className="h-10 w-10 rounded object-cover border border-slate-200" />
                            <button
                              type="button"
                              onClick={() => window.open(proofUrl, '_blank')}
                              className="text-sm text-emerald-700 hover:underline"
                            >
                              View
                            </button>
                          </div>
                        ) : (
                          <span className="text-slate-400">None</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleApprove(t)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700"
                          >
                            <CheckCircle size={16} />
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReject(t)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-200 text-red-700 text-sm font-medium hover:bg-red-50"
                          >
                            <XCircle size={16} />
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
