"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { fieldClassName } from "@/components/forms/formStyles";

export function DuesAdjustmentForm({
  memberId,
  duesChargeId = "",
  canWrite,
}: {
  memberId: string;
  duesChargeId?: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState({ adjustmentType: "WAIVER", amount: "", reason: "" });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    const response = await fetch("/api/dues/adjustments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        memberId,
        duesChargeId: duesChargeId || null,
        adjustmentType: form.adjustmentType,
        amount: Number(form.amount),
        reason: form.reason,
      }),
    });
    const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
    setSaving(false);
    if (!response.ok || !payload?.ok) {
      setMessage(payload?.error || "Failed to record adjustment.");
      return;
    }
    setForm({ adjustmentType: "WAIVER", amount: "", reason: "" });
    setMessage("Adjustment recorded.");
    router.refresh();
  }

  if (!canWrite) {
    return <p className="text-sm text-slate-700">You have read-only access to dues adjustments.</p>;
  }

  return (
    <form className="grid gap-4 md:grid-cols-4" onSubmit={handleSubmit}>
      <label className="space-y-2 text-sm font-medium text-slate-900">
        <span>Type</span>
        <select className={fieldClassName} value={form.adjustmentType} onChange={(event) => setForm((current) => ({ ...current, adjustmentType: event.target.value }))}>
          <option value="WAIVER">Waiver</option>
          <option value="DISCOUNT">Discount</option>
          <option value="CREDIT">Credit</option>
          <option value="WRITE_OFF">Write-off</option>
          <option value="MANUAL_ADJUSTMENT">Manual adjustment</option>
        </select>
      </label>
      <label className="space-y-2 text-sm font-medium text-slate-900">
        <span>Amount</span>
        <input required type="number" min="0.01" step="0.01" className={fieldClassName} value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} />
      </label>
      <label className="space-y-2 text-sm font-medium text-slate-900 md:col-span-2">
        <span>Reason</span>
        <input required minLength={3} className={fieldClassName} value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} />
      </label>
      <div className="flex items-end gap-3 md:col-span-4">
        <button disabled={saving} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:bg-slate-400">
          {saving ? "Recording..." : "Record Adjustment"}
        </button>
        {message ? <p className="text-sm text-slate-700">{message}</p> : null}
      </div>
    </form>
  );
}
