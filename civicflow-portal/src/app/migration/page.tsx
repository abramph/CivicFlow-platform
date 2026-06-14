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

export default function MigrationPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ ok: true; counts: ImportCounts } | { ok: false; error: string } | null>(null);

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
      const res = await fetch("/api/migration/upload", {
        method: "POST",
        body: form,
      });
      const json = await res.json();
      if (res.ok && json.ok) {
        setResult({ ok: true, counts: json.counts });
        setFile(null);
        if (fileRef.current) fileRef.current.value = "";
      } else {
        setResult({ ok: false, error: json.error ?? "Import failed. Please try again." });
      }
    } catch {
      setResult({ ok: false, error: "Network error. Please try again." });
    } finally {
      setUploading(false);
    }
  };

  return (
    <PortalShell>
      <div className="p-6 max-w-2xl">
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Desktop Migration</h1>
        <p className="text-sm text-slate-600 mb-6">
          Import your data from the CivicFlow desktop app into this SaaS account.
        </p>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-5">
          <div>
            <h2 className="text-base font-semibold text-slate-800 mb-2">How it works</h2>
            <ol className="list-decimal list-inside space-y-1 text-sm text-slate-600">
              <li>Open CivicFlow desktop and go to <strong>Settings → Export for Cloud Migration</strong>.</li>
              <li>Click <strong>Export Data for Cloud Migration</strong> and save the JSON file.</li>
              <li>Upload that file here. Your members, categories, events, campaigns, meetings, attendance records, contributions, and expenditures will be imported.</li>
            </ol>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <strong>One-time import:</strong> Running this more than once will duplicate most records. Import only when your SaaS account is empty or with care.
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="file" className="block text-sm font-medium text-slate-700 mb-1">
                Migration export file (.json)
              </label>
              <input
                ref={fileRef}
                id="file"
                type="file"
                accept=".json,application/json"
                required
                onChange={handleFileChange}
                className="block w-full text-sm text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100"
              />
              {file && (
                <p className="mt-1 text-xs text-slate-500">{file.name} ({(file.size / 1024).toFixed(0)} KB)</p>
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
                    <li>Categories: <strong>{result.counts.categories}</strong></li>
                    <li>Members: <strong>{result.counts.members}</strong></li>
                    <li>Events: <strong>{result.counts.events}</strong></li>
                    <li>Campaigns: <strong>{result.counts.campaigns}</strong></li>
                    <li>Meetings: <strong>{result.counts.meetings}</strong></li>
                    <li>Attendance records: <strong>{result.counts.attendance}</strong></li>
                    <li>Contributions: <strong>{result.counts.contributions}</strong></li>
                    <li>Expenditures: <strong>{result.counts.expenditures}</strong></li>
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
