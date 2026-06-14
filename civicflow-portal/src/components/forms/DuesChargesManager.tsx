"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  classNames,
  fieldClassName,
  fieldErrorClassName,
  helperTextClassName,
} from "@/components/forms/formStyles";
import {
  formatCurrency,
  formatDate,
  formatEnumLabel,
  formatPersonName,
} from "@/lib/formatting";

type MemberOption = {
  id: string;
  firstName: string;
  lastName: string;
  preferredName?: string | null;
};

type DuesAccountOption = {
  id: string;
  name: string;
  memberId: string | null;
  categoryName: string | null;
  amountDefault: string | null;
  frequency: string;
};

type DuesChargeRow = {
  id: string;
  member: MemberOption;
  duesAccount: {
    id: string;
    name: string;
  };
  dueDate: string;
  status: string;
  amountDue: string;
  amountPaid: string;
  notes: string | null;
};

function toIsoDate(value: string) {
  if (!value) return null;
  return `${value}T12:00:00.000Z`;
}

export function DuesChargesManager({
  members,
  accounts,
  charges,
  defaultMemberId = "",
}: {
  members: MemberOption[];
  accounts: DuesAccountOption[];
  charges: DuesChargeRow[];
  defaultMemberId?: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    memberId: defaultMemberId,
    duesAccountId: "",
    amountDue: "",
    dueDate: new Date().toISOString().slice(0, 10),
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const filteredAccounts = accounts.filter(
    (account) => !account.memberId || !form.memberId || account.memberId === form.memberId
  );

  function setFieldValue<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function applyAccountDefaults(accountId: string) {
    const selectedAccount = accounts.find((account) => account.id === accountId);
    setForm((current) => ({
      ...current,
      duesAccountId: accountId,
      amountDue: current.amountDue || selectedAccount?.amountDefault || "",
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};

    if (!form.memberId) {
      nextErrors.memberId = "Select a member.";
    }
    if (!form.duesAccountId) {
      nextErrors.duesAccountId = "Select a dues account.";
    }
    if (!form.amountDue.trim()) {
      nextErrors.amountDue = "Amount due is required.";
    } else if (Number.isNaN(Number(form.amountDue)) || Number(form.amountDue) < 0) {
      nextErrors.amountDue = "Amount due must be zero or greater.";
    }
    if (!form.dueDate) {
      nextErrors.dueDate = "Due date is required.";
    }

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/dues/charges", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          memberId: form.memberId,
          duesAccountId: form.duesAccountId,
          amountDue: Number(form.amountDue),
          dueDate: toIsoDate(form.dueDate),
          notes: form.notes.trim() || null,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;

      if (!response.ok || !payload?.ok) {
        setError(payload?.error || "Failed to create the dues charge.");
        return;
      }

      router.refresh();
      setForm({
        memberId: defaultMemberId,
        duesAccountId: "",
        amountDue: "",
        dueDate: new Date().toISOString().slice(0, 10),
        notes: "",
      });
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Failed to create the dues charge."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <form className="space-y-5" onSubmit={handleSubmit}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Member</span>
            <select
              value={form.memberId}
              onChange={(event) => setFieldValue("memberId", event.target.value)}
              className={classNames(fieldClassName, fieldErrors.memberId && fieldErrorClassName)}
            >
              <option value="">Select a member</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {formatPersonName(member)}
                </option>
              ))}
            </select>
            {fieldErrors.memberId ? <p className="text-sm font-medium text-red-700">{fieldErrors.memberId}</p> : null}
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Dues account</span>
            <select
              value={form.duesAccountId}
              onChange={(event) => applyAccountDefaults(event.target.value)}
              className={classNames(fieldClassName, fieldErrors.duesAccountId && fieldErrorClassName)}
            >
              <option value="">Select a dues account</option>
              {filteredAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} ({formatEnumLabel(account.frequency)})
                </option>
              ))}
            </select>
            {fieldErrors.duesAccountId ? (
              <p className="text-sm font-medium text-red-700">{fieldErrors.duesAccountId}</p>
            ) : null}
            <p className={helperTextClassName}>Accounts assigned to a different member are hidden.</p>
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Amount due</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.amountDue}
              onChange={(event) => setFieldValue("amountDue", event.target.value)}
              className={classNames(fieldClassName, fieldErrors.amountDue && fieldErrorClassName)}
            />
            {fieldErrors.amountDue ? <p className="text-sm font-medium text-red-700">{fieldErrors.amountDue}</p> : null}
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Due date</span>
            <input
              type="date"
              value={form.dueDate}
              onChange={(event) => setFieldValue("dueDate", event.target.value)}
              className={classNames(fieldClassName, fieldErrors.dueDate && fieldErrorClassName)}
            />
            {fieldErrors.dueDate ? <p className="text-sm font-medium text-red-700">{fieldErrors.dueDate}</p> : null}
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
          {saving ? "Creating..." : "Create Dues Charge"}
        </button>
      </form>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-700">
            <tr>
              <th className="px-4 py-3">Member</th>
              <th className="px-4 py-3">Account</th>
              <th className="px-4 py-3">Due date</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Amount due</th>
              <th className="px-4 py-3">Amount paid</th>
              <th className="px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {charges.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-600">
                  No dues charges have been recorded yet.
                </td>
              </tr>
            ) : (
              charges.map((charge) => (
                <tr key={charge.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-slate-900">
                    <Link href={`/members/${charge.member.id}`} className="font-semibold text-emerald-700 hover:underline">
                      {formatPersonName(charge.member)}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-900">
                    <Link href={`/dues/charges/${charge.id}`} className="text-emerald-700 hover:underline">
                      {charge.duesAccount.name}
                    </Link>
                    {charge.notes ? <p className="mt-1 text-xs text-slate-700">{charge.notes}</p> : null}
                  </td>
                  <td className="px-4 py-3 text-slate-900">{formatDate(charge.dueDate)}</td>
                  <td className="px-4 py-3 text-slate-900">{formatEnumLabel(charge.status)}</td>
                  <td className="px-4 py-3 text-slate-900">{formatCurrency(charge.amountDue)}</td>
                  <td className="px-4 py-3 text-slate-900">{formatCurrency(charge.amountPaid)}</td>
                  <td className="px-4 py-3 text-slate-900">
                    {["PENDING", "PARTIAL"].includes(charge.status) ? (
                      <Link
                        href={`/dues/payments/new?chargeId=${charge.id}`}
                        className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
                      >
                        Pay
                      </Link>
                    ) : (
                      <span className="text-xs text-slate-500">Paid</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
