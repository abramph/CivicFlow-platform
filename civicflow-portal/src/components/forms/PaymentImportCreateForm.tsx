"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { fieldClassName } from "@/components/forms/formStyles";

const sources = ["ZELLE", "CASH_APP", "VENMO", "PAYPAL", "STRIPE", "BANK", "MANUAL_CSV", "PAYROLL_CHECKOFF", "OTHER"];

export function PaymentImportCreateForm() {
  const router = useRouter();
  const [form, setForm] = useState({ sourceType: "MANUAL_CSV", fileName: "", csvText: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setForm((current) => ({ ...current, fileName: file.name, csvText: "" }));
    setForm((current) => ({ ...current, csvText: "" }));
    const text = await file.text();
    setForm((current) => ({ ...current, fileName: file.name, csvText: text }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const response = await fetch("/api/payments/imports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string; data?: { id: string } } | null;
    setSaving(false);
    if (!response.ok || !payload?.ok || !payload.data?.id) {
      setError(payload?.error || "Failed to import payments.");
      return;
    }
    router.push(`/payments/imports/${payload.data.id}`);
    router.refresh();
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="grid gap-4 md:grid-cols-3">
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Source</span>
          <select className={fieldClassName} value={form.sourceType} onChange={(event) => setForm((current) => ({ ...current, sourceType: event.target.value }))}>
            {sources.map((source) => <option key={source} value={source}>{source.replace(/_/g, " ")}</option>)}
          </select>
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900 md:col-span-2">
          <span>CSV file</span>
          <input type="file" accept=".csv,text/csv" className={fieldClassName} onChange={readFile} />
        </label>
      </div>
      <label className="space-y-2 text-sm font-medium text-slate-900">
        <span>CSV text</span>
        <textarea className={fieldClassName} rows={10} value={form.csvText} onChange={(event) => setForm((current) => ({ ...current, csvText: event.target.value }))} />
      </label>
      <label className="space-y-2 text-sm font-medium text-slate-900">
        <span>Notes</span>
        <textarea className={fieldClassName} rows={3} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
      </label>
      {error ? <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
      <button disabled={saving} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:bg-slate-400">
        {saving ? "Importing..." : "Import CSV"}
      </button>
    </form>
  );
}
