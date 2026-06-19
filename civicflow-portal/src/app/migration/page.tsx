"use client";

import { useState, useRef } from "react";
import { PortalShell } from "@/components/app/PortalShell";

interface ImportCounts {
  categories: number;
  members: number;
  events: number;
  campaigns: number;
  meetings: number;
  attendance: number;
  contributions: number;
  expenditures: number;
}

const FORMAT_INFO = [
  {
    ext: ".json",
    label: "CivicFlow Desktop Export (JSON)",
    desc: "Full migration — all data: members, events, campaigns, meetings, attendance, contributions, expenditures.",
    how: 'In the desktop app go to Settings → Export for Cloud Migration, then upload the saved .json file.',
    full: true,
  },
  {
    ext: ".db / .sqlite",
    label: "SQLite Database File",
    desc: "Full migration — reads the raw desktop database directly. Same data as the JSON export.",
    how: "Locate your CivicFlow database file (usually civicflow.db) and upload it directly.",
    full: true,
  },
  {
    ext: ".csv / .xlsx / .xls",
    label: "CSV or Excel Spreadsheet",
    desc: "Partial migration — imports members and contributions from a flat file. Events, campaigns, and meetings are not included.",
    how: "Include columns: First Name, Last Name, Email, Phone, Join Date, City, State, ZIP, Amount, Date.",
    full: false,
  },
];

export default function MigrationPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<
    { ok: true; counts: ImportCounts; fileType: string } | { ok: false; error: string } | null
  >(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setResult(null);
    setFile(e.target.files?.[0] ?? null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/migration/upload", { method: "POST", body: form });
      let json: Record<string, unknown>;
      try {
        json = await res.json();
      } catch {
        setResult({ ok: false, error: `Server returned status ${res.status}. Check that the file is a valid CivicFlow export.` });
        return;
      }
      if (res.ok && json.ok) {
        setResult({ ok: true, counts: json.counts as ImportCounts, fileType: json.fileType as string });
        setFile(null);
        if (fileRef.current) fileRef.current.value = "";
      } else {
        const msg = typeof json.error === "string"
          ? json.error
          : `Import failed (HTTP ${res.status}). Make sure the file was exported from CivicFlow desktop via Settings → Export for Cloud Migration.`;
        setResult({ ok: false, error: msg });
      }
    } catch {
      setResult({ ok: false, error: "Network error — check your connection and try again." });
    } finally {
      setUploading(false);
    }
  };

  const isSpreadsheet = file && /\.(csv|xlsx|xls)$/i.test(file.name);
  const isSqlite = file && /\.(db|sqlite)$/i.test(file.name);

  return (
    <PortalShell>
      <div className="p-6 max-w-2xl">
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Desktop Migration</h1>
        <p className="text-sm text-slate-600 mb-6">
          Import your existing data into this SaaS account. Supports CivicFlow exports, SQLite databases, and spreadsheets.
        </p>

        {/* Format guide */}
        <div className="mb-6 space-y-3">
          {FORMAT_INFO.map((f) => (
            <div key={f.ext} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">{f.ext}</span>
                    <span className="font-medium text-slate-900 text-sm">{f.label}</span>
                    {f.full && (
                      <span className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">Full migration</span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{f.desc}</p>
                  <p className="mt-1 text-xs text-slate-400">{f.how}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-5">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <strong>One-time import:</strong> Running this more than once will duplicate most records. Import only when your SaaS account is empty or with care.
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="file" className="block text-sm font-medium text-slate-700 mb-1">
                Upload migration file
              </label>
              <input
                ref={fileRef}
                id="file"
                type="file"
                accept=".json,.db,.sqlite,.csv,.xlsx,.xls"
                required
                onChange={handleFileChange}
                className="block w-full text-sm text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100"
              />
              {file && (
                <p className="mt-1 text-xs text-slate-500">
                  {file.name} ({(file.size / 1024).toFixed(0)} KB)
                  {isSpreadsheet && " — Members and contributions only"}
                  {isSqlite && " — Full migration from database"}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={!file || uploading}
              className="px-5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {uploading ? "Importing…" : "Import Data"}
            </button>
          </form>

          {result && (
            <div>
              {result.ok ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 space-y-3">
                  <p className="font-semibold text-emerald-800">Import complete!</p>
                  <ul className="text-sm text-emerald-700 space-y-1">
                    {result.counts.categories > 0 && <li>Categories: <strong>{result.counts.categories}</strong></li>}
                    <li>Members: <strong>{result.counts.members}</strong></li>
                    {result.counts.events > 0 && <li>Events: <strong>{result.counts.events}</strong></li>}
                    {result.counts.campaigns > 0 && <li>Campaigns: <strong>{result.counts.campaigns}</strong></li>}
                    {result.counts.meetings > 0 && <li>Meetings: <strong>{result.counts.meetings}</strong></li>}
                    {result.counts.attendance > 0 && <li>Attendance records: <strong>{result.counts.attendance}</strong></li>}
                    <li>Contributions: <strong>{result.counts.contributions}</strong></li>
                    {result.counts.expenditures > 0 && <li>Expenditures: <strong>{result.counts.expenditures}</strong></li>}
                  </ul>
                  <p className="text-sm text-emerald-700">
                    Head to <a href="/members" className="underline font-medium">Members</a> to verify your data.
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {result.error}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </PortalShell>
  );
}
