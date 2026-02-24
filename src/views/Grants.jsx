import { useState, useEffect } from 'react';
import {
  Plus,
  Search,
  Award,
  ArrowUpDown,
  RotateCcw,
  Archive,
  AlertTriangle,
} from 'lucide-react';

const api = window.civicflow;

const STATUS_COLORS = {
  Draft: 'bg-slate-100 text-slate-700',
  Submitted: 'bg-blue-100 text-blue-700',
  Awarded: 'bg-emerald-100 text-emerald-700',
  Denied: 'bg-red-100 text-red-700',
  Closed: 'bg-slate-200 text-slate-600',
};

function formatCurrency(amount) {
  if (amount === null || amount === undefined) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function isOverdue(dateStr) {
  if (!dateStr) return false;
  try {
    const date = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date < today;
  } catch {
    return false;
  }
}

export function Grants({ onNavigate }) {
  const [currentRole, setCurrentRole] = useState('Admin');
  const [grants, setGrants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [showSample, setShowSample] = useState(false);
  const [sortBy, setSortBy] = useState('grant_name');
  const [sortDir, setSortDir] = useState('asc');
  const [featureEnabled, setFeatureEnabled] = useState(true);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [summary, setSummary] = useState({ total_grants_received_cents: 0, total_grants_used_cents: 0 });

  useEffect(() => {
    api?.roles?.getCurrent?.().then((r) => {
      if (r?.role) setCurrentRole(r.role);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (featureEnabled === false) return;
    loadGrants();
  }, [sortBy, sortDir, showArchived, showSample, featureEnabled]);

  useEffect(() => {
    if (featureEnabled === false) return;
    loadSummary();
    const handler = (e) => {
      const keys = Array.isArray(e?.detail) ? e.detail : [];
      if (keys.includes('transactions') || keys.includes('reports')) {
        loadSummary();
      }
    };
    window.addEventListener('civicflow:invalidate', handler);
    return () => window.removeEventListener('civicflow:invalidate', handler);
  }, [featureEnabled]);

  const loadGrants = async () => {
    setLoading(true);
    try {
      const data = await api?.grants?.list?.({
        sortBy,
        sortDir,
        includeArchived: showArchived,
        includeSample: showSample,
      });
      setGrants(data ?? []);
    } catch (err) {
      console.error('Failed to load grants:', err);
      setGrants([]);
    } finally {
      setLoading(false);
    }
  };

  const loadSummary = async () => {
    try {
      const data = await api?.grants?.summary?.();
      if (data) setSummary(data);
    } catch (err) {
      console.error('Failed to load grant summary:', err);
      setSummary({ total_grants_received_cents: 0, total_grants_used_cents: 0 });
    }
  };

  const handleArchive = async (id) => {
    await api?.grants?.archive?.(id);
    loadGrants();
  };

  const handleRestore = async (id) => {
    await api?.grants?.restore?.(id);
    loadGrants();
  };

  const filteredGrants = grants.filter((g) => {
    const q = search.toLowerCase();
    return (
      (g.grant_name || '').toLowerCase().includes(q) ||
      (g.funder_name || '').toLowerCase().includes(q) ||
      (g.status || '').toLowerCase().includes(q)
    );
  });

  if (currentRole !== 'Admin') {
    return (
      <div className="p-6">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center max-w-lg mx-auto">
          <AlertTriangle className="h-10 w-10 text-amber-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-900 mb-2">Access Denied</h2>
          <p className="text-slate-600">You do not have permission to view this section.</p>
        </div>
      </div>
    );
  }

  // Upgrade prompt modal
  if (showUpgradeModal && featureEnabled === false) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md text-center">
          <div className="h-16 w-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Award className="h-8 w-8 text-amber-600" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Grants Module</h2>
          <p className="text-slate-600 mb-6">
            Track grants, funding requests, and reporting deadlines with the CivicFlow Grants upgrade.
          </p>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-2 text-amber-700">
              <AlertTriangle className="h-5 w-5" />
              <span className="font-medium">Upgrade Required</span>
            </div>
            <p className="text-sm text-amber-600 mt-1">
              Grants are available in the CivicFlow Upgrade. Contact support to upgrade your license.
            </p>
          </div>
          <button
            onClick={() => onNavigate('settings')}
            className="w-full px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-medium"
          >
            Go to Settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Grants</h1>
          <p className="text-slate-500 mt-1">Track funding requests, awards, and reporting deadlines</p>
        </div>
        <button
          onClick={() => onNavigate('grant-detail', { grantId: null })}
          className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-medium shadow-sm"
        >
          <Plus className="h-5 w-5" />
          Add Grant
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="rounded-xl border-2 border-emerald-200 bg-emerald-500/10 p-4">
          <p className="text-sm font-semibold text-slate-600">Total Grants Received</p>
          <p className="text-2xl font-bold text-slate-800">{formatCurrency(summary.total_grants_received_cents / 100)}</p>
        </div>
        <div className="rounded-xl border-2 border-amber-200 bg-amber-500/10 p-4">
          <p className="text-sm font-semibold text-slate-600">Total Grants Used</p>
          <p className="text-2xl font-bold text-slate-800">{formatCurrency(Math.abs(summary.total_grants_used_cents) / 100)}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-6">
        <div className="flex flex-wrap items-center gap-4">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search grants..."
              className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            />
          </div>

          {/* Sort */}
          <div className="flex items-center gap-2">
            <ArrowUpDown className="h-4 w-4 text-slate-400" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500"
            >
              <option value="grant_name">Name</option>
              <option value="funder_name">Funder</option>
              <option value="status">Status</option>
              <option value="amount_awarded">Amount</option>
              <option value="reporting_due_date">Due Date</option>
              <option value="created_at">Created</option>
            </select>
            <select
              value={sortDir}
              onChange={(e) => setSortDir(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500"
            >
              <option value="asc">A→Z</option>
              <option value="desc">Z→A</option>
            </select>
          </div>

          {/* Toggles */}
          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            />
            Show archived
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={showSample}
              onChange={(e) => setShowSample(e.target.checked)}
              className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            />
            Show sample
          </label>
        </div>
      </div>

      {/* Grants Table */}
      {loading ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
          <p className="text-slate-500">Loading grants...</p>
        </div>
      ) : filteredGrants.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
          <Award className="h-12 w-12 text-slate-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-900 mb-2">No grants found</h3>
          <p className="text-slate-500 mb-4">
            {search ? 'Try adjusting your search.' : 'Get started by adding your first grant.'}
          </p>
          {!search && (
            <button
              onClick={() => onNavigate('grant-detail', { grantId: null })}
              className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-medium"
            >
              <Plus className="h-4 w-4" />
              Add Grant
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 text-sm font-semibold text-slate-700">Grant Name</th>
                <th className="text-left px-4 py-3 text-sm font-semibold text-slate-700">Funder</th>
                <th className="text-left px-4 py-3 text-sm font-semibold text-slate-700">Status</th>
                <th className="text-right px-4 py-3 text-sm font-semibold text-slate-700">Amount Awarded</th>
                <th className="text-left px-4 py-3 text-sm font-semibold text-slate-700">Reporting Due</th>
                <th className="text-right px-4 py-3 text-sm font-semibold text-slate-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredGrants.map((grant) => {
                const overdue = grant.status === 'Awarded' && isOverdue(grant.reporting_due_date);
                return (
                  <tr
                    key={grant.id}
                    className={`hover:bg-slate-50 cursor-pointer ${grant.archived ? 'opacity-60' : ''}`}
                    onClick={() => onNavigate('grant-detail', { grantId: grant.id })}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-900">{grant.grant_name}</span>
                        {grant.is_sample === 1 && (
                          <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-500 rounded">Sample</span>
                        )}
                        {grant.archived === 1 && (
                          <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-500 rounded">Archived</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{grant.funder_name || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[grant.status] || STATUS_COLORS.Draft}`}>
                        {grant.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-slate-900">
                      {formatCurrency(grant.amount_awarded)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={overdue ? 'text-red-600 font-medium' : 'text-slate-600'}>
                        {formatDate(grant.reporting_due_date)}
                        {overdue && <span className="ml-1 text-xs">(Overdue)</span>}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          grant.archived ? handleRestore(grant.id) : handleArchive(grant.id);
                        }}
                        className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                          grant.archived
                            ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                            : 'text-slate-700 bg-slate-100 hover:bg-slate-200'
                        }`}
                        title={grant.archived ? 'Restore' : 'Archive'}
                      >
                        {grant.archived ? (
                          <>
                            <RotateCcw className="h-3.5 w-3.5" />
                            Restore
                          </>
                        ) : (
                          <>
                            <Archive className="h-3.5 w-3.5" />
                            Archive
                          </>
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
