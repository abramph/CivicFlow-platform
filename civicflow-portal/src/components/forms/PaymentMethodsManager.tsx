"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { classNames, fieldClassName, fieldErrorClassName } from "@/components/forms/formStyles";
import { formatEnumLabel } from "@/lib/formatting";

const paymentMethods = [
  "CASH",
  "CHECK",
  "CREDIT_CARD",
  "DEBIT_CARD",
  "ACH",
  "ZELLE",
  "CASH_APP",
  "VENMO",
  "PAYPAL",
  "STRIPE",
  "OTHER",
] as const;

type PaymentMethod = (typeof paymentMethods)[number];

type PaymentMethodRow = {
  id: string;
  method: string;
  label: string;
  instructions: string | null;
  accountIdentifier: string | null;
  notes: string | null;
  isActive: boolean;
  sortOrder: number;
};

function emptyForm() {
  return {
    method: "CASH" as PaymentMethod,
    label: "Cash",
    instructions: "",
    accountIdentifier: "",
    notes: "",
    isActive: true,
    sortOrder: "0",
  };
}

export function PaymentMethodsManager({ methods, canWrite }: { methods: PaymentMethodRow[]; canWrite: boolean }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function setFieldValue<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function startEdit(method: PaymentMethodRow) {
    setEditingId(method.id);
    setForm({
      method: method.method as PaymentMethod,
      label: method.label,
      instructions: method.instructions ?? "",
      accountIdentifier: method.accountIdentifier ?? "",
      notes: method.notes ?? "",
      isActive: method.isActive,
      sortOrder: String(method.sortOrder),
    });
    setError(null);
    setFieldErrors({});
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm());
    setError(null);
    setFieldErrors({});
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};

    if (!form.label.trim()) {
      nextErrors.label = "Display label is required.";
    }
    if (Number.isNaN(Number(form.sortOrder)) || Number(form.sortOrder) < 0) {
      nextErrors.sortOrder = "Sort order must be zero or greater.";
    }

    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    setError(null);

    try {
      const response = await fetch(
        editingId ? `/api/settings/payment-methods/${editingId}` : "/api/settings/payment-methods",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(editingId ? {} : { method: form.method }),
            label: form.label.trim(),
            instructions: form.instructions.trim() || null,
            accountIdentifier: form.accountIdentifier.trim() || null,
            notes: form.notes.trim() || null,
            isActive: form.isActive,
            sortOrder: Number(form.sortOrder),
          }),
        }
      );

      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;

      if (!response.ok || !payload?.ok) {
        setError(payload?.error || "Failed to save the payment method.");
        return;
      }

      router.refresh();
      resetForm();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Failed to save the payment method."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {canWrite ? (
      <form className="space-y-5" onSubmit={handleSubmit}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Method</span>
            <select
              value={form.method}
              onChange={(event) => {
                const value = event.target.value as PaymentMethod;
                setForm((current) => ({
                  ...current,
                  method: value,
                  label: current.label || formatEnumLabel(value),
                }));
              }}
              className={fieldClassName}
              disabled={Boolean(editingId)}
            >
              {paymentMethods.map((method) => (
                <option key={method} value={method}>
                  {formatEnumLabel(method)}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Display label</span>
            <input
              value={form.label}
              onChange={(event) => setFieldValue("label", event.target.value)}
              className={classNames(fieldClassName, fieldErrors.label && fieldErrorClassName)}
            />
            {fieldErrors.label ? <p className="text-sm font-medium text-red-700">{fieldErrors.label}</p> : null}
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Sort order</span>
            <input
              type="number"
              min="0"
              value={form.sortOrder}
              onChange={(event) => setFieldValue("sortOrder", event.target.value)}
              className={classNames(fieldClassName, fieldErrors.sortOrder && fieldErrorClassName)}
            />
            {fieldErrors.sortOrder ? <p className="text-sm font-medium text-red-700">{fieldErrors.sortOrder}</p> : null}
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Account identifier</span>
            <input
              value={form.accountIdentifier}
              onChange={(event) => setFieldValue("accountIdentifier", event.target.value)}
              className={fieldClassName}
              placeholder="Zelle email, $cashtag, @handle, PayPal link"
            />
          </label>

          <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) => setFieldValue("isActive", event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
            />
            <span>Active method</span>
          </label>
        </div>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Payment instructions</span>
          <textarea
            rows={3}
            value={form.instructions}
            onChange={(event) => setFieldValue("instructions", event.target.value)}
            className={fieldClassName}
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Internal notes</span>
          <textarea
            rows={3}
            value={form.notes}
            onChange={(event) => setFieldValue("notes", event.target.value)}
            className={fieldClassName}
          />
        </label>

        {error ? (
          <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {saving ? "Saving..." : editingId ? "Save Payment Method" : "Create Payment Method"}
          </button>
          {editingId ? (
            <button
              type="button"
              onClick={resetForm}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
            >
              Cancel Edit
            </button>
          ) : null}
        </div>
      </form>
      ) : (
        <p className="text-sm text-slate-700">You have read-only access to payment methods.</p>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-700">
            <tr>
              <th className="px-4 py-3">Method</th>
              <th className="px-4 py-3">Label</th>
              <th className="px-4 py-3">Account</th>
              <th className="px-4 py-3">Instructions</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {methods.map((method) => (
              <tr key={method.id} className="border-t border-slate-100">
                <td className="px-4 py-3 text-slate-900">{formatEnumLabel(method.method)}</td>
                <td className="px-4 py-3 font-semibold text-slate-950">{method.label}</td>
                <td className="px-4 py-3 text-slate-900">{method.accountIdentifier || "-"}</td>
                <td className="px-4 py-3 text-slate-900">{method.instructions || "-"}</td>
                <td className="px-4 py-3 text-slate-900">{method.isActive ? "Active" : "Inactive"}</td>
                <td className="px-4 py-3">
                  {canWrite ? (
                    <button
                      type="button"
                      onClick={() => startEdit(method)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
                    >
                      Edit
                    </button>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
