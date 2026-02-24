import { useState, useEffect } from 'react';
import { Target, Plus, X, Pencil } from 'lucide-react';

const api = window.civicflow;

export function Campaigns({ onNavigate }) {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({ name: '', startDate: '', endDate: '', notes: '', goalAmountCents: '' });

  const loadCampaigns = async () => {
    if (!window.civicflow?.campaigns?.list) {
      console.error("campaign API not available");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await window.civicflow.campaigns.list();
      setCampaigns(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.message ?? 'Failed to load campaigns');
      setCampaigns([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCampaigns();
  }, []);

  const goalCents = Math.round(parseFloat(formData.goalAmountCents || 0) * 100) || 0;

  const handleSubmit = (e) => {
    e.preventDefault();
    const payload = {
      name: formData.name.trim(),
      start_date: formData.startDate || null,
      end_date: formData.endDate || null,
      notes: formData.notes || null,
      goal_amount_cents: goalCents,
    };
    const promise = editingId
      ? api.campaigns.update(editingId, payload)
      : api.campaigns.create(payload);
    promise
      .then((result) => {
        if (result && typeof result === 'object' && result.ok === false) {
          setError(result.error ?? 'Failed to save campaign');
          return;
        }
        setShowModal(false);
        setEditingId(null);
        setFormData({ name: '', startDate: '', endDate: '', notes: '', goalAmountCents: '' });
        loadCampaigns();
      })
      .catch((err) => setError(err?.message ?? 'Failed to save campaign'));
  };

  const openEdit = (c) => {
    setEditingId(c.id);
    setFormData({
      name: c.name ?? '',
      startDate: c.start_date ?? '',
      endDate: c.end_date ?? '',
      notes: c.notes ?? '',
      goalAmountCents: (c.goal_amount_cents ?? 0) / 100 ? String((c.goal_amount_cents ?? 0) / 100) : '',
    });
    setShowModal(true);
  };

  const formatDate = (d) => {
    if (!d) return '—';
    try {
      return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return d;
    }
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Campaigns</h2>
          <p className="text-slate-600 mt-1">Track campaigns and initiatives.</p>
        </div>
        <button
          type="button"
          onClick={() => { setEditingId(null); setFormData({ name: '', startDate: '', endDate: '', notes: '', goalAmountCents: '' }); setShowModal(true); }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700"
        >
          <Plus size={20} />
          Add Campaign
        </button>
      </div>

      {error && (
        <div role="alert" className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-slate-500 py-12 text-center">Loading campaigns…</div>
      ) : campaigns.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <Target className="mx-auto h-12 w-12 text-slate-300" />
          <p className="mt-4 text-slate-500">No campaigns yet.</p>
          <button type="button" onClick={() => setShowModal(true)} className="mt-4 px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">
            Add Campaign
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {campaigns.map((c) => {
            const goalC = c.goal_amount_cents ?? 0;
            const raisedC = c.raised_cents ?? 0;
            const pct = c.progress_pct ?? (goalC > 0 ? Math.min(100, Math.round((raisedC / goalC) * 100)) : null);
            const formatCur = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format((n ?? 0) / 100);
            return (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                onClick={() => onNavigate?.('campaign-detail', { campaignId: c.id })}
                onKeyDown={(e) => e.key === 'Enter' && onNavigate?.('campaign-detail', { campaignId: c.id })}
                className="rounded-xl border-2 border-slate-200 bg-white p-6 shadow-sm hover:border-emerald-300 hover:shadow-md transition-all cursor-pointer"
              >
                <div className="flex justify-between items-start">
                  <h3 className="font-semibold text-slate-800">{c.name}</h3>
                  <button type="button" onClick={(ev) => { ev.stopPropagation(); openEdit(c); }} className="p-1 rounded hover:bg-slate-100 text-slate-500" title="Edit">
                    <Pencil size={16} />
                  </button>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  {formatDate(c.start_date)} – {formatDate(c.end_date)}
                </p>
                <div className="mt-3">
                {goalC > 0 ? (
                  <>
                    <div className="flex justify-between text-sm text-slate-600 mb-1">
                      <span>Goal: {formatCur(goalC)}</span>
                      <span>Raised: {formatCur(raisedC)}</span>
                      <span className="font-medium">{pct}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                      <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-slate-500">No goal set</p>
                )}
                </div>
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onNavigate?.('reports', { reportType: 'campaign_contribution', campaignId: c.id });
                    }}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm hover:bg-slate-50"
                  >
                    View Report
                  </button>
                </div>
                {c.notes && <p className="text-sm text-slate-600 mt-2">{c.notes}</p>}
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-slate-800">{editingId ? 'Edit Campaign' : 'Add Campaign'}</h3>
              <button type="button" onClick={() => setShowModal(false)} className="p-1 rounded hover:bg-slate-100">
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Name *</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData((d) => ({ ...d, name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Start Date</label>
                  <input
                    type="date"
                    value={formData.startDate}
                    onChange={(e) => setFormData((d) => ({ ...d, startDate: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">End Date</label>
                  <input
                    type="date"
                    value={formData.endDate}
                    onChange={(e) => setFormData((d) => ({ ...d, endDate: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Goal Amount ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0 = no goal"
                  value={formData.goalAmountCents}
                  onChange={(e) => setFormData((d) => ({ ...d, goalAmountCents: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData((d) => ({ ...d, notes: e.target.value }))}
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 px-4 py-2 rounded-lg border border-slate-300 text-slate-700">
                  Cancel
                </button>
                <button type="submit" className="flex-1 px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700">
                  {editingId ? 'Save' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
