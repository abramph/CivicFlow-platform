import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Upload, FileSpreadsheet, ChevronRight, ChevronLeft, Check, AlertTriangle,
  X, Download, ArrowRight, CheckCircle2, XCircle, AlertCircle, Loader2, FileDown,
  Users, Calendar, DollarSign, Target, Award, ShieldAlert
} from 'lucide-react';

const api = window.civicflow;

const IMPORT_TYPES = [
  { id: 'members', label: 'Members', icon: Users, desc: 'Import or update member records' },
  { id: 'membership_periods', label: 'Membership Periods', icon: Calendar, desc: 'Import membership period history' },
  { id: 'financial_transactions', label: 'Financial Transactions', icon: DollarSign, desc: 'Import immutable financial records' },
  { id: 'campaigns', label: 'Campaigns / Contributions', icon: Target, desc: 'Import campaigns and contributions' },
  { id: 'grants', label: 'Grants', icon: Award, desc: 'Import grant records' },
];

const FIELD_DEFS = {
  members: [
    { key: 'first_name', label: 'First Name', required: true },
    { key: 'last_name', label: 'Last Name', required: true },
    { key: 'email', label: 'Email', required: false },
    { key: 'phone', label: 'Phone', required: false },
    { key: 'address', label: 'Address', required: false },
    { key: 'city', label: 'City', required: false },
    { key: 'state', label: 'State', required: false },
    { key: 'zip', label: 'ZIP', required: false },
    { key: 'join_date', label: 'Join Date', required: false },
    { key: 'member_id', label: 'Member ID (for update matching)', required: false },
  ],
  membership_periods: [
    { key: 'member_id', label: 'Member ID', required: false },
    { key: 'member_email', label: 'Member Email', required: false },
    { key: 'start_date', label: 'Start Date', required: true },
    { key: 'end_date', label: 'End Date', required: false },
    { key: 'status', label: 'Status', required: false },
    { key: 'termination_reason', label: 'Termination Reason', required: false },
    { key: 'reinstated_from_period_id', label: 'Reinstated From Period ID', required: false },
  ],
  financial_transactions: [
    { key: 'member_id', label: 'Member ID', required: false },
    { key: 'member_email', label: 'Member Email', required: false },
    { key: 'amount', label: 'Amount', required: true },
    { key: 'txn_date', label: 'Transaction Date', required: true },
    { key: 'txn_type', label: 'Type (DUES/CONTRIBUTION)', required: false },
    { key: 'reference', label: 'Reference', required: false },
    { key: 'notes', label: 'Notes', required: false },
  ],
  campaigns: [
    { key: 'campaign_name', label: 'Campaign Name', required: false },
    { key: 'campaign_start_date', label: 'Campaign Start Date', required: false },
    { key: 'campaign_end_date', label: 'Campaign End Date', required: false },
    { key: 'member_id', label: 'Member ID', required: false },
    { key: 'member_email', label: 'Member Email', required: false },
    { key: 'contributor_name', label: 'Contributor Name', required: false },
    { key: 'contributor_email', label: 'Contributor Email', required: false },
    { key: 'amount', label: 'Contribution Amount', required: false },
    { key: 'txn_date', label: 'Contribution Date', required: false },
    { key: 'reference', label: 'Reference', required: false },
    { key: 'notes', label: 'Notes', required: false },
  ],
  grants: [
    { key: 'grant_name', label: 'Grant Name', required: true },
    { key: 'funder_name', label: 'Funder Name', required: false },
    { key: 'amount_requested', label: 'Amount Requested', required: false },
    { key: 'amount_awarded', label: 'Amount Awarded', required: false },
    { key: 'status', label: 'Status', required: false },
    { key: 'start_date', label: 'Start Date', required: false },
    { key: 'end_date', label: 'End Date', required: false },
    { key: 'reporting_due_date', label: 'Reporting Due Date', required: false },
    { key: 'notes', label: 'Notes', required: false },
    { key: 'report_type', label: 'Report Type', required: false },
    { key: 'report_due_date', label: 'Report Due Date', required: false },
    { key: 'report_submitted', label: 'Report Submitted', required: false },
    { key: 'report_submitted_date', label: 'Report Submitted Date', required: false },
    { key: 'report_notes', label: 'Report Notes', required: false },
  ],
};

const STEPS = ['Upload File', 'Import Type', 'Map Columns', 'Validate', 'Import'];

export function ImportWizard({ onNavigate }) {
  const [currentRole, setCurrentRole] = useState('Admin');
  const [step, setStep] = useState(0);

  // Step 1 - File
  const [file, setFile] = useState(null);
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState(0);
  const [fileBase64, setFileBase64] = useState('');
  const [parseResult, setParseResult] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState('');
  const [sheetNames, setSheetNames] = useState([]);
  const [sheetName, setSheetName] = useState('');
  const fileInputRef = useRef(null);

  // Step 2 - Type
  const [importType, setImportType] = useState('');

  // Step 3 - Mapping
  const [mapping, setMapping] = useState({});

  // Step 4 - Validation
  const [previewResult, setPreviewResult] = useState(null);
  const [validating, setValidating] = useState(false);

  // Step 5 - Import
  const [importResult, setImportResult] = useState(null);
  const [importing, setImporting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [importRuns, setImportRuns] = useState([]);
  const [selectedRun, setSelectedRun] = useState(null);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [grantsEnabled, setGrantsEnabled] = useState(true);

  const loadRuns = useCallback(async () => {
    setLoadingRuns(true);
    try {
      const runs = await api.dataImport.runsList?.({ limit: 100 });
      if (Array.isArray(runs)) setImportRuns(runs);
    } catch {}
    finally {
      setLoadingRuns(false);
    }
  }, [sheetName]);

  useEffect(() => {
    api.roles.getCurrent().then(r => setCurrentRole(r?.role || 'Admin')).catch(() => {});
    api.dataImport.templatesList?.().then((r) => {
      if (r?.ok && Array.isArray(r.templates)) setTemplates(r.templates);
    }).catch(() => {});
    api.features?.isEnabled?.('grants').then((enabled) => {
      if (typeof enabled === 'boolean') setGrantsEnabled(enabled);
    }).catch(() => {});
    loadRuns();
  }, [loadRuns]);

  const isAdmin = currentRole === 'Admin';

  // ---- File handling ----
  const handleFileSelect = useCallback(async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const ext = f.name.split('.').pop().toLowerCase();
    if (!['xlsx', 'xls', 'csv'].includes(ext)) {
      setParseError('Only .xlsx, .xls, and .csv files are supported.');
      return;
    }
    setFile(f);
    setFileName(f.name);
    setFileSize(f.size);
    setFileBase64('');
    setMapping({});
    setPreviewResult(null);
    setImportResult(null);
    setConfirmed(false);
    setParseError('');
    setParsing(true);

    try {
      const arrayBuf = await f.arrayBuffer();
      const base64 = btoa(new Uint8Array(arrayBuf).reduce((d, b) => d + String.fromCharCode(b), ''));
      setFileBase64(base64);
      const result = await api.dataImport.parseFile({ base64, filename: f.name, sheetName });
      if (result.error) {
        setParseError(result.error);
        setParseResult(null);
        setSheetNames([]);
        setSheetName('');
      } else {
        setParseResult(result);
        setSheetNames(result.sheetNames || []);
        setSheetName(result.sheetName || '');
        setParseError('');
      }
    } catch (err) {
      setParseError(err.message || 'Failed to parse file');
    } finally {
      setParsing(false);
    }
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer?.files?.length) {
      const fakeEvent = { target: { files: e.dataTransfer.files } };
      handleFileSelect(fakeEvent);
    }
  }, [handleFileSelect]);

  const handleSheetChange = useCallback(async (nextSheet) => {
    if (!fileBase64 || !fileName) return;
    setParsing(true);
    setParseError('');
    try {
      const result = await api.dataImport.parseFile({ base64: fileBase64, filename: fileName, sheetName: nextSheet });
      if (result.error) {
        setParseError(result.error);
        setParseResult(null);
      } else {
        setParseResult(result);
        setSheetNames(result.sheetNames || []);
        setSheetName(result.sheetName || nextSheet);
      }
    } catch (err) {
      setParseError(err.message || 'Failed to parse file');
    } finally {
      setParsing(false);
    }
  }, [fileBase64, fileName]);

  // ---- Mapping helpers ----
  const fields = FIELD_DEFS[importType] || [];
  const requiredFields = fields.filter(f => f.required);

  const autoMapColumns = useCallback(() => {
    if (!parseResult?.headers || !importType) return;
    const newMapping = {};
    for (const field of fields) {
      const exact = parseResult.headers.find(h => h.toLowerCase().replace(/[\s_-]+/g, '') === field.key.toLowerCase().replace(/[\s_-]+/g, ''));
      if (exact) {
        newMapping[field.key] = exact;
      } else {
        // Fuzzy match on label
        const fuzzy = parseResult.headers.find(h =>
          h.toLowerCase().replace(/[\s_-]+/g, '').includes(field.label.toLowerCase().replace(/[\s_()-]+/g, ''))
        );
        if (fuzzy && !Object.values(newMapping).includes(fuzzy)) {
          newMapping[field.key] = fuzzy;
        }
      }
    }
    setMapping(newMapping);
  }, [parseResult, importType, fields]);

  useEffect(() => {
    if (step === 2 && parseResult?.headers) {
      autoMapColumns();
    }
  }, [step, importType, parseResult?.headers, autoMapColumns]);

  const allRequiredMapped = requiredFields.every(f => mapping[f.key]);

  // ---- Validation ----
  const runPreview = useCallback(async () => {
    if (!fileBase64 || !importType) return;
    setValidating(true);
    setPreviewResult(null);
    try {
      const result = await api.dataImport.preview({
        importType,
        mapping,
        base64: fileBase64,
        filename: fileName,
        sheetName,
      });
      setPreviewResult(result);
    } catch (err) {
      setPreviewResult({ error: err.message });
    } finally {
      setValidating(false);
    }
  }, [fileBase64, importType, mapping, fileName, sheetName]);

  useEffect(() => {
    if (step === 3) runPreview();
  }, [step, runPreview]);

  // ---- Execute import ----
  const executeImport = useCallback(async () => {
    if (!previewResult?.summary) return;
    setImporting(true);
    setImportResult(null);
    try {
      const result = await api.dataImport.commit({
        importType,
        mapping,
        base64: fileBase64,
        filename: fileName,
        sheetName,
      });
      setImportResult(result);
      loadRuns();
    } catch (err) {
      setImportResult({ ok: false, error: err.message });
    } finally {
      setImporting(false);
    }
  }, [previewResult, importType, mapping, fileBase64, fileName, sheetName, loadRuns]);

  // ---- Template download ----
  const downloadTemplate = useCallback(async (type) => {
    try {
      const result = await api.dataImport.templatesDownload(type);
      if (result?.ok && result?.base64) {
        const binary = Uint8Array.from(atob(result.base64), c => c.charCodeAt(0));
        const blob = new Blob([binary], { type: result.mimeType || 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = result.filename || `civicflow_${type}_template.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {}
  }, []);

  // ---- Download error list ----
  const downloadErrors = useCallback(() => {
    if (!previewResult?.errorCsv) return;
    const blob = new Blob([previewResult.errorCsv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'import_errors.csv';
    a.click();
    URL.revokeObjectURL(url);
  }, [previewResult]);

  const downloadRunErrors = useCallback((run) => {
    if (!run?.errorCsv) return;
    const blob = new Blob([run.errorCsv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `import_run_${run.id}_errors.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  // ---- Navigation ----
  const canNext = () => {
    if (step === 0) return !!parseResult && !parseError;
    if (step === 1) return !!importType && !(importType === 'grants' && !grantsEnabled);
    if (step === 2) return allRequiredMapped;
    if (step === 3) {
      const summary = previewResult?.summary;
      return previewResult && !previewResult.error && summary && summary.errorCount === 0 && (summary.inserted + summary.updated) > 0;
    }
    return false;
  };

  const goNext = () => {
    if (step < STEPS.length - 1 && canNext()) setStep(step + 1);
  };
  const goBack = () => {
    if (step > 0) setStep(step - 1);
    if (step === 4) { setImportResult(null); setConfirmed(false); }
  };

  const reset = () => {
    setStep(0);
    setFile(null);
    setFileName('');
    setFileSize(0);
    setFileBase64('');
    setParseResult(null);
    setParsing(false);
    setParseError('');
    setSheetNames([]);
    setSheetName('');
    setImportType('');
    setMapping({});
    setPreviewResult(null);
    setImportResult(null);
    setConfirmed(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  if (!isAdmin) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <div className="bg-white rounded-xl border border-red-200 shadow-sm p-8 text-center">
          <ShieldAlert className="mx-auto h-12 w-12 text-red-400 mb-4" />
          <h2 className="text-xl font-semibold text-slate-800 mb-2">Admin Access Required</h2>
          <p className="text-slate-600">Data Import is restricted to Admin users. Please contact your administrator.</p>
        </div>
      </div>
    );
  }

  const formatSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Data Import</h1>
          <p className="text-sm text-slate-500 mt-1">Import members, transactions, and more from Excel or CSV files</p>
        </div>
        <button
          onClick={() => onNavigate('settings')}
          className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1"
        >
          <ChevronLeft size={16} />
          Back to Settings
        </button>
      </div>

      {/* Templates panel */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-700">Download Templates</h2>
          <span className="text-xs text-slate-400">CSV</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {(templates.length ? templates : IMPORT_TYPES).map((t) => (
            <button
              key={t.id}
              onClick={() => downloadTemplate(t.id)}
              className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-1 mb-8">
        {STEPS.map((s, idx) => (
          <div key={s} className="flex items-center">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              idx < step ? 'bg-emerald-100 text-emerald-700' :
              idx === step ? 'bg-emerald-600 text-white' :
              'bg-slate-100 text-slate-400'
            }`}>
              {idx < step ? <Check size={14} /> : <span>{idx + 1}</span>}
              <span className="hidden sm:inline">{s}</span>
            </div>
            {idx < STEPS.length - 1 && (
              <ChevronRight size={16} className="text-slate-300 mx-1" />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">

        {/* ====== STEP 0: Upload ====== */}
        {step === 0 && (
          <div className="p-6">
            <h2 className="text-lg font-semibold text-slate-800 mb-4">Upload File</h2>
            <div
              className="border-2 border-dashed border-slate-300 rounded-xl p-10 text-center hover:border-emerald-400 transition-colors cursor-pointer"
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileSelect}
                className="hidden"
              />
              {parsing ? (
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="h-10 w-10 text-emerald-500 animate-spin" />
                  <p className="text-slate-600">Parsing file...</p>
                </div>
              ) : parseResult ? (
                <div className="flex flex-col items-center gap-3">
                  <FileSpreadsheet className="h-10 w-10 text-emerald-600" />
                  <div>
                    <p className="font-medium text-slate-800">{fileName}</p>
                    <p className="text-sm text-slate-500 mt-1">
                      {formatSize(fileSize)} &middot; {parseResult.totalRows} rows &middot; {parseResult.headers.length} columns
                      {parseResult.sheetName && <span> &middot; Sheet: {parseResult.sheetName}</span>}
                    </p>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); reset(); }}
                    className="text-xs text-slate-500 hover:text-red-500 mt-2"
                  >
                    Remove and choose another file
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <Upload className="h-10 w-10 text-slate-400" />
                  <div>
                    <p className="font-medium text-slate-600">Drop your file here or click to browse</p>
                    <p className="text-sm text-slate-400 mt-1">Supports .xlsx, .xls, and .csv files</p>
                  </div>
                </div>
              )}
            </div>
            {parseError && (
              <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2">
                <XCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{parseError}</p>
              </div>
            )}
            {parseResult && (
              <div className="mt-4">
                {sheetNames.length > 1 && (
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-slate-700 mb-1">Sheet</label>
                    <select
                      value={sheetName}
                      onChange={(e) => handleSheetChange(e.target.value)}
                      className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white"
                    >
                      {sheetNames.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                )}
                <h3 className="text-sm font-medium text-slate-700 mb-2">Preview (first 5 rows)</h3>
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50">
                        {parseResult.headers.map(h => (
                          <th key={h} className="px-3 py-2 text-left font-medium text-slate-600 whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(parseResult.previewRows || []).slice(0, 5).map((row, i) => (
                        <tr key={i} className="border-t border-slate-100">
                          {parseResult.headers.map(h => (
                            <td key={h} className="px-3 py-1.5 text-slate-600 whitespace-nowrap max-w-[200px] truncate">
                              {row[h] instanceof Date ? row[h].toISOString().slice(0, 10) : String(row[h] ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ====== STEP 1: Import Type ====== */}
        {step === 1 && (
          <div className="p-6">
            <h2 className="text-lg font-semibold text-slate-800 mb-4">Select Import Type</h2>
            <p className="text-sm text-slate-500 mb-6">Choose what type of data you are importing from <strong>{fileName}</strong></p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {IMPORT_TYPES.map(t => {
                const Icon = t.icon;
                const selected = importType === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => { setImportType(t.id); setMapping({}); setPreviewResult(null); setImportResult(null); setConfirmed(false); }}
                    className={`flex items-start gap-4 p-4 rounded-xl border-2 text-left transition-all ${
                      selected
                        ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-200'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <div className={`p-2.5 rounded-lg ${selected ? 'bg-emerald-100' : 'bg-slate-100'}`}>
                      <Icon size={22} className={selected ? 'text-emerald-600' : 'text-slate-500'} />
                    </div>
                    <div>
                      <p className={`font-semibold ${selected ? 'text-emerald-800' : 'text-slate-800'}`}>{t.label}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{t.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
            {importType && (
              <div className="mt-6 flex items-center gap-4">
                <button onClick={() => downloadTemplate(importType)} className="flex items-center gap-2 text-sm text-emerald-600 hover:text-emerald-700 font-medium">
                  <FileDown size={16} />
                  Download template CSV
                </button>
              </div>
            )}
            {importType === 'financial_transactions' && (
              <div className="mt-4 p-3 rounded-lg bg-amber-50 border border-amber-200 flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                <div className="text-sm text-amber-800">
                  <strong>Immutable Records:</strong> Imported financial transactions are marked as <code className="bg-amber-100 px-1 rounded">is_imported=1</code>.
                  They cannot be edited, corrected, or reversed after import. Verify your data carefully before proceeding.
                </div>
              </div>
            )}
            {importType === 'grants' && !grantsEnabled && (
              <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2">
                <ShieldAlert className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                <div className="text-sm text-red-700">
                  Grants module not installed. Template download is available, but imports are disabled.
                </div>
              </div>
            )}
          </div>
        )}

        {/* ====== STEP 2: Column Mapping ====== */}
        {step === 2 && (
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-800">Map Columns</h2>
                <p className="text-sm text-slate-500 mt-1">
                  Match your file columns to CivicFlow fields. <span className="text-red-500">*</span> = required
                </p>
              </div>
              <button onClick={autoMapColumns} className="text-sm text-emerald-600 hover:text-emerald-700 font-medium">
                Auto-detect
              </button>
            </div>
            <div className="space-y-3">
              {fields.map(field => (
                <div key={field.key} className="flex items-center gap-4">
                  <div className="w-52 shrink-0">
                    <span className="text-sm font-medium text-slate-700">
                      {field.label}
                      {field.required && <span className="text-red-500 ml-0.5">*</span>}
                    </span>
                  </div>
                  <ArrowRight size={16} className="text-slate-300 shrink-0" />
                  <select
                    value={mapping[field.key] || ''}
                    onChange={(e) => setMapping({ ...mapping, [field.key]: e.target.value || undefined })}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm ${
                      field.required && !mapping[field.key]
                        ? 'border-red-300 bg-red-50'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    <option value="">— Not mapped —</option>
                    {parseResult?.headers?.map(h => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                  {mapping[field.key] && (
                    <span className="text-xs text-slate-400 shrink-0 w-32 truncate" title={`e.g. ${parseResult?.previewRows?.[0]?.[mapping[field.key]] ?? ''}`}>
                      e.g. {String(parseResult?.previewRows?.[0]?.[mapping[field.key]] ?? '').slice(0, 20)}
                    </span>
                  )}
                </div>
              ))}
            </div>
            {!allRequiredMapped && (
              <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200">
                <p className="text-sm text-red-700">All required fields must be mapped before proceeding.</p>
              </div>
            )}
          </div>
        )}

        {/* ====== STEP 3: Validation ====== */}
        {step === 3 && (
          <div className="p-6">
            <h2 className="text-lg font-semibold text-slate-800 mb-4">Validation & Preview</h2>
            {validating ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 text-emerald-500 animate-spin" />
                <span className="ml-3 text-slate-600">Validating data...</span>
              </div>
            ) : previewResult?.error ? (
              <div className="p-4 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2">
                <XCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{previewResult.error}</p>
              </div>
            ) : previewResult ? (
              <div className="space-y-4">
                {/* Summary tiles */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
                    <CheckCircle2 className="h-6 w-6 text-emerald-600 mx-auto mb-1" />
                    <p className="text-2xl font-bold text-emerald-700">{previewResult.summary?.inserted || 0}</p>
                    <p className="text-xs text-emerald-600">To Insert</p>
                  </div>
                  <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-center">
                    <CheckCircle2 className="h-6 w-6 text-blue-600 mx-auto mb-1" />
                    <p className="text-2xl font-bold text-blue-700">{previewResult.summary?.updated || 0}</p>
                    <p className="text-xs text-blue-600">To Update</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
                    <AlertCircle className="h-6 w-6 text-slate-500 mx-auto mb-1" />
                    <p className="text-2xl font-bold text-slate-700">{previewResult.summary?.skipped || 0}</p>
                    <p className="text-xs text-slate-600">Skipped</p>
                  </div>
                  <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center">
                    <XCircle className="h-6 w-6 text-red-500 mx-auto mb-1" />
                    <p className="text-2xl font-bold text-red-700">{previewResult.summary?.errorCount || 0}</p>
                    <p className="text-xs text-red-600">Errors</p>
                  </div>
                </div>

                {previewResult.summary?.warningCount > 0 && (
                  <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
                    {previewResult.summary.warningCount} warning(s) detected. Review before importing.
                  </div>
                )}

                {/* Error detail */}
                {previewResult.errors?.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-semibold text-red-700">Rows with errors (blocked)</h3>
                      <button onClick={downloadErrors} className="flex items-center gap-1 text-xs text-red-600 hover:text-red-700 font-medium">
                        <Download size={14} /> Download error list
                      </button>
                    </div>
                    <div className="rounded-lg border border-red-200 overflow-hidden max-h-48 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-red-50">
                            <th className="px-3 py-2 text-left font-medium text-red-700 w-20">Row</th>
                            <th className="px-3 py-2 text-left font-medium text-red-700">Issue</th>
                          </tr>
                        </thead>
                        <tbody>
                          {previewResult.errors.slice(0, 20).map((e, i) => (
                            <tr key={i} className="border-t border-red-100">
                              <td className="px-3 py-1.5 text-red-600">{e.rowNum}</td>
                              <td className="px-3 py-1.5 text-red-600">{e.message}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {previewResult.errors.length > 20 && (
                        <p className="px-3 py-2 text-xs text-red-500">...and {previewResult.errors.length - 20} more</p>
                      )}
                    </div>
                  </div>
                )}

                {/* Preview table */}
                {previewResult.previewRows?.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-slate-700 mb-2">Preview (first 50 rows)</h3>
                    <div className="rounded-lg border border-slate-200 overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-slate-50">
                            <th className="px-3 py-2 text-left font-medium text-slate-600 w-16">Row</th>
                            <th className="px-3 py-2 text-left font-medium text-slate-600 w-24">Action</th>
                            {fields.map((f) => (
                              <th key={f.key} className="px-3 py-2 text-left font-medium text-slate-600">{f.label}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {previewResult.previewRows.map((r, i) => {
                            const badgeClass = r.action === 'INSERT'
                              ? 'bg-emerald-100 text-emerald-700'
                              : r.action === 'UPDATE'
                                ? 'bg-blue-100 text-blue-700'
                                : r.action === 'SKIP'
                                  ? 'bg-slate-100 text-slate-600'
                                  : r.action === 'WARNING'
                                    ? 'bg-amber-100 text-amber-700'
                                    : 'bg-red-100 text-red-700';
                            return (
                              <tr key={i} className="border-t border-slate-100">
                                <td className="px-3 py-1.5 text-slate-600">{r.rowNum}</td>
                                <td className="px-3 py-1.5">
                                  <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${badgeClass}`}>
                                    {r.action}
                                  </span>
                                </td>
                                {fields.map((f) => (
                                  <td key={f.key} className="px-3 py-1.5 text-slate-600 whitespace-nowrap max-w-[180px] truncate">
                                    {String(r.data?.[f.key] ?? '')}
                                  </td>
                                ))}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <button onClick={runPreview} className="text-sm text-emerald-600 hover:text-emerald-700 font-medium">
                  Re-validate
                </button>
              </div>
            ) : null}
          </div>
        )}

        {/* ====== STEP 4: Confirm & Import ====== */}
        {step === 4 && (
          <div className="p-6">
            <h2 className="text-lg font-semibold text-slate-800 mb-4">Confirm & Import</h2>

            {importResult ? (
              importResult.error || importResult.ok === false ? (
                <div className="space-y-4">
                  <div className="p-4 rounded-lg bg-red-50 border border-red-200 flex items-start gap-3">
                    <XCircle className="h-6 w-6 text-red-500 shrink-0" />
                    <div>
                      <p className="font-semibold text-red-800">Import Failed</p>
                      <p className="text-sm text-red-700 mt-1">{importResult.error}</p>
                      <p className="text-xs text-red-600 mt-2">All changes have been rolled back. No data was modified.</p>
                    </div>
                  </div>
                  <button onClick={goBack} className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
                    Go Back
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 flex items-start gap-3">
                    <CheckCircle2 className="h-6 w-6 text-emerald-600 shrink-0" />
                    <div>
                      <p className="font-semibold text-emerald-800">Import Successful</p>
                      <p className="text-sm text-emerald-700 mt-1">
                        Processed {importResult.counts?.totalRows || 0} rows: {importResult.counts?.inserted || 0} inserted, {importResult.counts?.updated || 0} updated, {importResult.counts?.skipped || 0} skipped
                      </p>
                    </div>
                  </div>
                  {importResult.importRunId && (
                    <button
                      onClick={async () => {
                        const run = await api.dataImport.runsGet?.(importResult.importRunId);
                        if (run) setSelectedRun(run);
                      }}
                      className="text-sm text-emerald-700 hover:text-emerald-800 font-medium"
                    >
                      View import run details
                    </button>
                  )}
                  <div className="flex gap-3">
                    <button
                      onClick={reset}
                      className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700"
                    >
                      Import More Data
                    </button>
                    <button
                      onClick={() => onNavigate('settings')}
                      className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm hover:bg-slate-50"
                    >
                      Back to Settings
                    </button>
                  </div>
                </div>
              )
            ) : (
              <div className="space-y-6">
                {/* Summary */}
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
                    <h3 className="text-sm font-semibold text-slate-700">Import Summary</h3>
                  </div>
                  <div className="p-4 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-500">File</span>
                      <span className="font-medium text-slate-800">{fileName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Import Type</span>
                      <span className="font-medium text-slate-800">
                        {IMPORT_TYPES.find(t => t.id === importType)?.label}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Valid rows to import</span>
                      <span className="font-bold text-emerald-700">{(previewResult?.summary?.inserted || 0) + (previewResult?.summary?.updated || 0)}</span>
                    </div>
                    {(previewResult?.summary?.errorCount || 0) > 0 && (
                      <div className="flex justify-between">
                        <span className="text-slate-500">Rows skipped (errors)</span>
                        <span className="font-medium text-red-600">{previewResult.summary.errorCount}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Confirmation */}
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                    <div className="text-sm text-amber-800">
                      <p className="font-medium">
                        This action will import {(previewResult?.summary?.inserted || 0) + (previewResult?.summary?.updated || 0)} records.
                      </p>
                      <p className="mt-1">
                        {importType === 'financial_transactions'
                          ? 'Imported financial transactions are immutable and cannot be edited or reversed.'
                          : 'Please ensure your data is correct before proceeding.'
                        }
                      </p>
                    </div>
                  </div>
                </div>

                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-sm text-slate-700">I have reviewed the data and confirm this import</span>
                </label>

                <button
                  onClick={executeImport}
                  disabled={!confirmed || importing || (previewResult?.summary?.errorCount || 0) > 0 || ((previewResult?.summary?.inserted || 0) + (previewResult?.summary?.updated || 0) === 0)}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {importing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Importing...
                    </>
                  ) : (
                    <>
                      <Upload size={18} />
                      Execute Import
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer navigation */}
      {!importResult && (
        <div className="flex justify-between mt-6">
          <button
            onClick={step === 0 ? () => onNavigate('settings') : goBack}
            className="flex items-center gap-1 px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            <ChevronLeft size={16} />
            {step === 0 ? 'Cancel' : 'Back'}
          </button>
          {step < STEPS.length - 1 && (
            <button
              onClick={goNext}
              disabled={!canNext()}
              className="flex items-center gap-1 px-5 py-2 text-sm rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
              <ChevronRight size={16} />
            </button>
          )}
        </div>
      )}

      {/* Import history */}
      <div className="mt-10">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-slate-800">Import History</h2>
          <button onClick={loadRuns} className="text-xs text-slate-500 hover:text-slate-700">Refresh</button>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {loadingRuns ? (
            <div className="p-6 text-sm text-slate-500">Loading import history…</div>
          ) : importRuns.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">No import runs yet.</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50">
                  <th className="px-3 py-2 text-left font-medium text-slate-600">Date</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600">Type</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600">File</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600">Counts</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600">Status</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600">Action</th>
                </tr>
              </thead>
              <tbody>
                {importRuns.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-slate-600">{r.created_at ? new Date(r.created_at).toLocaleString() : ''}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {IMPORT_TYPES.find(t => t.id === r.import_type)?.label || r.import_type}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{r.file_name}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {r.inserted_rows || 0} ins / {r.updated_rows || 0} upd / {r.skipped_rows || 0} skip / {r.error_rows || 0} err
                    </td>
                    <td className="px-3 py-2 text-slate-600">{r.status}</td>
                    <td className="px-3 py-2">
                      <button
                        onClick={async () => {
                          const run = await api.dataImport.runsGet?.(r.id);
                          if (run) setSelectedRun(run);
                        }}
                        className="text-xs text-emerald-600 hover:text-emerald-700"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {selectedRun && (
          <div className="mt-4 bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-700">Run #{selectedRun.id}</h3>
                <p className="text-xs text-slate-500 mt-0.5">{selectedRun.file_name} · {selectedRun.status}</p>
              </div>
              <button onClick={() => setSelectedRun(null)} className="text-xs text-slate-500 hover:text-slate-700">Close</button>
            </div>
            {selectedRun.errors?.length > 0 ? (
              <div className="mt-3">
                <button
                  onClick={() => downloadRunErrors(selectedRun)}
                  className="flex items-center gap-1 text-xs text-red-600 hover:text-red-700 font-medium"
                >
                  <Download size={14} /> Download error report
                </button>
                <div className="mt-2 max-h-40 overflow-y-auto border border-red-200 rounded-lg">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-red-50">
                        <th className="px-3 py-2 text-left font-medium text-red-700 w-20">Row</th>
                        <th className="px-3 py-2 text-left font-medium text-red-700">Issue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedRun.errors.slice(0, 20).map((e, i) => (
                        <tr key={i} className="border-t border-red-100">
                          <td className="px-3 py-1.5 text-red-600">{e.rowNum}</td>
                          <td className="px-3 py-1.5 text-red-600">{e.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-xs text-slate-500">No error report for this run.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
