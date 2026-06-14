"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  classNames,
  fieldClassName,
  fieldErrorClassName,
} from "@/components/forms/formStyles";

type PaymentMethodOption = {
  method: string;
  label: string;
};

type ContributionEditFormProps = {
  contributionId: string;
  defaults: {
    amount: string;
    contributionDate: string;
    paymentMethod: string;
    notes: string;
    receiptRequested: boolean;
  };
  paymentMethods: PaymentMethodOption[];
  isLocked: boolean;
};

export function ContributionEditForm({
  contributionId,
  defaults,
  paymentMethods,
  isLocked,
}: ContributionEditFormProps) {
  const router = useRouter();
  const [form, setForm] = useState(defaults);
  const [editReason, setEditReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (fieldErrors[key as string]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key as string];
        return next;
      });
    }
  }

  function validate(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (!form.contributionDate) errs.contributionDate = "Date is required.";
    const amount = Number(form.amount);
    if (!form.amount.trim()) errs.amount = "Amount is required.";
    else if (Number.isNaN(amount) || amount <= 0) errs.amount = "Amount must be greater than zero.";
    return errs;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const errs = validate();
    setFieldErrors(errs);
    setError(null);
    if (Object.keys(errs).length > 0) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/contributions/${contributionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: Number(form.amount),
          contributionDate: `${form.contributionDate}T12:00:00.000Z`,
          paymentMethod: form.paymentMethod || null,
          notes: form.notes.trim() || null,
          receiptRequested: form.receiptRequested,
          editReason: editReason.trim() || undefined,
        }),
      });
      const payload = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        details?: { fieldErrors?: Record<string, string[] | undefined> };
      } | null;

      if (!res.ok || !payload?.ok) {
        const apiFieldErrors = payload?.details?.fieldErrors;
        if (apiFieldErrors) {
          const nextFieldErrors: Record<string, string> = {};
          for (const [field, messages] of Object.entries(apiFieldErrors)) {
            if (messages?.[0]) nextFieldErrors[field] = messages[0];
          }
          if (Object.keys(nextFieldErrors).length > 0) setFieldErrors(nextFieldErrors);
        }
        setError(payload?.error ?? "Failed to update contribution.");
        setSaving(false);
        return;
      }

      router.push(`/contributions/${contributionId}`);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
      setSaving(false);
    }
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block space-y-1.5 text-sm font-medium text-slate-900">
          <span>Amount</span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={form.amount}
            onChange={(e) => setField("amount", e.target.value)}
            disabled={isLocked}
            className={classNames(fieldClassName, fieldErrors.amount && fieldErrorClassName, isLocked && "opacity-50 cursor-not-allowed")}
          />
          {fieldErrors.amount ? (
            <p className="text-sm font-medium text-red-700">{fieldErrors.amount}</p>
          ) : null}
        </label>

        <label className="block space-y-1.5 text-sm font-medium text-slate-900">
          <span>Contribution date</span>
          <input
            type="date"
            value={form.contributionDate}
            onChange={(e) => setField("contributionDate", e.target.value)}
            disabled={isLocked}
            className={classNames(fieldClassName, fieldErrors.contributionDate && fieldErrorClassName, isLocked && "opacity-50 cursor-not-allowed")}
          />
          {fieldErrors.contributionDate ? (
            <p className="text-sm font-medium text-red-700">{fieldErrors.contributionDate}</p>
          ) : null}
        </label>

        <label className="block space-y-1.5 text-sm font-medium text-slate-900">
          <span>Payment method</span>
          <select
            value={form.paymentMethod}
            onChange={(e) => setField("paymentMethod", e.target.value)}
            className={fieldClassName}
          >
            <option value="">Not specified</option>
            {paymentMethods.map((m) => (
              <option key={m.method} value={m.method}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900">
        <input
          type="checkbox"
          checked={form.receiptRequested}
          onChange={(e) => setField("receiptRequested", e.target.checked)}
          className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
        />
        <span>
          <span className="block font-semibold">Receipt requested</span>
          <span className="block text-slate-700">Flag for receipt follow-up workflow.</span>
        </span>
      </label>

      <label className="block space-y-1.5 text-sm font-medium text-slate-900">
        <span>Notes</span>
        <textarea
          rows={4}
          value={form.notes}
          onChange={(e) => setField("notes", e.target.value)}
          className={fieldClassName}
        />
      </label>

      <label className="block space-y-1.5 text-sm font-medium text-slate-900">
        <span>Reason for edit <span className="font-normal text-slate-500">(optional — stored in audit log)</span></span>
        <input
          value={editReason}
          onChange={(e) => setEditReason(e.target.value)}
          className={fieldClassName}
          placeholder="Correcting data entry error, updating payment method…"
          maxLength={500}
        />
      </label>

      {error ? (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
          {error}
        </div>
      ) : null}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {saving ? "Saving…" : "Save Changes"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => router.push(`/contributions/${contributionId}`)}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
