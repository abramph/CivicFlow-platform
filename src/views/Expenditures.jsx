import { useState, useEffect } from 'react';
import { DollarSign, Plus, Edit, Trash2, X, Filter } from 'lucide-react';

const api = window.civicflow;

const emitInvalidation = (keys) => {
  if (typeof window === 'undefined') return;
  const detail = Array.isArray(keys) ? keys : [];
  window.dispatchEvent(new CustomEvent('civicflow:invalidate', { detail }));
};

const CATEGORIES = ['Operations', 'Member Payout', 'Vendor Payment', 'Refund', 'Other'];
const PAYEE_TYPES = ['member', 'vendor'];
const SOURCE_TYPES = ['organization', 'event', 'campaign'];
const STATUS_OPTIONS = ['paid', 'pending', 'cancelled'];

export function Expenditures({ onNavigate }) {
  const [expenditures, setExpenditures] = useState([]);
  const [members, setMembers] = useState([]);
  const [events, setEvents] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  
  // Filters
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    category: '',
    sourceType: '',
    payeeType: '',
    payeeMemberId: '',
  });
  const [showFilters, setShowFilters] = useState(false);
  
  // Form data
  const [formData, setFormData] = useState({
    date: new Date().toISOString().slice(0, 10),
    amount: '',
    category: '',
    description: '',
    payee_type: '',
    payee_member_id: null,
    payee_name: '',
    source_type: 'organization',
    source_id: null,
    payment_method: '',
    status: 'paid',
  });

  const loadData = () => {
    setLoading(true);
    setError(null);
    Promise.all([
      api?.expenditures?.list?.(filters),
      api?.members?.list?.(),
      api?.events?.list?.(),
      api?.campaigns?.list?.(),
    ])
      .then(([expData, membersData, eventsData, campaignsData]) => {
        setExpenditures(Array.isArray(expData) ? expData : []);
        setMembers(Array.isArray(membersData) ? membersData : []);
        setEvents(Array.isArray(eventsData) ? eventsData : []);
        setCampaigns(Array.isArray(campaignsData) ? campaignsData : []);
      })
      .catch((err) => {
        setError(err?.message ?? 'Failed to load expenditures');
        setExpenditures([]);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, [filters]);

  const formatDate = (d) => {
    if (!d) return '—';
    try {
      return new Date(d).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return d;
    }
  };

  const formatCurrency = (amount) => {
    if (amount == null) return '$0.00';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  };

  const getPayeeName = (exp) => {
    if (exp.payee_type === 'member' && exp.payee_member_name) {
      return exp.payee_member_name;
    }
    if (exp.payee_name) {
      return exp.payee_name;
    }
    return '—';
  };

  const getSourceName = (exp) => {
    if (exp.source_type === 'organization') {
      return 'Organization';
    }
    if (exp.source_type === 'event') {
      const event = events.find(e => e.id === exp.source_id);
      return event ? `Event: ${event.name}` : 'Event';
    }
    if (exp.source_type === 'campaign') {
      const campaign = campaigns.find(c => c.id === exp.source_id);
      return campaign ? `Campaign: ${campaign.name}` : 'Campaign';
    }
    return '—';
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const payload = {
      ...formData,
      amount: parseFloat(formData.amount) || 0,
      payee_member_id: formData.payee_type === 'member' ? (formData.payee_member_id || null) : null,
      payee_name: formData.payee_type === 'vendor' ? formData.payee_name : null,
      source_id: formData.source_type === 'organization' ? null : (formData.source_id || null),
    };

    const promise = editingId
      ? api?.expenditures?.update?.(editingId, payload)
      : api?.expenditures?.create?.(payload);

    promise
      .then((result) => {
        if (result?.error) {
          setError(result.error);
          return;
        }
        setShowForm(false);
        setEditingId(null);
        setFormData({
          date: new Date().toISOString().slice(0, 10),
          amount: '',
          category: '',
          description: '',
          payee_type: '',
          payee_member_id: null,
          payee_name: '',
          source_type: 'organization',
          source_id: null,
          payment_method: '',
          status: 'paid',
        });
        emitInvalidation(['expenditures', 'dashboard', 'transactions', 'reports']);
        loadData();
      })
      .catch((err) => setError(err?.message ?? 'Failed to save expenditure'));
  };

  const handleEdit = (exp) => {
    setEditingId(exp.id);
    setFormData({
      date: exp.date || new Date().toISOString().slice(0, 10),
      amount: exp.amount || '',
      category: exp.category || '',
      description: exp.description || '',
      payee_type: exp.payee_type || '',
      payee_member_id: exp.payee_member_id || null,
      payee_name: exp.payee_name || '',
      source_type: exp.source_type || 'organization',
      source_id: exp.source_id || null,
      payment_method: exp.payment_method || '',
      status: exp.status || 'paid',
    });
    setShowForm(true);
  };

  const handleDelete = (id) => {
    api?.expenditures?.delete?.(id)
      .then((result) => {
        if (result?.error) {
          setError(result.error);
          return;
        }
        setDeleteConfirmId(null);
        emitInvalidation(['expenditures', 'dashboard', 'transactions', 'reports']);
        loadData();
      })
      .catch((err) => setError(err?.message ?? 'Failed to delete expenditure'));
  };

  const clearFilters = () => {
    setFilters({
      startDate: '',
      endDate: '',
      category: '',
      sourceType: '',
      payeeType: '',
      payeeMemberId: '',
    });
  };

  const hasActiveFilters = Object.values(filters).some(v => v !== '');

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Expenditures</h2>
          <p className="text-slate-600 mt-1">Track all organizational spending</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg border font-medium ${
              hasActiveFilters
                ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                : 'border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Filter size={18} />
            Filters
            {hasActiveFilters && <span className="ml-1 px-1.5 py-0.5 bg-emerald-600 text-white text-xs rounded-full">•</span>}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditingId(null);
              setFormData({
                date: new Date().toISOString().slice(0, 10),
                amount: '',
                category: '',
                description: '',
                payee_type: '',
                payee_member_id: null,
                payee_name: '',
                source_type: 'organization',
                source_id: null,
                payment_method: '',
                status: 'paid',
              });
              setShowForm(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700"
          >
            <Plus size={20} />
            Add Expenditure
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800">
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-2 text-red-600 hover:text-red-800"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {showFilters && (
        <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Start Date</label>
              <input
                type="date"
                value={filters.startDate}
                onChange={(e) => setFilters(f => ({ ...f, startDate: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">End Date</label>
              <input
                type="date"
                value={filters.endDate}
                onChange={(e) => setFilters(f => ({ ...f, endDate: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
              <select
                value={filters.category}
                onChange={(e) => setFilters(f => ({ ...f, category: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
              >
                <option value="">All Categories</option>
                {CATEGORIES.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Source</label>
              <select
                value={filters.sourceType}
                onChange={(e) => setFilters(f => ({ ...f, sourceType: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
              >
                <option value="">All Sources</option>
                {SOURCE_TYPES.map(type => (
                  <option key={type} value={type}>{type.charAt(0).toUpperCase() + type.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Payee Type</label>
              <select
                value={filters.payeeType}
                onChange={(e) => setFilters(f => ({ ...f, payeeType: e.target.value, payeeMemberId: '' }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
              >
                <option value="">All Payees</option>
                {PAYEE_TYPES.map(type => (
                  <option key={type} value={type}>{type.charAt(0).toUpperCase() + type.slice(1)}</option>
                ))}
              </select>
            </div>
            {filters.payeeType === 'member' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Payee Member</label>
                <select
                  value={filters.payeeMemberId}
                  onChange={(e) => setFilters(f => ({ ...f, payeeMemberId: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">All Members</option>
                  {members.filter(m => m.status === 'active').map(m => (
                    <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex items-end">
              <button
                type="button"
                onClick={clearFilters}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100"
              >
                Clear Filters
              </button>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <div className="mb-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-slate-800">
              {editingId ? 'Edit Expenditure' : 'Add Expenditure'}
            </h3>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setEditingId(null);
              }}
              className="text-slate-400 hover:text-slate-600"
            >
              <X size={20} />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Date *</label>
                <input
                  type="date"
                  required
                  value={formData.date}
                  onChange={(e) => setFormData(d => ({ ...d, date: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Amount *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={formData.amount}
                  onChange={(e) => setFormData(d => ({ ...d, amount: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Category *</label>
                <select
                  required
                  value={formData.category}
                  onChange={(e) => setFormData(d => ({ ...d, category: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">Select category</option>
                  {CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData(d => ({ ...d, status: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                >
                  {STATUS_OPTIONS.map(status => (
                    <option key={status} value={status}>{status.charAt(0).toUpperCase() + status.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Description *</label>
                <input
                  type="text"
                  required
                  value={formData.description}
                  onChange={(e) => setFormData(d => ({ ...d, description: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                  placeholder="Brief description of the expenditure"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Payee Type</label>
                <select
                  value={formData.payee_type}
                  onChange={(e) => setFormData(d => ({ ...d, payee_type: e.target.value, payee_member_id: null, payee_name: '' }))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">None</option>
                  {PAYEE_TYPES.map(type => (
                    <option key={type} value={type}>{type.charAt(0).toUpperCase() + type.slice(1)}</option>
                  ))}
                </select>
              </div>
              {formData.payee_type === 'member' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Member *</label>
                  <select
                    required
                    value={formData.payee_member_id || ''}
                    onChange={(e) => setFormData(d => ({ ...d, payee_member_id: e.target.value ? parseInt(e.target.value) : null }))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">Select member</option>
                    {members.filter(m => m.status === 'active').map(m => (
                      <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>
                    ))}
                  </select>
                </div>
              )}
              {formData.payee_type === 'vendor' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Vendor Name</label>
                  <input
                    type="text"
                    value={formData.payee_name}
                    onChange={(e) => setFormData(d => ({ ...d, payee_name: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                    placeholder="Vendor or payee name"
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Source</label>
                <select
                  value={formData.source_type}
                  onChange={(e) => setFormData(d => ({ ...d, source_type: e.target.value, source_id: null }))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                >
                  {SOURCE_TYPES.map(type => (
                    <option key={type} value={type}>{type.charAt(0).toUpperCase() + type.slice(1)}</option>
                  ))}
                </select>
              </div>
              {formData.source_type === 'event' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Event</label>
                  <select
                    value={formData.source_id || ''}
                    onChange={(e) => setFormData(d => ({ ...d, source_id: e.target.value ? parseInt(e.target.value) : null }))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">Select event</option>
                    {events.map(ev => (
                      <option key={ev.id} value={ev.id}>{ev.name}</option>
                    ))}
                  </select>
                </div>
              )}
              {formData.source_type === 'campaign' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Campaign</label>
                  <select
                    value={formData.source_id || ''}
                    onChange={(e) => setFormData(d => ({ ...d, source_id: e.target.value ? parseInt(e.target.value) : null }))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">Select campaign</option>
                    {campaigns.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Payment Method</label>
                <input
                  type="text"
                  value={formData.payment_method}
                  onChange={(e) => setFormData(d => ({ ...d, payment_method: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
                  placeholder="e.g., Check, Cash, Bank Transfer"
                />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setEditingId(null);
                }}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700"
              >
                {editingId ? 'Update' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="text-slate-500 py-12 text-center">Loading expenditures…</div>
      ) : expenditures.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <DollarSign className="mx-auto h-12 w-12 text-slate-300" />
          <p className="mt-4 text-slate-500">No expenditures found.</p>
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="mt-4 px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
          >
            Add Expenditure
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">Description</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">Category</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">Amount</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">Payee</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">Source</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {expenditures.map((exp) => (
                  <tr key={exp.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm text-slate-900">{formatDate(exp.date)}</td>
                    <td className="px-4 py-3 text-sm text-slate-900">{exp.description || '—'}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{exp.category || '—'}</td>
                    <td className="px-4 py-3 text-sm font-medium text-slate-900">{formatCurrency(exp.amount)}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{getPayeeName(exp)}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{getSourceName(exp)}</td>
                    <td className="px-4 py-3 text-sm">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        exp.status === 'paid' ? 'bg-emerald-100 text-emerald-800' :
                        exp.status === 'pending' ? 'bg-amber-100 text-amber-800' :
                        'bg-red-100 text-red-800'
                      }`}>
                        {exp.status || 'paid'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-sm">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleEdit(exp)}
                          className="p-1.5 text-slate-600 hover:text-emerald-600 hover:bg-emerald-50 rounded"
                          title="Edit"
                        >
                          <Edit size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmId(exp.id)}
                          className="p-1.5 text-slate-600 hover:text-red-600 hover:bg-red-50 rounded"
                          title="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {deleteConfirmId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-800 mb-2">Delete Expenditure</h3>
            <p className="text-slate-600 mb-6">Are you sure you want to delete this expenditure? This action cannot be undone.</p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setDeleteConfirmId(null)}
                className="flex-1 px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDelete(deleteConfirmId)}
                className="flex-1 px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
