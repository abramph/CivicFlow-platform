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

type DuesChargeOption = {
  id: string;
  memberId: string;
  dueDate: string;
  status: string;
  amountDue: string;
  amountPaid: string;
  accountName: string;
};

type DuesPaymentRow = {
  id: string;
  member: MemberOption;
  duesCharge: {
    id: string;
    dueDate: string;
    status: string;
  } | null;
  duesAccount: {
    id: string;
    name: string;
  } | null;
  paymentDate: string;
  method: string;
  amount: string;
  reference: string | null;
  notes: string | null;
};

type PaymentMethodOption = {
  method: string;
  label: string;
  instructions?: string | null;
};

function toIsoDate(value: string) {
  if (!value) return null;
  return `${value}T12:00:00.000Z`;
}

export function DuesPaymentsManager({
  members,
  charges,
  payments,
  paymentMethods,
  paymentMethodLabels,
  canWrite,
}: {
  members: MemberOption[];
  charges: DuesChargeOption[];
  payments: DuesPaymentRow[];
  paymentMethods: PaymentMethodOption[];
  paymentMethodLabels: Record<string, string>;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    memberId: "",
    duesChargeId: "",
    amount: "",
    paymentDate: new Date().toISOString().slice(0, 10),
    method: paymentMethods[0]?.method ?? "CASH",
    reference: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const filteredCharges = charges.filter(
    (charge) => !form.memberId || charge.memberId === form.memberId
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};

    if (!form.memberId) {
      nextErrors.memberId = "Select a member.";
    }
    if (!form.amount.trim()) {
      nextErrors.amount = "Amount is required.";
    } else if (Number.isNaN(Number(form.amount)) || Number(form.amount) <= 0) {
      nextErrors.amount = "Amount must be greater than zero.";
    }
    if (!form.paymentDate) {
      nextErrors.paymentDate = "Payment date is required.";
    }

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/dues/payments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          memberId: form.memberId,
          duesChargeId: form.duesChargeId || null,
          amount: Number(form.amount),
          paymentDate: toIsoDate(form.paymentDate),
          method: form.method,
          reference: form.reference.trim() || null,
          notes: form.notes.trim() || null,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;

      if (!response.ok || !payload?.ok) {
        setError(payload?.error || "Failed to create the dues payment.");
        return;
      }

      router.refresh();
      setForm({
        memberId: "",
        duesChargeId: "",
        amount: "",
        paymentDate: new Date().toISOString().slice(0, 10),
        method: paymentMethods[0]?.method ?? "CASH",
        reference: "",
        notes: "",
      });
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Failed to create the dues payment."
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
            <span>Apply to charge</span>
            <select
              value={form.duesChargeId}
              onChange={(event) => setFieldValue("duesChargeId", event.target.value)}
              className={fieldClassName}
            >
              <option value="">Unapplied payment</option>
              {filteredCharges.map((charge) => (
                <option key={charge.id} value={charge.id}>
                  {charge.accountName} · {formatDate(charge.dueDate)} · {formatEnumLabel(charge.status)}
                </option>
              ))}
            </select>
            <p className={helperTextClassName}>Applying the payment will update the charge balance and status automatically.</p>
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Amount</span>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={form.amount}
              onChange={(event) => setFieldValue("amount", event.target.value)}
              className={classNames(fieldClassName, fieldErrors.amount && fieldErrorClassName)}
            />
            {fieldErrors.amount ? <p className="text-sm font-medium text-red-700">{fieldErrors.amount}</p> : null}
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Payment date</span>
            <input
              type="date"
              value={form.paymentDate}
              onChange={(event) => setFieldValue("paymentDate", event.target.value)}
              className={classNames(fieldClassName, fieldErrors.paymentDate && fieldErrorClassName)}
            />
            {fieldErrors.paymentDate ? <p className="text-sm font-medium text-red-700">{fieldErrors.paymentDate}</p> : null}
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Payment method</span>
            <select
              value={form.method}
              onChange={(event) => setFieldValue("method", event.target.value)}
              className={fieldClassName}
            >
              {paymentMethods.map((method) => (
                <option key={method.method} value={method.method}>
                  {method.label}
                </option>
              ))}
            </select>
            {paymentMethods.find((method) => method.method === form.method)?.instructions ? (
              <p className={helperTextClassName}>
                {paymentMethods.find((method) => method.method === form.method)?.instructions}
              </p>
            ) : null}
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900 md:col-span-2 xl:col-span-3">
            <span>Reference</span>
            <input
              value={form.reference}
              onChange={(event) => setFieldValue("reference", event.target.value)}
              className={fieldClassName}
            />
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
          {saving ? "Recording..." : "Record Dues Payment"}
        </button>
      </form>
      ) : (
        <p className="text-sm text-slate-700">You have read-only access to dues payments.</p>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-700">
            <tr>
              <th className="px-4 py-3">Member</th>
              <th className="px-4 py-3">Payment date</th>
              <th className="px-4 py-3">Method</th>
              <th className="px-4 py-3">Applied charge</th>
              <th className="px-4 py-3">Account</th>
              <th className="px-4 py-3">Reference</th>
              <th className="px-4 py-3">Amount</th>
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-600">
                  No dues payments have been recorded yet.
                </td>
              </tr>
            ) : (
              payments.map((payment) => (
                <tr key={payment.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-slate-900">
                    <Link href={`/members/${payment.member.id}`} className="font-semibold text-emerald-700 hover:underline">
                      {formatPersonName(payment.member)}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-900">{formatDate(payment.paymentDate)}</td>
                  <td className="px-4 py-3 text-slate-900">{paymentMethodLabels[payment.method] ?? formatEnumLabel(payment.method)}</td>
                  <td className="px-4 py-3 text-slate-900">
                    {payment.duesCharge ? (
                      <Link href={`/dues/payments/${payment.id}`} className="text-emerald-700 hover:underline">
                        {formatDate(payment.duesCharge.dueDate)} · {formatEnumLabel(payment.duesCharge.status)}
                      </Link>
                    ) : (
                      "Unapplied"
                    )}
                    {payment.notes ? <p className="mt-1 text-xs text-slate-700">{payment.notes}</p> : null}
                  </td>
                  <td className="px-4 py-3 text-slate-900">{payment.duesAccount?.name ?? "No account"}</td>
                  <td className="px-4 py-3 text-slate-900">{payment.reference || "—"}</td>
                  <td className="px-4 py-3 text-slate-900">{formatCurrency(payment.amount)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
