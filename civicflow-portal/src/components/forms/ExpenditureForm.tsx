"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { classNames, fieldClassName, fieldErrorClassName } from "@/components/forms/formStyles";

type Option = { id: string; label: string };
type ExistingExpenditure = {
  id: string;
  date: string;
  vendor: string | null;
  categoryId: string | null;
  category: string | null;
  amount: string;
  paymentMethodId: string | null;
  paymentMethod: string | null;
  description: string;
  notes: string | null;
  reference: string | null;
  receiptUrl: string | null;
  campaignId: string | null;
  eventId: string | null;
};

function toIsoDate(value: string) {
  return value ? `${value}T12:00:00.000Z` : null;
}

export function ExpenditureForm({
  mode,
  expenditure,
  categories,
  paymentMethods,
  campaigns,
  events,
}: {
  mode: "create" | "edit";
  expenditure?: ExistingExpenditure;
  categories: Option[];
  paymentMethods: Option[];
  campaigns: Option[];
  events: Option[];
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    date: expenditure?.date ?? new Date().toISOString().slice(0, 10),
    vendor: expenditure?.vendor ?? "",
    categoryId: expenditure?.categoryId ?? "",
    category: expenditure?.category ?? "",
    amount: expenditure?.amount ?? "",
    paymentMethodId: expenditure?.paymentMethodId ?? "",
    paymentMethod: expenditure?.paymentMethod ?? "",
    description: expenditure?.description ?? "",
    notes: expenditure?.notes ?? "",
    reference: expenditure?.reference ?? "",
    receiptUrl: expenditure?.receiptUrl ?? "",
    campaignId: expenditure?.campaignId ?? "",
    eventId: expenditure?.eventId ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (!form.date) nextErrors.date = "Date is required.";
    if (!form.amount.trim() || Number.isNaN(Number(form.amount)) || Number(form.amount) <= 0) nextErrors.amount = "Amount must be greater than zero.";
    if (!form.description.trim()) nextErrors.description = "Description is required.";
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(mode === "edit" && expenditure ? `/api/expenditures/${expenditure.id}` : "/api/expenditures", {
        method: mode === "edit" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: toIsoDate(form.date),
          vendor: form.vendor.trim() || null,
          categoryId: form.categoryId || null,
          category: form.category.trim() || null,
          amount: Number(form.amount),
          paymentMethodId: form.paymentMethodId || null,
          paymentMethod: form.paymentMethod.trim() || null,
          description: form.description.trim(),
          notes: form.notes.trim() || null,
          reference: form.reference.trim() || null,
          receiptUrl: form.receiptUrl.trim() || null,
          campaignId: form.campaignId || null,
          eventId: form.eventId || null,
        }),
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; data?: { id: string } } | null;
      if (!response.ok || !payload?.ok) {
        setError(payload?.error || "Failed to save expenditure.");
        return;
      }
      router.push(payload.data?.id ? `/expenditures/${payload.data.id}` : "/expenditures");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <label className="space-y-2 text-sm font-medium text-slate-900"><span>Date</span><input type="date" value={form.date} onChange={(e) => setField("date", e.target.value)} className={classNames(fieldClassName, fieldErrors.date && fieldErrorClassName)} />{fieldErrors.date ? <p className="text-sm font-medium text-red-700">{fieldErrors.date}</p> : null}</label>
        <label className="space-y-2 text-sm font-medium text-slate-900"><span>Vendor / payee</span><input value={form.vendor} onChange={(e) => setField("vendor", e.target.value)} className={fieldClassName} /></label>
        <label className="space-y-2 text-sm font-medium text-slate-900"><span>Amount</span><input type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => setField("amount", e.target.value)} className={classNames(fieldClassName, fieldErrors.amount && fieldErrorClassName)} />{fieldErrors.amount ? <p className="text-sm font-medium text-red-700">{fieldErrors.amount}</p> : null}</label>
        <label className="space-y-2 text-sm font-medium text-slate-900"><span>Category</span><select value={form.categoryId} onChange={(e) => setField("categoryId", e.target.value)} className={fieldClassName}><option value="">Fallback/manual category</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label className="space-y-2 text-sm font-medium text-slate-900"><span>Fallback category</span><input value={form.category} onChange={(e) => setField("category", e.target.value)} className={fieldClassName} /></label>
        <label className="space-y-2 text-sm font-medium text-slate-900"><span>Payment method</span><select value={form.paymentMethodId} onChange={(e) => setField("paymentMethodId", e.target.value)} className={fieldClassName}><option value="">Fallback/manual method</option>{paymentMethods.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label className="space-y-2 text-sm font-medium text-slate-900"><span>Fallback payment method</span><input value={form.paymentMethod} onChange={(e) => setField("paymentMethod", e.target.value)} className={fieldClassName} /></label>
        <label className="space-y-2 text-sm font-medium text-slate-900"><span>Reference / receipt #</span><input value={form.reference} onChange={(e) => setField("reference", e.target.value)} className={fieldClassName} /></label>
        <label className="space-y-2 text-sm font-medium text-slate-900"><span>Receipt URL</span><input value={form.receiptUrl} onChange={(e) => setField("receiptUrl", e.target.value)} className={fieldClassName} /></label>
        <label className="space-y-2 text-sm font-medium text-slate-900"><span>Campaign</span><select value={form.campaignId} onChange={(e) => setField("campaignId", e.target.value)} className={fieldClassName}><option value="">No campaign</option>{campaigns.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label className="space-y-2 text-sm font-medium text-slate-900"><span>Event</span><select value={form.eventId} onChange={(e) => setField("eventId", e.target.value)} className={fieldClassName}><option value="">No event</option>{events.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      </div>
      <label className="space-y-2 text-sm font-medium text-slate-900"><span>Description</span><input value={form.description} onChange={(e) => setField("description", e.target.value)} className={classNames(fieldClassName, fieldErrors.description && fieldErrorClassName)} />{fieldErrors.description ? <p className="text-sm font-medium text-red-700">{fieldErrors.description}</p> : null}</label>
      <label className="space-y-2 text-sm font-medium text-slate-900"><span>Notes</span><textarea rows={4} value={form.notes} onChange={(e) => setField("notes", e.target.value)} className={fieldClassName} /></label>
      {error ? <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
      <button type="submit" disabled={saving} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:bg-slate-400">{saving ? "Saving..." : mode === "edit" ? "Save Expenditure" : "Add Expenditure"}</button>
    </form>
  );
}

