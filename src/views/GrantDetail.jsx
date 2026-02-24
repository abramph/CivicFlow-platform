import { useState, useEffect } from 'react';
import {
  ArrowLeft,
  Save,
  Edit2,
  Archive,
  Trash2,
  AlertTriangle,
  RotateCcw,
  Plus,
  Check,
  Clock,
  FileText,
  X,
} from 'lucide-react';

const api = window.civicflow;

const STATUS_OPTIONS = ['Draft', 'Submitted', 'Awarded', 'Denied', 'Closed'];

const STATUS_COLORS = {
  Draft: 'bg-slate-100 text-slate-700',
  Submitted: 'bg-blue-100 text-blue-700',
  Awarded: 'bg-emerald-100 text-emerald-700',
  Denied: 'bg-red-100 text-red-700',
  Closed: 'bg-slate-200 text-slate-600',
};

const emitInvalidation = (keys) => {
  if (typeof window === 'undefined') return;
  const detail = Array.isArray(keys) ? keys : [];
  window.dispatchEvent(new CustomEvent('civicflow:invalidate', { detail }));
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

export function GrantDetail({ grantId, onNavigate }) {
  const isNew = !grantId;
  const [grant, setGrant] = useState(null);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(!isNew);
  const [editing, setEditing] = useState(isNew);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    grant_name: '',
    funder_name: '',
    amount_requested: '',
    amount_awarded: '',
    status: 'Draft',
    start_date: '',
    end_date: '',
    reporting_due_date: '',
    notes: '',
  });

  // Delete confirmation
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Report modal
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportForm, setReportForm] = useState({
    report_type: 'Interim',
    due_date: '',
    notes: '',
  });
  const [reportSaving, setReportSaving] = useState(false);

  const [allocationForm, setAllocationForm] = useState({
    amount: '',
    program_name: '',
    date: new Date().toISOString().slice(0, 10),
  });
  const [allocationSaving, setAllocationSaving] = useState(false);
  const [allocationMessage, setAllocationMessage] = useState(null);

  useEffect(() => {
    if (!isNew) {
      loadGrant();
    }
  }, [grantId]);

  const loadGrant = async () => {
    setLoading(true);
    try {
      const data = await api?.grants?.getById?.(grantId);
      if (data) {
        setGrant(data);
        setReports(data.reports || []);
        setForm({
          grant_name: data.grant_name || '',
          funder_name: data.funder_name || '',
          amount_requested: data.amount_requested ?? '',
          amount_awarded: data.amount_awarded ?? '',
          status: data.status || 'Draft',
          start_date: data.start_date || '',
          end_date: data.end_date || '',
          reporting_due_date: data.reporting_due_date || '',
          notes: data.notes || '',
        });
      }
    } catch (err) {
      console.error('Failed to load grant:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!form.grant_name.trim()) {
      alert('Grant name is required');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        ...form,
        amount_requested: form.amount_requested ? parseFloat(form.amount_requested) : null,
        amount_awarded: form.amount_awarded ? parseFloat(form.amount_awarded) : null,
      };

      if (isNew) {
        const result = await api?.grants?.create?.(payload);
        if (result?.error) {
          alert(result.error);
          return;
        }
        onNavigate('grant-detail', { grantId: result.id });
        emitInvalidation(['transactions', 'dashboard', 'reports', 'dues']);
      } else {
        const result = await api?.grants?.update?.(grantId, payload);
        if (result?.error) {
          alert(result.error);
          return;
        }
        setEditing(false);
        loadGrant();
        emitInvalidation(['transactions', 'dashboard', 'reports', 'dues']);
      }
    } catch (err) {
      console.error('Failed to save grant:', err);
      alert('Failed to save grant');
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async () => {
    if (grant?.archived) {
      await api?.grants?.restore?.(grantId);
    } else {
      await api?.grants?.archive?.(grantId);
    }
    loadGrant();
    emitInvalidation(['transactions', 'dashboard', 'reports', 'dues']);
  };

  const handlePermanentDelete = async () => {
    if (deleteConfirmText.trim().toLowerCase() !== 'delete') return;

    setDeleting(true);
    try {
      const result = await api?.grants?.deletePermanent?.(grantId);
      if (result?.error) {
        alert(result.error);
        return;
      }
      onNavigate('grants');
      emitInvalidation(['transactions', 'dashboard', 'reports', 'dues']);
    } catch (err) {
      console.error('Failed to delete grant:', err);
      alert('Failed to delete grant');
    } finally {
      setDeleting(false);
    }
  };

  const handleAddReport = async () => {
    if (!reportForm.due_date) {
      alert('Due date is required');
      return;
    }

    setReportSaving(true);
    try {
      const result = await api?.grantReports?.create?.({
        grant_id: grantId,
        ...reportForm,
      });
      if (result?.error) {
        alert(result.error);
        return;
      }
      setReportModalOpen(false);
      setReportForm({ report_type: 'Interim', due_date: '', notes: '' });
      loadGrant();
    } catch (err) {
      console.error('Failed to add report:', err);
      alert('Failed to add report');
    } finally {
      setReportSaving(false);
    }
  };

  const handleMarkReportSubmitted = async (reportId) => {
    await api?.grantReports?.markSubmitted?.(reportId);
    loadGrant();
  };

  const handleDeleteReport = async (reportId) => {
    if (!confirm('Delete this report?')) return;
    await api?.grantReports?.delete?.(reportId);
    loadGrant();
  };

  const handleAllocate = async () => {
    const amountNum = parseFloat(allocationForm.amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setAllocationMessage({ type: 'error', text: 'Enter a valid allocation amount.' });
      return;
    }
    if (!allocationForm.program_name.trim()) {
      setAllocationMessage({ type: 'error', text: 'Program name is required.' });
      return;
    }

    setAllocationSaving(true);
    setAllocationMessage(null);
    try {
      const result = await api?.grants?.allocate?.({
        amount: amountNum,
        program_name: allocationForm.program_name.trim(),
        date: allocationForm.date,
      });
      if (result?.error) {
        setAllocationMessage({ type: 'error', text: result.error });
        return;
      }
      setAllocationMessage({ type: 'success', text: 'Allocation recorded in ledger.' });
      setAllocationForm({
        amount: '',
        program_name: '',
        date: new Date().toISOString().slice(0, 10),
      });
      emitInvalidation(['transactions', 'dashboard', 'reports', 'dues']);
    } catch (err) {
      setAllocationMessage({ type: 'error', text: err?.message ?? 'Failed to record allocation.' });
    } finally {
      setAllocationSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-slate-500">Loading grant...</p>
      </div>
    );
  }

  if (!isNew && !grant) {
    return (
      <div className="p-6">
        <p className="text-slate-500">Grant not found</p>
        <button
          onClick={() => onNavigate('grants')}
          className="mt-4 flex items-center gap-2 text-emerald-600 hover:text-emerald-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Grants
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => onNavigate('grants')}
          className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-slate-900">
            {isNew ? 'New Grant' : editing ? 'Edit Grant' : grant.grant_name}
          </h1>
          {!isNew && !editing && grant.funder_name && (
            <p className="text-slate-500">{grant.funder_name}</p>
          )}
        </div>
        {!isNew && !editing && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-medium"
            >
              <Edit2 className="h-4 w-4" />
              Edit
            </button>
          </div>
        )}
      </div>

      {/* Form / Details */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
        {editing ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Grant Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.grant_name}
                  onChange={(e) => setForm({ ...form, grant_name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  placeholder="e.g., Community Development Grant"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Funder Name</label>
                <input
                  type="text"
                  value={form.funder_name}
                  onChange={(e) => setForm({ ...form, funder_name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  placeholder="e.g., ABC Foundation"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Amount Requested</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.amount_requested}
                  onChange={(e) => setForm({ ...form, amount_requested: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Amount Awarded</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.amount_awarded}
                  onChange={(e) => setForm({ ...form, amount_awarded: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Start Date</label>
                <input
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">End Date</label>
                <input
                  type="date"
                  value={form.end_date}
                  onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Reporting Due Date</label>
                <input
                  type="date"
                  value={form.reporting_due_date}
                  onChange={(e) => setForm({ ...form, reporting_due_date: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
              <textarea
                rows={4}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                placeholder="Additional notes about this grant..."
              />
            </div>

            <div className="flex items-center gap-3 pt-4 border-t border-slate-200">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-medium disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {saving ? 'Saving...' : isNew ? 'Create Grant' : 'Save Changes'}
              </button>
              {!isNew && (
                <button
                  onClick={() => {
                    setEditing(false);
                    loadGrant();
                  }}
                  className="px-4 py-2 text-slate-600 hover:text-slate-900 font-medium"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <p className="text-sm text-slate-500">Status</p>
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium mt-1 ${STATUS_COLORS[grant.status] || STATUS_COLORS.Draft}`}>
                  {grant.status}
                </span>
              </div>
              <div>
                <p className="text-sm text-slate-500">Funder</p>
                <p className="font-medium text-slate-900">{grant.funder_name || '—'}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <p className="text-sm text-slate-500">Amount Requested</p>
                <p className="font-medium text-slate-900">{formatCurrency(grant.amount_requested)}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500">Amount Awarded</p>
                <p className="font-medium text-emerald-600">{formatCurrency(grant.amount_awarded)}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500">Reporting Due</p>
                <p className={`font-medium ${isOverdue(grant.reporting_due_date) && grant.status === 'Awarded' ? 'text-red-600' : 'text-slate-900'}`}>
                  {formatDate(grant.reporting_due_date)}
                  {isOverdue(grant.reporting_due_date) && grant.status === 'Awarded' && (
                    <span className="ml-1 text-xs">(Overdue)</span>
                  )}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <p className="text-sm text-slate-500">Start Date</p>
                <p className="font-medium text-slate-900">{formatDate(grant.start_date)}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500">End Date</p>
                <p className="font-medium text-slate-900">{formatDate(grant.end_date)}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500">Created</p>
                <p className="font-medium text-slate-900">{formatDate(grant.created_at)}</p>
              </div>
            </div>

            {grant.notes && (
              <div>
                <p className="text-sm text-slate-500">Notes</p>
                <p className="text-slate-700 whitespace-pre-wrap">{grant.notes}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Reports Section (only for existing grants) */}
      {!isNew && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-900">Grant Reports</h2>
            <button
              onClick={() => setReportModalOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors text-sm font-medium"
            >
              <Plus className="h-4 w-4" />
              Add Report
            </button>
          </div>

          {reports.length === 0 ? (
            <div className="text-center py-8">
              <FileText className="h-8 w-8 text-slate-300 mx-auto mb-2" />
              <p className="text-slate-500 text-sm">No reports yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {reports.map((report) => {
                const overdue = !report.submitted && isOverdue(report.due_date);
                return (
                  <div
                    key={report.id}
                    className={`flex items-center justify-between p-4 rounded-lg border ${
                      overdue ? 'border-red-200 bg-red-50' : report.submitted ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {report.submitted ? (
                        <div className="h-8 w-8 bg-emerald-100 rounded-full flex items-center justify-center">
                          <Check className="h-4 w-4 text-emerald-600" />
                        </div>
                      ) : overdue ? (
                        <div className="h-8 w-8 bg-red-100 rounded-full flex items-center justify-center">
                          <AlertTriangle className="h-4 w-4 text-red-600" />
                        </div>
                      ) : (
                        <div className="h-8 w-8 bg-slate-100 rounded-full flex items-center justify-center">
                          <Clock className="h-4 w-4 text-slate-500" />
                        </div>
                      )}
                      <div>
                        <p className="font-medium text-slate-900">{report.report_type} Report</p>
                        <p className={`text-sm ${overdue ? 'text-red-600' : 'text-slate-500'}`}>
                          Due: {formatDate(report.due_date)}
                          {overdue && ' (Overdue)'}
                          {report.submitted && (
                            <span className="text-emerald-600 ml-2">Submitted {formatDate(report.submitted_date)}</span>
                          )}
                        </p>
                        {report.notes && <p className="text-sm text-slate-500 mt-1">{report.notes}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!report.submitted && (
                        <button
                          onClick={() => handleMarkReportSubmitted(report.id)}
                          className="px-3 py-1.5 text-sm font-medium text-emerald-700 bg-emerald-100 rounded-lg hover:bg-emerald-200 transition-colors"
                        >
                          Mark Submitted
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteReport(report.id)}
                        className="p-1.5 text-slate-400 hover:text-red-500 transition-colors"
                        title="Delete report"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Allocations Section (only for existing grants) */}
      {!isNew && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-900">Grant Allocations</h2>
            <span className="text-xs text-slate-500">Records GRANT_EXPENSE in ledger</span>
          </div>

          {allocationMessage && (
            <div
              role="alert"
              className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
                allocationMessage.type === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-red-200 bg-red-50 text-red-800'
              }`}
            >
              {allocationMessage.text}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Program Name</label>
              <input
                type="text"
                value={allocationForm.program_name}
                onChange={(e) => setAllocationForm((f) => ({ ...f, program_name: e.target.value }))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                placeholder="e.g., Youth Program"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Amount ($)</label>
              <input
                type="number"
                step="0.01"
                value={allocationForm.amount}
                onChange={(e) => setAllocationForm((f) => ({ ...f, amount: e.target.value }))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
              <input
                type="date"
                value={allocationForm.date}
                onChange={(e) => setAllocationForm((f) => ({ ...f, date: e.target.value }))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <button
                onClick={handleAllocate}
                disabled={allocationSaving}
                className="w-full px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium disabled:opacity-50"
              >
                {allocationSaving ? 'Recording...' : 'Record Allocation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Actions (only for existing grants) */}
      {!isNew && !editing && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Actions</h2>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleArchive}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                grant.archived
                  ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                  : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
              }`}
            >
              {grant.archived ? (
                <>
                  <RotateCcw className="h-4 w-4" />
                  Restore Grant
                </>
              ) : (
                <>
                  <Archive className="h-4 w-4" />
                  Archive Grant
                </>
              )}
            </button>
            <button
              onClick={() => setDeleteOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-red-100 text-red-700 hover:bg-red-200 rounded-lg font-medium transition-colors"
            >
              <Trash2 className="h-4 w-4" />
              Permanently Delete
            </button>
          </div>
        </div>
      )}

      {/* Add Report Modal */}
      {reportModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setReportModalOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900">Add Report</h3>
              <button onClick={() => setReportModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Report Type</label>
                <select
                  value={reportForm.report_type}
                  onChange={(e) => setReportForm({ ...reportForm, report_type: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="Interim">Interim</option>
                  <option value="Final">Final</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Due Date <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={reportForm.due_date}
                  onChange={(e) => setReportForm({ ...reportForm, due_date: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                <textarea
                  rows={3}
                  value={reportForm.notes}
                  onChange={(e) => setReportForm({ ...reportForm, notes: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                  placeholder="Optional notes..."
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setReportModalOpen(false)}
                className="px-4 py-2 text-slate-600 hover:text-slate-900 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleAddReport}
                disabled={reportSaving}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium disabled:opacity-50"
              >
                {reportSaving ? 'Adding...' : 'Add Report'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => !deleting && setDeleteOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="h-10 w-10 bg-red-100 rounded-full flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Permanently Delete Grant</h3>
              </div>
            </div>

            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
              <p className="text-sm text-red-700">
                <strong>Warning:</strong> This action is irreversible. The grant and all associated reports will be permanently deleted.
              </p>
            </div>

            <p className="text-sm text-slate-600 mb-4">
              Type <strong>delete</strong> to confirm:
            </p>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="Type delete to confirm"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 mb-4"
              autoFocus
              disabled={deleting}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && deleteConfirmText.trim().toLowerCase() === 'delete') {
                  handlePermanentDelete();
                }
              }}
            />

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteOpen(false)}
                disabled={deleting}
                className="px-4 py-2 text-slate-600 hover:text-slate-900 font-medium disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handlePermanentDelete}
                disabled={deleting || deleteConfirmText.trim().toLowerCase() !== 'delete'}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deleting ? 'Deleting...' : 'Permanently Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
