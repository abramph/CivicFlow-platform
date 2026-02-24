import { useEffect, useState } from 'react';
import { Upload, FileText } from 'lucide-react';

const api = window.civicflow;

const emitInvalidation = (keys) => {
  if (typeof window === 'undefined') return;
  const detail = Array.isArray(keys) ? keys : [];
  window.dispatchEvent(new CustomEvent('civicflow:invalidate', { detail }));
};

const parseCsv = (text) => {
  const rows = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return { headers: [], rows: [] };

  const parseLine = (line) => {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current);
    return result.map((v) => v.trim());
  };

  const headers = parseLine(lines[0]).map((h) => h.replace(/\s+/g, '_').toLowerCase());
  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? '';
    });
    rows.push(row);
  }

  return { headers, rows };
};

export function ImportTransactions() {
  const [rows, setRows] = useState([]);
  const [orgId, setOrgId] = useState(1);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [currentRole, setCurrentRole] = useState('Admin');

  useEffect(() => {
    api?.organization?.get?.().then((org) => {
      if (org?.id) setOrgId(org.id);
    }).catch(() => {});
    api?.roles?.getCurrent?.().then((r) => {
      if (r?.role) setCurrentRole(r.role);
    }).catch(() => {});
  }, []);

  const handleFile = async (e) => {
    const file = e.target?.files?.[0];
    if (!file) return;
    setMessage(null);
    const text = await file.text();
    const parsed = parseCsv(text);
    setRows(parsed.rows || []);
    if ((parsed.rows || []).length === 0) {
      setMessage({ type: 'error', text: 'No data rows found in CSV.' });
    }
  };

  const handleImport = async () => {
    if (!rows.length) {
      setMessage({ type: 'error', text: 'No rows to import.' });
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const payload = rows.map((r) => ({ ...r, orgId }));
      const result = await api?.transactions?.importCsv?.(payload);
      if (result?.error) throw new Error(result.error);
      setMessage({
        type: 'success',
        text: `Imported ${result.inserted ?? 0} row(s). Skipped ${result.skipped ?? 0}.`,
      });
      emitInvalidation(['transactions', 'dashboard', 'dues', 'reports']);
    } catch (err) {
      setMessage({ type: 'error', text: err?.message || 'Import failed.' });
    } finally {
      setLoading(false);
    }
  };

  if (currentRole !== 'Admin') {
    return (
      <div className="p-8">
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-xl font-semibold text-slate-800">Import Transactions</h2>
          <p className="text-slate-600 mt-2">Admin access required.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Import Transactions</h2>
          <p className="text-slate-600 mt-1">Upload a CSV file to bulk import completed payments.</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 max-w-3xl">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <FileText size={18} />
            Required Columns
          </h3>
          <p className="text-sm text-slate-600 mt-1">
            Use columns: <code className="bg-slate-100 px-1 rounded">member_name</code> or <code className="bg-slate-100 px-1 rounded">member_id</code>, <code className="bg-slate-100 px-1 rounded">amount</code>, <code className="bg-slate-100 px-1 rounded">transaction_type</code> (optional), <code className="bg-slate-100 px-1 rounded">date</code>, <code className="bg-slate-100 px-1 rounded">payment_method</code>, <code className="bg-slate-100 px-1 rounded">reference</code>, <code className="bg-slate-100 px-1 rounded">notes</code>.
          </p>
        </div>

        <div className="flex items-center gap-4">
          <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 text-slate-700 cursor-pointer hover:bg-slate-50">
            <Upload size={18} />
            <span>Choose CSV</span>
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
          </label>
          <button
            type="button"
            onClick={handleImport}
            disabled={loading || rows.length === 0}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-60"
          >
            {loading ? 'Importing…' : 'Import'}
          </button>
          <span className="text-sm text-slate-500">{rows.length} row(s) loaded</span>
        </div>

        {message && (
          <div className={`mt-4 rounded-lg px-4 py-3 text-sm ${message.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
            {message.text}
          </div>
        )}
      </div>
    </div>
  );
}
