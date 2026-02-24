import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, UserCheck, Trash2, Undo2 } from 'lucide-react';

const api = window.civicflow;

const formatCurrency = (cents) =>
  '$' + ((Number(cents || 0) || 0) / 100).toFixed(2);

const formatTxnType = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) return '—';
  return normalized.replace(/_/g, ' ').toUpperCase();
};

const emitInvalidation = (keys) => {
  if (typeof window === 'undefined') return;
  const detail = Array.isArray(keys) ? keys : [];
  window.dispatchEvent(new CustomEvent('civicflow:invalidate', { detail }));
};

export function DataCleanup() {
  const [currentRole, setCurrentRole] = useState('Admin');
  const [orgId, setOrgId] = useState(1);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [orphans, setOrphans] = useState([]);
  const [members, setMembers] = useState([]);
  const [assignSelections, setAssignSelections] = useState({});
  const [viewFilter, setViewFilter] = useState('all');

  const generalContributionId = useMemo(() => {
    const match = (members || []).find(
      (m) => (m.first_name || '').toLowerCase() === 'general'
        && (m.last_name || '').toLowerCase() === 'contribution'
    );
    return match?.id ?? null;
  }, [members]);

  const isRecoveredRow = (row) => {
    const status = String(row?.attribution_status || '').toUpperCase();
    const previousName = String(row?.previous_contributor_name || '').trim();
    return status === 'GENERAL_CONTRIBUTION' && previousName.length > 0;
  };

  const recoveredCount = useMemo(
    () => (orphans || []).filter((row) => isRecoveredRow(row)).length,
    [orphans]
  );

  const visibleRows = useMemo(() => {
    if (viewFilter === 'recovered') {
      return (orphans || []).filter((row) => isRecoveredRow(row));
    }
    return orphans || [];
  }, [orphans, viewFilter]);

  const loadData = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const org = await api?.organization?.get?.();
      const effectiveOrgId = org?.id ?? orgId;
      if (org?.id) setOrgId(org.id);
      const [orphanRows, memberRows] = await Promise.all([
        api?.admin?.listOrphanTransactions?.({ orgId: effectiveOrgId }),
        api?.members?.list?.(),
      ]);
      const sortedMembers = (memberRows || []).slice().sort((a, b) => {
        const la = (a.last_name || '').toLowerCase();
        const lb = (b.last_name || '').toLowerCase();
        if (la !== lb) return la.localeCompare(lb);
        return (a.first_name || '').toLowerCase().localeCompare((b.first_name || '').toLowerCase());
      });
      setMembers(sortedMembers);
      setOrphans(orphanRows || []);
      const generalId = (sortedMembers || []).find(
        (m) => (m.first_name || '').toLowerCase() === 'general' && (m.last_name || '').toLowerCase() === 'contribution'
      )?.id ?? null;
      if (generalId) {
        const nextSelections = {};
        (orphanRows || []).forEach((t) => {
          nextSelections[t.id] = generalId;
        });
        setAssignSelections(nextSelections);
      }
    } catch (err) {
      setMessage({ type: 'error', text: err?.message || 'Failed to load orphan transactions.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    api?.roles?.getCurrent?.().then((r) => {
      if (r?.role) setCurrentRole(r.role);
    }).catch(() => {});
    api?.organization?.get?.().then((org) => {
      if (org?.id) setOrgId(org.id);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    loadData();
  }, [orgId]);

  const handleAssign = async (txnId) => {
    const memberId = assignSelections[txnId] || generalContributionId;
    if (!memberId) {
      setMessage({ type: 'error', text: 'Select a member to assign.' });
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const result = await api?.admin?.assignOrphanTransaction?.(txnId, memberId);
      if (result?.error) throw new Error(result.error);
      setMessage({ type: 'success', text: 'Transaction reassigned.' });
      emitInvalidation(['transactions', 'dashboard', 'dues', 'reports']);
      await loadData();
    } catch (err) {
      setMessage({ type: 'error', text: err?.message || 'Failed to assign transaction.' });
      setLoading(false);
    }
  };

  const handleReverse = async (txnId) => {
    const reason = window.prompt('Reason for reversal (min 5 characters):');
    if (!reason) return;
    if (reason.trim().length < 5) {
      setMessage({ type: 'error', text: 'Reason must be at least 5 characters.' });
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const result = await api?.financeTxns?.reverse?.(txnId, reason.trim());
      if (result?.error) throw new Error(result.error);
      setMessage({ type: 'success', text: 'Transaction reversed.' });
      emitInvalidation(['transactions', 'dashboard', 'dues', 'reports']);
      await loadData();
    } catch (err) {
      setMessage({ type: 'error', text: err?.message || 'Failed to reverse transaction.' });
      setLoading(false);
    }
  };

  const handleDelete = async (txnId) => {
    if (!confirm('Delete this transaction? This is a soft delete.')) return;
    setLoading(true);
    setMessage(null);
    try {
      const result = await api?.financeTxns?.delete?.(txnId, 'Admin');
      if (result?.error) throw new Error(result.error);
      setMessage({ type: 'success', text: 'Transaction deleted.' });
      emitInvalidation(['transactions', 'dashboard', 'dues', 'reports']);
      await loadData();
    } catch (err) {
      setMessage({ type: 'error', text: err?.message || 'Failed to delete transaction.' });
      setLoading(false);
    }
  };

  if (currentRole !== 'Admin') {
    return (
      <div className="p-8">
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-xl font-semibold text-slate-800">Data Cleanup</h2>
          <p className="text-slate-600 mt-2">Admin access required.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Data Cleanup</h2>
          <p className="text-slate-600 mt-1">Review orphaned and General Contribution-attributed transactions, and recover prior contributor names when available.</p>
        </div>
        <button
          onClick={loadData}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
          disabled={loading}
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      {message && (
        <div
          role="alert"
          className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
            message.type === 'error'
              ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">Orphan / Reattributed Transactions</h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setViewFilter('all')}
              className={`px-3 py-1 rounded-md text-xs font-medium border ${viewFilter === 'all' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
            >
              All ({orphans.length})
            </button>
            <button
              type="button"
              onClick={() => setViewFilter('recovered')}
              className={`px-3 py-1 rounded-md text-xs font-medium border ${viewFilter === 'recovered' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
            >
              Recovered ({recoveredCount})
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-6 text-slate-500">Loading…</div>
        ) : visibleRows.length === 0 ? (
          <div className="p-6 text-slate-500">
            {viewFilter === 'recovered'
              ? 'No recovered transactions found in this view.'
              : 'No orphan or General Contribution-attributed transactions found.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Date</th>
                  <th className="px-4 py-3 text-left font-semibold">Type</th>
                  <th className="px-4 py-3 text-right font-semibold">Amount</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                  <th className="px-4 py-3 text-left font-semibold">Current Attribution</th>
                  <th className="px-4 py-3 text-left font-semibold">Previous Contributor</th>
                  <th className="px-4 py-3 text-left font-semibold">Assign Member</th>
                  <th className="px-4 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleRows.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-700">{t.occurred_on || '—'}</td>
                    <td className="px-4 py-3 text-slate-700">{formatTxnType(t.transaction_type || t.type)}</td>
                    <td className="px-4 py-3 text-right font-medium text-slate-800">{formatCurrency(t.amount_cents)}</td>
                    <td className="px-4 py-3 text-slate-700">{t.status || 'COMPLETED'}</td>
                    <td className="px-4 py-3 text-slate-700">
                      <div className="flex items-center gap-2">
                        <span>
                          {t.attribution_status === 'GENERAL_CONTRIBUTION'
                            ? 'General Contribution'
                            : t.attribution_status === 'ORPHAN'
                              ? 'Orphan / Missing Member'
                              : ((`${t.last_name || ''}, ${t.first_name || ''}`).trim().replace(/^,\s*/, '') || 'Assigned')}
                        </span>
                        {isRecoveredRow(t) && (
                          <span className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                            Recovered from deleted member
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {(t.previous_contributor_name || '').trim() || (t.contributor_name || '').trim() || t.note || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        className="w-48 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                        value={assignSelections[t.id] ?? generalContributionId ?? ''}
                        onChange={(e) => setAssignSelections((prev) => ({ ...prev, [t.id]: Number(e.target.value) || '' }))}
                      >
                        <option value="">Select member…</option>
                        {members.map((m) => (
                          <option key={m.id} value={m.id}>
                            {(m.last_name || '').trim()}, {(m.first_name || '').trim()}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleAssign(t.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
                        >
                          <UserCheck size={14} />
                          Assign
                        </button>
                        <button
                          onClick={() => handleReverse(t.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-50"
                        >
                          <Undo2 size={14} />
                          Reverse
                        </button>
                        <button
                          onClick={() => handleDelete(t.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-300 text-red-700 hover:bg-red-50"
                        >
                          <Trash2 size={14} />
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
