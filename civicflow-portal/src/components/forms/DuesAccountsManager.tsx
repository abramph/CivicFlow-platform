"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  classNames,
  fieldClassName,
  fieldErrorClassName,
  helperTextClassName,
} from "@/components/forms/formStyles";
import { formatCurrency, formatEnumLabel, formatPersonName, formatText } from "@/lib/formatting";

type MemberOption = {
  id: string;
  firstName: string;
  lastName: string;
  preferredName?: string | null;
};

type DuesCategoryOption = {
  id: string;
  name: string;
  frequency: string | null;
  amountDefault: string | null;
};

type DuesAccountRow = {
  id: string;
  name: string;
  member: MemberOption | null;
  category: DuesCategoryOption | null;
  amountDefault: string | null;
  frequency: string;
  isActive: boolean;
  notes: string | null;
  chargeCount: number;
};

export function DuesAccountsManager({
  members,
  duesCategories,
  accounts,
}: {
  members: MemberOption[];
  duesCategories: DuesCategoryOption[];
  accounts: DuesAccountRow[];
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    memberId: "",
    categoryId: "",
    amountDefault: "",
    frequency: "monthly",
    isActive: true,
    notes: "",
  });
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};

    if (!form.name.trim()) {
      nextErrors.name = "Account name is required.";
    }

    if (!form.amountDefault.trim()) {
      nextErrors.amountDefault = "Default amount is required.";
    } else if (Number.isNaN(Number(form.amountDefault)) || Number(form.amountDefault) < 0) {
      nextErrors.amountDefault = "Default amount must be zero or greater.";
    }

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/dues/accounts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: form.name.trim(),
          memberId: form.memberId || null,
          categoryId: form.categoryId || null,
          amountDefault: Number(form.amountDefault),
          frequency: form.frequency,
          isActive: form.isActive,
          notes: form.notes.trim() || null,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;

      if (!response.ok || !payload?.ok) {
        setError(payload?.error || "Failed to create the dues account.");
        return;
      }

      router.refresh();
      setForm({
        name: "",
        memberId: "",
        categoryId: "",
        amountDefault: "",
        frequency: "monthly",
        isActive: true,
        notes: "",
      });
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Failed to create the dues account."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <form className="space-y-5" onSubmit={handleSubmit}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Account name</span>
            <input
              value={form.name}
              onChange={(event) => setFieldValue("name", event.target.value)}
              className={classNames(fieldClassName, fieldErrors.name && fieldErrorClassName)}
            />
            {fieldErrors.name ? <p className="text-sm font-medium text-red-700">{fieldErrors.name}</p> : null}
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Member assignment</span>
            <select
              value={form.memberId}
              onChange={(event) => setFieldValue("memberId", event.target.value)}
              className={fieldClassName}
            >
              <option value="">Shared account / no member assignment</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {formatPersonName(member)}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Dues category / plan</span>
            <select
              value={form.categoryId}
              onChange={(event) => setFieldValue("categoryId", event.target.value)}
              className={fieldClassName}
            >
              <option value="">No linked dues category</option>
              {duesCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            <p className={helperTextClassName}>Linking a dues category keeps setup aligned with category-based billing.</p>
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Standard amount</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.amountDefault}
              onChange={(event) => setFieldValue("amountDefault", event.target.value)}
              className={classNames(fieldClassName, fieldErrors.amountDefault && fieldErrorClassName)}
            />
            {fieldErrors.amountDefault ? (
              <p className="text-sm font-medium text-red-700">{fieldErrors.amountDefault}</p>
            ) : null}
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Frequency</span>
            <select
              value={form.frequency}
              onChange={(event) => setFieldValue("frequency", event.target.value)}
              className={fieldClassName}
            >
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="annual">Annual</option>
              <option value="one-time">One-time</option>
            </select>
          </label>

          <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) => setFieldValue("isActive", event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
            />
            <span>Account is active</span>
          </label>
        </div>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Notes</span>
          <textarea
            rows={4}
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

        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {saving ? "Creating..." : "Create Dues Account"}
        </button>
      </form>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-700">
            <tr>
              <th className="px-4 py-3">Account</th>
              <th className="px-4 py-3">Member</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Frequency</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Charges</th>
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-600">
                  No dues accounts have been created yet.
                </td>
              </tr>
            ) : (
              accounts.map((account) => (
                <tr key={account.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-slate-950">
                    <p className="font-semibold">{account.name}</p>
                    {account.notes ? <p className="mt-1 text-xs text-slate-700">{account.notes}</p> : null}
                  </td>
                  <td className="px-4 py-3 text-slate-900">
                    {account.member ? formatPersonName(account.member) : "Shared"}
                  </td>
                  <td className="px-4 py-3 text-slate-900">
                    {account.category ? account.category.name : "No linked category"}
                  </td>
                  <td className="px-4 py-3 text-slate-900">{formatEnumLabel(account.frequency)}</td>
                  <td className="px-4 py-3 text-slate-900">{formatCurrency(account.amountDefault)}</td>
                  <td className="px-4 py-3 text-slate-900">{account.isActive ? "Active" : "Inactive"}</td>
                  <td className="px-4 py-3 text-slate-900">{account.chargeCount}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
