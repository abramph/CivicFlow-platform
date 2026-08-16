"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { fieldClassName } from "@/components/forms/formStyles";

type DuesCollectionMethod = "PAYROLL_DEDUCTION" | "UNESTRA_DIRECT" | "EXTERNAL" | "MIXED" | "NONE";

type DuesPolicySettings = {
  duesStartRule: "JOIN_DATE" | "FIRST_OF_NEXT_MONTH" | "MANUAL";
  delinquentAfterMonths: number;
  delinquentAfterDays: number | null;
  autoMarkDelinquent: boolean;
  gracePeriodDays: number;
  autoSuspendAfterMonths: number | null;
  autoDeactivateAfterMonths: number | null;
  reminderFrequencyDays: number | null;
  financialEditWindowHours: number;
  requireReasonForFinancialEdits: boolean;
  allowFinanceCorrections: boolean;
  lockReceiptsAfterIssue: boolean;
  duesCollectionMethod: DuesCollectionMethod | null;
};

function optionalNumber(value: string) {
  return value ? Number(value) : null;
}

export function DuesPolicySettingsForm({ settings, canWrite }: { settings: DuesPolicySettings; canWrite: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState({
    ...settings,
    delinquentAfterDays: settings.delinquentAfterDays?.toString() ?? "",
    autoSuspendAfterMonths: settings.autoSuspendAfterMonths?.toString() ?? "",
    autoDeactivateAfterMonths: settings.autoDeactivateAfterMonths?.toString() ?? "",
    reminderFrequencyDays: settings.reminderFrequencyDays?.toString() ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!canWrite) {
    return <p className="text-sm text-slate-700">You have read-only access to dues policy settings.</p>;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);

    const response = await fetch("/api/settings/dues", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        duesStartRule: form.duesStartRule,
        delinquentAfterMonths: Number(form.delinquentAfterMonths),
        delinquentAfterDays: optionalNumber(form.delinquentAfterDays),
        autoMarkDelinquent: form.autoMarkDelinquent,
        gracePeriodDays: Number(form.gracePeriodDays),
        autoSuspendAfterMonths: optionalNumber(form.autoSuspendAfterMonths),
        autoDeactivateAfterMonths: optionalNumber(form.autoDeactivateAfterMonths),
        reminderFrequencyDays: optionalNumber(form.reminderFrequencyDays),
        financialEditWindowHours: Number(form.financialEditWindowHours),
        requireReasonForFinancialEdits: form.requireReasonForFinancialEdits,
        allowFinanceCorrections: form.allowFinanceCorrections,
        lockReceiptsAfterIssue: form.lockReceiptsAfterIssue,
        duesCollectionMethod: form.duesCollectionMethod || null,
      }),
    });

    const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
    setSaving(false);
    if (!response.ok || !payload?.ok) {
      setMessage(payload?.error || "Failed to save dues policy.");
      return;
    }
    setMessage("Dues policy saved.");
    router.refresh();
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <label className="block space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm font-medium text-slate-900">
        <span>How do members actually pay dues?</span>
        <select
          className={fieldClassName}
          value={form.duesCollectionMethod ?? ""}
          onChange={(event) => setForm((current) => ({ ...current, duesCollectionMethod: (event.target.value || null) as DuesCollectionMethod | null }))}
        >
          <option value="">Not configured</option>
          <option value="PAYROLL_DEDUCTION">Payroll deduction (employer withholds and remits)</option>
          <option value="UNESTRA_DIRECT">Direct payment through Unestra</option>
          <option value="EXTERNAL">Collected outside Unestra entirely</option>
          <option value="MIXED">Mixed — varies by member</option>
          <option value="NONE">Dues are not collected</option>
        </select>
        <p className="text-xs font-normal text-slate-600">
          Presentation only — this never sets up payroll processing. When dues are collected outside Unestra
          (most commonly payroll deduction), the dashboard and member views stop implying members owe Unestra
          a payment.
        </p>
      </label>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Dues begin</span>
          <select className={fieldClassName} value={form.duesStartRule} onChange={(event) => setForm((current) => ({ ...current, duesStartRule: event.target.value as DuesPolicySettings["duesStartRule"] }))}>
            <option value="JOIN_DATE">Join date</option>
            <option value="FIRST_OF_NEXT_MONTH">First of next month</option>
            <option value="MANUAL">Manual date range</option>
          </select>
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Delinquent after unpaid months</span>
          <input type="number" min="1" className={fieldClassName} value={form.delinquentAfterMonths} onChange={(event) => setForm((current) => ({ ...current, delinquentAfterMonths: Number(event.target.value) }))} />
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Delinquent after days</span>
          <input type="number" min="1" className={fieldClassName} value={form.delinquentAfterDays} onChange={(event) => setForm((current) => ({ ...current, delinquentAfterDays: event.target.value }))} />
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Grace period days</span>
          <input type="number" min="0" className={fieldClassName} value={form.gracePeriodDays} onChange={(event) => setForm((current) => ({ ...current, gracePeriodDays: Number(event.target.value) }))} />
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Recommend suspension after months</span>
          <input type="number" min="1" className={fieldClassName} value={form.autoSuspendAfterMonths} onChange={(event) => setForm((current) => ({ ...current, autoSuspendAfterMonths: event.target.value }))} />
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Recommend deactivation after months</span>
          <input type="number" min="1" className={fieldClassName} value={form.autoDeactivateAfterMonths} onChange={(event) => setForm((current) => ({ ...current, autoDeactivateAfterMonths: event.target.value }))} />
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Reminder frequency days</span>
          <input type="number" min="1" className={fieldClassName} value={form.reminderFrequencyDays} onChange={(event) => setForm((current) => ({ ...current, reminderFrequencyDays: event.target.value }))} />
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Financial edit window hours</span>
          <input type="number" min="0" className={fieldClassName} value={form.financialEditWindowHours} onChange={(event) => setForm((current) => ({ ...current, financialEditWindowHours: Number(event.target.value) }))} />
        </label>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {[
          ["autoMarkDelinquent", "Automatically mark delinquent"],
          ["requireReasonForFinancialEdits", "Require edit reason"],
          ["allowFinanceCorrections", "Allow finance corrections"],
          ["lockReceiptsAfterIssue", "Lock receipts after issue"],
        ].map(([key, label]) => (
          <label key={key} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900">
            <input type="checkbox" checked={Boolean(form[key as keyof typeof form])} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.checked }))} />
            <span>{label}</span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={saving} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:bg-slate-400">
          {saving ? "Saving..." : "Save Dues Policy"}
        </button>
        {message ? <p className="text-sm text-slate-700">{message}</p> : null}
      </div>
    </form>
  );
}
