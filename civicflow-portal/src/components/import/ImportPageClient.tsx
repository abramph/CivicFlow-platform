"use client";

import { useRef, useState } from "react";
import { PortalShell } from "@/components/app/PortalShell";
import * as XLSX from "xlsx";
import type { CapabilityFlag } from "@/lib/vertical-capabilities";

type ImportType = "members" | "contributions" | "pta-households" | "hoa-properties";
type Step = "type" | "upload" | "table" | "map" | "preview" | "result";

const IMPORT_TYPES: { id: ImportType; label: string; desc: string; capability?: CapabilityFlag }[] = [
  { id: "members", label: "Members", desc: "Import or update member records. Matched by email if provided." },
  { id: "contributions", label: "Contributions", desc: "Import contribution/donation records. Matched to members by email." },
  {
    id: "pta-households",
    label: "PTA Households",
    desc: "Import households with a primary contact adult and optional students.",
    capability: "ptaHouseholds",
  },
  {
    id: "hoa-properties",
    label: "HOA Properties",
    desc: "Import properties, optionally with an owner or resident linked to each one.",
    capability: "properties",
  },
];

const FIELD_DEFS: Record<ImportType, { key: string; label: string; required: boolean }[]> = {
  members: [
    { key: "firstName", label: "First Name", required: true },
    { key: "lastName", label: "Last Name", required: true },
    { key: "email", label: "Email", required: false },
    { key: "phone", label: "Phone", required: false },
    { key: "joinDate", label: "Join Date", required: false },
    { key: "address", label: "Street Address", required: false },
    { key: "city", label: "City", required: false },
    { key: "state", label: "State", required: false },
    { key: "zip", label: "ZIP Code", required: false },
  ],
  contributions: [
    { key: "amount", label: "Amount", required: true },
    { key: "contributionDate", label: "Contribution Date", required: true },
    { key: "memberEmail", label: "Member Email (for matching)", required: false },
    { key: "paymentMethod", label: "Payment Method", required: false },
    { key: "notes", label: "Notes", required: false },
  ],
  "pta-households": [
    { key: "householdName", label: "Household Name", required: true },
    { key: "schoolYear", label: "School Year", required: true },
    { key: "contactName", label: "Primary Contact Name", required: true },
    { key: "contactEmail", label: "Primary Contact Email", required: false },
    { key: "contactPhone", label: "Primary Contact Phone", required: false },
    { key: "studentNames", label: "Student Names (semicolon-separated)", required: false },
    { key: "notes", label: "Notes", required: false },
  ],
  "hoa-properties": [
    { key: "addressLine1", label: "Street Address", required: true },
    { key: "addressLine2", label: "Address Line 2", required: false },
    { key: "unitLabel", label: "Unit / Lot Number", required: false },
    { key: "buildingLabel", label: "Building", required: false },
    { key: "city", label: "City", required: false },
    { key: "state", label: "State", required: false },
    { key: "zip", label: "ZIP Code", required: false },
    { key: "propertyType", label: "Property Type", required: false },
    { key: "ownerFirstName", label: "Owner First Name", required: false },
    { key: "ownerLastName", label: "Owner Last Name", required: false },
    { key: "ownerEmail", label: "Owner Email", required: false },
    { key: "relationshipType", label: "Relationship Type", required: false },
    { key: "notes", label: "Notes (board-only)", required: false },
  ],
};

const COMMON_ALIASES: Record<string, string> = {
  "first name": "firstName", "first_name": "firstName", "firstname": "firstName",
  "last name": "lastName", "last_name": "lastName", "lastname": "lastName",
  "email": "email", "email address": "email", "e-mail": "email",
  "phone": "phone", "phone number": "phone", "mobile": "phone",
  "join date": "joinDate", "joined": "joinDate", "join_date": "joinDate",
  "address": "address", "street": "address", "street address": "address",
  "city": "city", "state": "state", "zip": "zip", "zip code": "zip", "postal code": "zip",
  "amount": "amount", "donation": "amount", "contribution": "amount",
  "date": "contributionDate", "contribution date": "contributionDate", "donation date": "contributionDate",
  "member email": "memberEmail", "donor email": "memberEmail",
  "payment method": "paymentMethod", "method": "paymentMethod",
  "notes": "notes", "note": "notes", "memo": "notes",
  "household name": "householdName", "household": "householdName", "family name": "householdName",
  "school year": "schoolYear",
  "contact name": "contactName", "primary contact": "contactName", "parent name": "contactName",
  "contact email": "contactEmail", "parent email": "contactEmail",
  "contact phone": "contactPhone", "parent phone": "contactPhone",
  "student names": "studentNames", "students": "studentNames", "student name": "studentNames",
  "address line 1": "addressLine1", "property address": "addressLine1",
  "address line 2": "addressLine2", "address 2": "addressLine2",
  "unit": "unitLabel", "unit number": "unitLabel", "lot": "unitLabel", "lot number": "unitLabel",
  "building": "buildingLabel",
  "property type": "propertyType", "type": "propertyType",
  "owner first name": "ownerFirstName", "owner last name": "ownerLastName", "owner email": "ownerEmail",
  "relationship": "relationshipType", "relationship type": "relationshipType",
};

function autoMap(headers: string[], importType: ImportType): Record<string, string> {
  const fields = FIELD_DEFS[importType].map((f) => f.key);
  const result: Record<string, string> = {};
  for (const header of headers) {
    const normalized = header.toLowerCase().trim();
    const matched = COMMON_ALIASES[normalized];
    if (matched && fields.includes(matched) && !Object.values(result).includes(matched)) {
      result[header] = matched;
    }
  }
  return result;
}

export function ImportPageClient({ capabilities }: { capabilities: Record<CapabilityFlag, boolean> }) {
  const availableImportTypes = IMPORT_TYPES.filter((t) => !t.capability || capabilities[t.capability]);

  const [step, setStep] = useState<Step>("type");
  const [importType, setImportType] = useState<ImportType>("members");
  const [headers, setHeaders] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<Record<string, string>[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [dbTables, setDbTables] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ imported: number; total: number; errors: { row: number; message?: string }[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const isSqlite = (f: File) => {
    const ext = f.name.toLowerCase().split(".").pop();
    return ext === "db" || ext === "sqlite";
  };

  const loadColumnsFromFile = async (f: File, table?: string) => {
    setError(null);
    setUploading(true);
    try {
      if (isSqlite(f)) {
        const form = new FormData();
        form.append("file", f);
        form.append("type", importType);
        form.append("mapping", "{}");
        form.append("preview", "1");
        if (table) form.append("table", table);
        const res = await fetch("/api/import", { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) { setError(data.error || "Failed to read file."); return; }
        setHeaders(data.headers);
        setPreviewRows(data.preview);
        setTotalRows(data.totalRows);
        setMapping(autoMap(data.headers, importType));
        setStep("map");
      } else {
        const buffer = await f.arrayBuffer();
        const wb = XLSX.read(buffer, { type: "array", dateNF: "yyyy-mm-dd" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { raw: false, defval: "" });
        if (rows.length === 0) { setError("File has no data rows."); return; }
        const hdrs = Object.keys(rows[0]);
        setHeaders(hdrs);
        setPreviewRows(rows.slice(0, 5));
        setTotalRows(rows.length);
        setMapping(autoMap(hdrs, importType));
        setStep("map");
      }
    } catch {
      setError("Could not parse file. Make sure it is a valid CSV, Excel, or SQLite file.");
    } finally {
      setUploading(false);
    }
  };

  const handleFile = async (f: File) => {
    setError(null);
    setFile(f);
    if (isSqlite(f)) {
      // First list the tables in the .db file
      setUploading(true);
      try {
        const form = new FormData();
        form.append("file", f);
        form.append("type", importType);
        form.append("mapping", "{}");
        form.append("listTables", "1");
        const res = await fetch("/api/import", { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) { setError(data.error || "Failed to read SQLite file."); return; }
        setDbTables(data.tables ?? []);
        setSelectedTable(data.tables?.[0] ?? "");
        setStep("table");
      } catch {
        setError("Could not read SQLite file.");
      } finally {
        setUploading(false);
      }
    } else {
      await loadColumnsFromFile(f);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const handleImport = async () => {
    if (!file) return;
    setImporting(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("type", importType);
      form.append("mapping", JSON.stringify(mapping));
      if (selectedTable) form.append("table", selectedTable);
      const res = await fetch("/api/import", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Import failed."); return; }
      setResult(data);
      setStep("result");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setImporting(false);
    }
  };

  const reset = () => {
    setStep("type");
    setFile(null);
    setHeaders([]);
    setPreviewRows([]);
    setMapping({});
    setResult(null);
    setError(null);
    setDbTables([]);
    setSelectedTable("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const fields = FIELD_DEFS[importType];

  return (
    <PortalShell>
      <div className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-bold text-slate-900">Import Data</h1>
        <p className="mt-1 text-sm text-slate-600">Upload a CSV or Excel file to import records into your organization.</p>

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {/* Step: choose type */}
        {step === "type" && (
          <div className="mt-6 space-y-3">
            <p className="text-sm font-medium text-slate-700">What would you like to import?</p>
            {availableImportTypes.map((t) => (
              <button
                key={t.id}
                onClick={() => { setImportType(t.id); setStep("upload"); }}
                className="w-full rounded-lg border border-slate-200 bg-white px-5 py-4 text-left hover:border-emerald-400 hover:bg-emerald-50 transition-colors"
              >
                <div className="font-semibold text-slate-900">{t.label}</div>
                <div className="mt-0.5 text-sm text-slate-500">{t.desc}</div>
              </button>
            ))}
          </div>
        )}

        {/* Step: upload */}
        {step === "upload" && (
          <div className="mt-6">
            <button onClick={() => setStep("type")} className="mb-4 text-sm text-emerald-600 hover:underline">← Back</button>
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileRef.current?.click()}
              className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-16 text-center hover:border-emerald-400 hover:bg-emerald-50 transition-colors"
            >
              <div className="text-4xl mb-3">📂</div>
              <p className="font-semibold text-slate-700">Drop your file here or click to browse</p>
              <p className="mt-1 text-sm text-slate-500">Supports CSV, Excel (.xlsx, .xls), and SQLite (.db) — max 50 MB</p>
              {uploading && <p className="mt-3 text-sm text-emerald-600 animate-pulse">Parsing file…</p>}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.xls,.db,.sqlite"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <p className="font-medium">Tips for a clean import:</p>
              <ul className="mt-1 list-disc pl-4 space-y-0.5">
                {importType === "members" && (
                  <>
                    <li>First row must be a header row with column names</li>
                    <li>Required columns: First Name, Last Name</li>
                    <li>Existing members matched by email — missing email creates new record</li>
                  </>
                )}
                {importType === "contributions" && (
                  <>
                    <li>First row must be a header row with column names</li>
                    <li>Required columns: Amount, Date</li>
                    <li>Member Email links contributions to existing members</li>
                    <li>Payment Method: CASH, CHECK, ZEFFY, STRIPE, VENMO, ZELLE, etc.</li>
                  </>
                )}
                {importType === "pta-households" && (
                  <>
                    <li>First row must be a header row with column names</li>
                    <li>Required columns: Household Name, School Year, Primary Contact Name</li>
                    <li>Re-importing the same household (same name + school year) is safe — it&apos;s skipped, not duplicated</li>
                    <li>Student Names can list multiple students separated by semicolons or commas</li>
                  </>
                )}
                {importType === "hoa-properties" && (
                  <>
                    <li>First row must be a header row with column names</li>
                    <li>Required column: Street Address</li>
                    <li>Re-importing the same property (same address + unit) is safe — it&apos;s matched, not duplicated</li>
                    <li>Owner First/Last Name links an owner or resident to the property; Owner Email matches an existing member if one exists</li>
                    <li>Relationship Type: Owner, Co-owner, Resident, Tenant, or Non-resident owner (defaults to Owner)</li>
                  </>
                )}
              </ul>
            </div>
          </div>
        )}

        {/* Step: select SQLite table */}
        {step === "table" && (
          <div className="mt-6">
            <button onClick={() => setStep("upload")} className="mb-4 text-sm text-emerald-600 hover:underline">← Back</button>
            <div className="rounded-lg border border-slate-200 bg-white p-5">
              <p className="font-semibold text-slate-900">Select a table to import from</p>
              <p className="mt-0.5 text-sm text-slate-500">File: <span className="font-medium">{file?.name}</span></p>
              <div className="mt-4 space-y-2">
                {dbTables.map((t) => (
                  <label key={t} className="flex items-center gap-3 cursor-pointer rounded-lg border border-slate-200 px-4 py-2.5 hover:bg-slate-50">
                    <input
                      type="radio"
                      name="table"
                      value={t}
                      checked={selectedTable === t}
                      onChange={() => setSelectedTable(t)}
                      className="h-4 w-4 text-emerald-600"
                    />
                    <span className="text-sm font-medium text-slate-800 font-mono">{t}</span>
                  </label>
                ))}
              </div>
            </div>
            <button
              onClick={() => file && loadColumnsFromFile(file, selectedTable)}
              disabled={!selectedTable || uploading}
              className="mt-4 w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {uploading ? "Reading table…" : "Continue →"}
            </button>
          </div>
        )}

        {/* Step: map columns */}
        {step === "map" && (
          <div className="mt-6">
            <button onClick={() => setStep("upload")} className="mb-4 text-sm text-emerald-600 hover:underline">← Back</button>
            <div className="rounded-lg border border-slate-200 bg-white p-5">
              <p className="font-semibold text-slate-900">Map your columns</p>
              <p className="mt-0.5 text-sm text-slate-500">
                File: <span className="font-medium">{file?.name}</span> — {totalRows} rows detected
              </p>
              <div className="mt-4 space-y-3">
                {fields.map((field) => {
                  const mapped = Object.entries(mapping).find(([, v]) => v === field.key)?.[0] ?? "";
                  return (
                    <div key={field.key} className="grid grid-cols-2 gap-3 items-center">
                      <label className="text-sm font-medium text-slate-700">
                        {field.label}{field.required && <span className="ml-1 text-red-500">*</span>}
                      </label>
                      <select
                        value={mapped}
                        onChange={(e) => {
                          const next = { ...mapping };
                          // remove old mapping for this field
                          Object.keys(next).forEach((k) => { if (next[k] === field.key) delete next[k]; });
                          if (e.target.value) next[e.target.value] = field.key;
                          setMapping(next);
                        }}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-900"
                      >
                        <option value="">(not mapped)</option>
                        {headers.map((h) => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Data preview */}
            <div className="mt-4 rounded-lg border border-slate-200 bg-white overflow-auto">
              <p className="px-4 py-2 text-xs font-medium text-slate-500 border-b border-slate-100">File preview (first 5 rows)</p>
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="bg-slate-50">
                    {headers.map((h) => (
                      <th key={h} className="px-3 py-2 text-left font-medium text-slate-700 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      {headers.map((h) => (
                        <td key={h} className="px-3 py-1.5 text-slate-600 whitespace-nowrap max-w-[160px] truncate">{row[h]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button
              onClick={() => setStep("preview")}
              disabled={fields.some((f) => f.required && !Object.values(mapping).includes(f.key))}
              className="mt-4 w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              Continue to Preview →
            </button>
          </div>
        )}

        {/* Step: preview & confirm */}
        {step === "preview" && (
          <div className="mt-6">
            <button onClick={() => setStep("map")} className="mb-4 text-sm text-emerald-600 hover:underline">← Back</button>
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              You are about to import <strong>{totalRows} {importType}</strong> records. This action cannot be undone.
              {importType === "members" && " Existing members matched by email will be updated."}
              {importType === "pta-households" && " Households already imported (matched by name + school year) are safely skipped."}
              {importType === "hoa-properties" && " Properties already imported (matched by address + unit) are safely skipped."}
            </div>
            <div className="mt-4 rounded-lg border border-slate-200 bg-white p-5">
              <p className="font-semibold text-slate-900">Column mapping summary</p>
              <div className="mt-3 space-y-1 text-sm">
                {fields.map((field) => {
                  const col = Object.entries(mapping).find(([, v]) => v === field.key)?.[0];
                  return (
                    <div key={field.key} className="flex gap-2">
                      <span className="w-44 text-slate-500">{field.label}</span>
                      <span className={col ? "font-medium text-slate-900" : "text-slate-400 italic"}>
                        {col ?? "(not mapped)"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            <button
              onClick={handleImport}
              disabled={importing}
              className="mt-4 w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {importing ? "Importing…" : `Import ${totalRows} Records`}
            </button>
          </div>
        )}

        {/* Step: result */}
        {step === "result" && result && (
          <div className="mt-6">
            <div className={`rounded-lg border px-5 py-4 ${result.errors.length === 0 ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
              <p className="font-semibold text-slate-900">
                Import complete — {result.imported} of {result.total} records imported successfully
              </p>
              {result.errors.length > 0 && (
                <div className="mt-3">
                  <p className="text-sm font-medium text-amber-800">{result.errors.length} rows had errors:</p>
                  <ul className="mt-1 text-sm text-amber-700 list-disc pl-4 space-y-0.5">
                    {result.errors.slice(0, 20).map((e, i) => (
                      <li key={i}>Row {e.row}: {e.message}</li>
                    ))}
                    {result.errors.length > 20 && <li>…and {result.errors.length - 20} more</li>}
                  </ul>
                </div>
              )}
            </div>
            <button
              onClick={reset}
              className="mt-4 w-full rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Import Another File
            </button>
          </div>
        )}
      </div>
    </PortalShell>
  );
}
