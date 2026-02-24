import { useState, useEffect } from 'react';
import { Search, Users, Plus, Pencil, Archive, RotateCcw, ArrowUpDown, Mail } from 'lucide-react';

const api = window.civicflow;

export function MemberDirectory({ onNavigate, title }) {
  const [members, setMembers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCity, setFilterCity] = useState('');
  const [filterZip, setFilterZip] = useState('');
  const [filterState, setFilterState] = useState('');
  const [sortBy, setSortBy] = useState('last_name');
  const [sortDir, setSortDir] = useState('asc');
  const [showArchived, setShowArchived] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [currentRole, setCurrentRole] = useState('Admin');
  const [reminderSending, setReminderSending] = useState(false);
  const [reminderMessage, setReminderMessage] = useState(null);
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    category_id: '',
    status: 'active',
    join_date: '',
  });

  const loadData = () => {
    setLoading(true);
    setError(null);
    const filters = { includeDuesStatus: true, sortBy, sortDir: sortDir === 'desc' ? 'desc' : 'asc' };
    if (search.trim()) filters.search = search.trim();
    if (filterCity.trim()) filters.city = filterCity.trim();
    if (filterState.trim()) filters.state = filterState.trim();
    if (filterZip.trim()) filters.zip = filterZip.trim();

    // Determine which members to load based on filter
    const isMembershipPeriodFilter = filterStatus === 'terminated' || filterStatus === 'reinstated';
    const isAllFilter = filterStatus === 'all';

    if (isMembershipPeriodFilter) {
      // For terminated/reinstated, load all members then filter by membership period status
      filters.status = undefined; // load all from DB
      Promise.all([
        api?.members?.list?.(filters),
        api?.categories?.list?.(),
      ])
        .then(async ([membersData, categoriesData]) => {
          const allMembers = Array.isArray(membersData) ? membersData : [];
          // Filter by membership period status
          const filtered = [];
          for (const m of allMembers) {
            try {
              const status = await api?.membership?.getCurrentStatus?.(m.id);
              if (status?.status === (filterStatus === 'terminated' ? 'Terminated' : 'Reinstated')) {
                filtered.push({ ...m, _membershipStatus: status?.status });
              }
            } catch (_) {}
          }
          setMembers(filtered);
          setCategories(Array.isArray(categoriesData) ? categoriesData : []);
        })
        .catch((err) => {
          setError(err?.message ?? 'Failed to load members');
          setMembers([]);
          setCategories([]);
        })
        .finally(() => setLoading(false));
    } else {
      // Standard active/inactive/all filter
      if (isAllFilter) {
        filters.status = undefined;
      } else if (filterStatus) {
        filters.status = filterStatus;
      } else {
        filters.status = showArchived ? 'inactive' : 'active';
      }
      Promise.all([
        api?.members?.list?.(filters),
        api?.categories?.list?.(),
      ])
        .then(([membersData, categoriesData]) => {
          setMembers(Array.isArray(membersData) ? membersData : []);
          setCategories(Array.isArray(categoriesData) ? categoriesData : []);
        })
        .catch((err) => {
          setError(err?.message ?? 'Failed to load members');
          setMembers([]);
          setCategories([]);
        })
        .finally(() => setLoading(false));
    }
  };

  useEffect(() => {
    loadData();
  }, [search, filterStatus, filterCity, filterState, filterZip, sortBy, sortDir, showArchived]);

  useEffect(() => {
    api?.roles?.getCurrent?.().then((r) => {
      if (r?.role) setCurrentRole(r.role);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e) => {
      const keys = Array.isArray(e?.detail) ? e.detail : [];
      if (keys.includes('dues')) {
        loadData();
      }
    };
    window.addEventListener('civicflow:invalidate', handler);
    return () => window.removeEventListener('civicflow:invalidate', handler);
  }, [search, filterStatus, filterCity, filterState, filterZip, sortBy, sortDir, showArchived]);

  const filtered = members;

  const handleSubmit = async (e) => {
    e.preventDefault();
    const payload = {
      ...form,
      category_id: form.category_id ? Number(form.category_id) : null,
      join_date: form.join_date || null,
    };
    try {
      if (editingId) {
        await api.members.update(editingId, payload);
      } else {
        await api.members.create(payload);
      }
      setShowForm(false);
      setEditingId(null);
      setForm({ first_name: '', last_name: '', email: '', phone: '', address: '', city: '', state: '', zip: '', category_id: '', status: 'active', join_date: '' });
      loadData();
    } catch (err) {
      setError(err?.message ?? 'Failed to save member');
    }
  };

  const handleArchive = async (id) => {
    if (!confirm('Archive this member?')) return;
    try {
      await api.members.archive(id);
      loadData();
    } catch (err) {
      setError(err?.message ?? 'Failed to archive');
    }
  };

  const handleRestore = async (id) => {
    if (!confirm('Restore this member to active status?')) return;
    try {
      await api.members.restore(id);
      loadData();
    } catch (err) {
      setError(err?.message ?? 'Failed to restore');
    }
  };

  const startEdit = (m) => {
    setEditingId(m.id);
    setForm({
      first_name: m.first_name ?? '',
      last_name: m.last_name ?? '',
      email: m.email ?? '',
      phone: m.phone ?? '',
      address: m.address ?? '',
      city: m.city ?? '',
      state: m.state ?? '',
      zip: m.zip ?? '',
      category_id: m.category_id ?? '',
      status: m.status ?? 'active',
      join_date: m.join_date ?? '',
    });
    setShowForm(true);
  };

  const handleSendDuesReminders = async () => {
    if (!confirm('Send dues reminders to all members with email addresses?')) return;
    setReminderSending(true);
    setReminderMessage(null);
    try {
      const allMembers = await api?.members?.list?.({});
      const membersWithEmail = (Array.isArray(allMembers) ? allMembers : []).filter((m) => String(m.email || '').trim());
      if (membersWithEmail.length === 0) {
        setReminderMessage({ type: 'error', text: 'No members with valid email addresses.' });
        return;
      }
      let success = 0;
      let failed = 0;
      let skipped = 0;
      for (const m of membersWithEmail) {
        // Send sequentially to avoid SMTP throttling
        const res = await api?.email?.sendDuesReminder?.({
          id: m.id,
          orgId: 1,
          email: m.email,
          name: [m.first_name, m.last_name].filter(Boolean).join(' '),
        });
        if (res?.skipped) skipped += 1;
        else if (res?.error) failed += 1;
        else success += 1;
      }
      setReminderMessage({
        type: failed ? 'error' : 'success',
        text: `Sent ${success} reminder${success === 1 ? '' : 's'}${skipped ? `, ${skipped} skipped` : ''}${failed ? `, ${failed} failed` : ''}.`,
      });
    } catch (err) {
      setReminderMessage({ type: 'error', text: err?.message ?? 'Failed to send reminders.' });
    } finally {
      setReminderSending(false);
    }
  };

  const duesStatusBadge = (ds) => {
    if (!ds?.status) return null;
    const s = ds.status;
    const classes = {
      current: 'bg-emerald-100 text-emerald-800',
      credit: 'bg-emerald-100 text-emerald-800',
      past_due: 'bg-amber-100 text-amber-800',
      delinquent: 'bg-red-100 text-red-800',
    };
    const label = s === 'credit' ? 'Credit' : s === 'past_due' ? 'Past due' : s === 'delinquent' ? 'Delinquent' : 'Current';
    return (
      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${classes[s] || 'bg-slate-100 text-slate-700'}`}>
        {label}
      </span>
    );
  };

  const formatDate = (d) => {
    if (d == null || d === '') return '—';
    try {
      const date = new Date(d);
      return Number.isNaN(date.getTime()) ? String(d) : date.toLocaleDateString();
    } catch {
      return String(d);
    }
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">{title ?? 'Members'}</h2>
          <p className="text-slate-600">List and search members. First and last name required.</p>
        </div>
        <div className="flex items-center gap-2">
          {currentRole === 'Admin' && (
            <button
              type="button"
              onClick={handleSendDuesReminders}
              disabled={reminderSending}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-60"
            >
              <Mail size={18} />
              {reminderSending ? 'Sending…' : 'Send Dues Reminder to All Members'}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setEditingId(null);
              setForm({ first_name: '', last_name: '', email: '', phone: '', address: '', city: '', state: '', zip: '', category_id: '', status: 'active', join_date: '' });
              setShowForm(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700"
          >
            <Plus size={20} />
            Add Member
          </button>
        </div>
      </div>

      {reminderMessage && (
        <div className={`mb-6 rounded-lg border px-4 py-3 ${reminderMessage.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
          {reminderMessage.text}
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email..."
            className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
          />
        </div>

        {/* Sort dropdown */}
        <div className="flex items-center gap-2">
          <ArrowUpDown className="h-4 w-4 text-slate-500" />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-emerald-500 text-sm"
          >
            <option value="last_name">Last Name</option>
            <option value="first_name">First Name</option>
            <option value="join_date">Join Date</option>
            <option value="status">Status</option>
            <option value="city">City</option>
            <option value="created_at">Created</option>
          </select>
          <select
            value={sortDir}
            onChange={(e) => setSortDir(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-emerald-500 text-sm"
          >
            <option value="asc">A → Z</option>
            <option value="desc">Z → A</option>
          </select>
        </div>

        {/* Status filter */}
        <div className="flex items-center gap-2">
          <select
            value={filterStatus || (showArchived ? 'inactive' : '')}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'inactive') { setShowArchived(true); setFilterStatus(''); }
              else if (v === '') { setShowArchived(false); setFilterStatus(''); }
              else if (v === 'all') { setShowArchived(false); setFilterStatus('all'); }
              else { setShowArchived(false); setFilterStatus(v); }
            }}
            className="text-sm border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500"
          >
            <option value="">Active</option>
            <option value="inactive">Inactive / Archived</option>
            <option value="terminated">Terminated</option>
            <option value="reinstated">Reinstated</option>
            <option value="all">All Members</option>
          </select>
        </div>
      </div>

      {error && (
        <div role="alert" className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800">
          {error}
        </div>
      )}

      {showForm && (
        <div className="mb-8 rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h3 className="text-lg font-semibold text-slate-800 mb-4">{editingId ? 'Edit Member' : 'Add Member'}</h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">First Name *</label>
              <input
                type="text"
                required
                value={form.first_name}
                onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Last Name *</label>
              <input
                type="text"
                required
                value={form.last_name}
                onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
              <input
                type="text"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Address</label>
              <input
                type="text"
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
              <select
                value={form.category_id}
                onChange={(e) => setForm((f) => ({ ...f, category_id: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
              >
                <option value="">—</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Join Date</label>
              <input
                type="date"
                value={form.join_date}
                onChange={(e) => setForm((f) => ({ ...f, join_date: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div className="md:col-span-2 flex gap-2">
              <button type="submit" className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700">
                {editingId ? 'Save' : 'Add'}
              </button>
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
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <p className="text-slate-500">Loading members…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <Users className="mx-auto h-12 w-12 text-slate-300" />
          <p className="mt-4 text-slate-600 font-medium">No members found</p>
          <p className="text-sm text-slate-500 mt-1">
            {members.length === 0 ? 'Add a member to get started.' : 'Try a different search.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80">
                  <th className="text-left text-xs font-semibold uppercase tracking-wider text-slate-600 px-6 py-4">Name</th>
                  <th className="text-left text-xs font-semibold uppercase tracking-wider text-slate-600 px-6 py-4">Email</th>
                  <th className="text-left text-xs font-semibold uppercase tracking-wider text-slate-600 px-6 py-4">Category</th>
                  <th className="text-left text-xs font-semibold uppercase tracking-wider text-slate-600 px-6 py-4">Status</th>
                  <th className="text-left text-xs font-semibold uppercase tracking-wider text-slate-600 px-6 py-4">Dues</th>
                  <th className="text-right text-xs font-semibold uppercase tracking-wider text-slate-600 px-6 py-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50/50">
                    <td className="px-6 py-4">
                      {onNavigate ? (
                        <button
                          type="button"
                          onClick={() => onNavigate('member-profile', { memberId: m.id })}
                          className="text-slate-900 font-medium hover:text-emerald-600 hover:underline text-left"
                        >
                          {[m.first_name, m.last_name].filter(Boolean).join(' ') || '—'}
                        </button>
                      ) : (
                        <span className="text-slate-900 font-medium">{[m.first_name, m.last_name].filter(Boolean).join(' ') || '—'}</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-slate-600">{m.email ?? '—'}</td>
                    <td className="px-6 py-4 text-slate-600">{m.category_name ?? '—'}</td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          (m.status ?? '').toLowerCase() === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {m.status ?? '—'}
                      </span>
                    </td>
                    <td className="px-6 py-4">{duesStatusBadge(m.duesStatus)}</td>
                    <td className="px-6 py-4 text-right">
                      <button
                        type="button"
                        onClick={() => startEdit(m)}
                        className="p-1.5 rounded text-slate-500 hover:bg-slate-100 hover:text-slate-700 mr-1"
                        title="Edit"
                      >
                        <Pencil size={16} />
                      </button>
                      {m.status === 'inactive' ? (
                        <button
                          type="button"
                          onClick={() => handleRestore(m.id)}
                          className="p-1.5 rounded text-emerald-500 hover:bg-emerald-50 hover:text-emerald-700"
                          title="Restore"
                        >
                          <RotateCcw size={16} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleArchive(m.id)}
                          className="p-1.5 rounded text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                          title="Archive"
                        >
                          <Archive size={16} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
