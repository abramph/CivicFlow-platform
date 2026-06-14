"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { classNames, fieldClassName, fieldErrorClassName, helperTextClassName } from "@/components/forms/formStyles";
import { formatCurrency, formatDate, formatEnumLabel } from "@/lib/formatting";

type MemberOption = { id: string; firstName: string; lastName: string; preferredName?: string | null };
type ChargeOption = { id: string; memberId: string; duesAccountId: string; dueDate: string; status: string; amountDue: string; amountPaid: string; accountName: string };
type AccountOption = { id: string; name: string; memberId: string | null; amountDefault: string | null; frequency: string };
type PaymentMethodOption = { id: string; method: string; label: string; instructions: string | null };

function toIsoDate(value: string) {
  return value ? `${value}T12:00:00.000Z` : null;
}

function memberName(member: MemberOption) {
  return `${member.lastName}, ${member.preferredName || member.firstName}`;
}

export function DuesPaymentCreateForm({
  members,
  charges,
  accounts,
  paymentMethods,
  defaults,
}: {
  members: MemberOption[];
  charges: ChargeOption[];
  accounts: AccountOption[];
  paymentMethods: PaymentMethodOption[];
  defaults: { memberId?: string; chargeId?: string; accountId?: string };
}) {
  const router = useRouter();
  const defaultCharge = charges.find((charge) => charge.id === defaults.chargeId);
  const defaultAccount = accounts.find((account) => account.id === (defaults.accountId || defaultCharge?.duesAccountId));
  const resolvedMemberId = defaults.memberId || defaultCharge?.memberId || defaultAccount?.memberId || "";
  const [form, setForm] = useState({
    memberId: resolvedMemberId,
    duesChargeId: defaultCharge?.id ?? "",
    duesAccountId: defaultAccount?.id ?? "",
    amount: defaultCharge ? String(Math.max(0, Number(defaultCharge.amountDue) - Number(defaultCharge.amountPaid)).toFixed(2)) : "",
    paymentDate: new Date().toISOString().slice(0, 10),
    paymentMethodId: paymentMethods[0]?.id ?? "",
    referenceNumber: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const filteredCharges = useMemo(
    () => charges.filter((charge) => !form.memberId || charge.memberId === form.memberId),
    [charges, form.memberId]
  );
  const filteredAccounts = useMemo(
    () => accounts.filter((account) => !form.memberId || !account.memberId || account.memberId === form.memberId),
    [accounts, form.memberId]
  );
  const selectedMethod = paymentMethods.find((method) => method.id === form.paymentMethodId);

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
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
    if (!form.memberId && !form.duesChargeId && !form.duesAccountId) nextErrors.memberId = "Select a member, charge, or account.";
    if (!form.amount.trim() || Number.isNaN(Number(form.amount)) || Number(form.amount) <= 0) nextErrors.amount = "Amount must be greater than zero.";
    if (!form.paymentDate) nextErrors.paymentDate = "Payment date is required.";
    if (!form.paymentMethodId) nextErrors.paymentMethodId = "Payment method is required.";
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/dues/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId: form.memberId || null,
          duesChargeId: form.duesChargeId || null,
          duesAccountId: form.duesAccountId || null,
          amount: Number(form.amount),
          paymentDate: toIsoDate(form.paymentDate),
          paymentMethodId: form.paymentMethodId,
          referenceNumber: form.referenceNumber.trim() || null,
          notes: form.notes.trim() || null,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; data?: { id: string; memberId: string } }
        | null;
      if (!response.ok || !payload?.ok || !payload.data) {
        setError(payload?.error || "Failed to record dues payment.");
        return;
      }
      router.push(payload.data.memberId ? `/members/${payload.data.memberId}` : `/dues/payments/${payload.data.id}`);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Member</span>
          <select value={form.memberId} onChange={(event) => setField("memberId", event.target.value)} className={classNames(fieldClassName, fieldErrors.memberId && fieldErrorClassName)}>
            <option value="">Resolve from charge/account</option>
            {members.map((member) => <option key={member.id} value={member.id}>{memberName(member)}</option>)}
          </select>
          {fieldErrors.memberId ? <p className="text-sm font-medium text-red-700">{fieldErrors.memberId}</p> : null}
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Dues charge</span>
          <select value={form.duesChargeId} onChange={(event) => {
            const charge = charges.find((item) => item.id === event.target.value);
            setForm((current) => ({
              ...current,
              duesChargeId: event.target.value,
              duesAccountId: charge?.duesAccountId ?? current.duesAccountId,
              memberId: charge?.memberId ?? current.memberId,
              amount: charge ? String(Math.max(0, Number(charge.amountDue) - Number(charge.amountPaid)).toFixed(2)) : current.amount,
            }));
          }} className={fieldClassName}>
            <option value="">Unapplied payment</option>
            {filteredCharges.map((charge) => (
              <option key={charge.id} value={charge.id}>
                {charge.accountName} - {formatDate(charge.dueDate)} - {formatCurrency(Number(charge.amountDue) - Number(charge.amountPaid))}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Dues account</span>
          <select value={form.duesAccountId} onChange={(event) => {
            const account = accounts.find((item) => item.id === event.target.value);
            setForm((current) => ({
              ...current,
              duesAccountId: event.target.value,
              memberId: account?.memberId ?? current.memberId,
              amount: !current.amount && account?.amountDefault ? account.amountDefault : current.amount,
            }));
          }} className={fieldClassName}>
            <option value="">No account selected</option>
            {filteredAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} - {formatEnumLabel(account.frequency)}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Amount</span>
          <input type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => setField("amount", event.target.value)} className={classNames(fieldClassName, fieldErrors.amount && fieldErrorClassName)} />
          {fieldErrors.amount ? <p className="text-sm font-medium text-red-700">{fieldErrors.amount}</p> : null}
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Payment date</span>
          <input type="date" value={form.paymentDate} onChange={(event) => setField("paymentDate", event.target.value)} className={classNames(fieldClassName, fieldErrors.paymentDate && fieldErrorClassName)} />
          {fieldErrors.paymentDate ? <p className="text-sm font-medium text-red-700">{fieldErrors.paymentDate}</p> : null}
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Payment method</span>
          <select value={form.paymentMethodId} onChange={(event) => setField("paymentMethodId", event.target.value)} className={classNames(fieldClassName, fieldErrors.paymentMethodId && fieldErrorClassName)}>
            {paymentMethods.map((method) => <option key={method.id} value={method.id}>{method.label}</option>)}
          </select>
          {selectedMethod?.instructions ? <p className={helperTextClassName}>{selectedMethod.instructions}</p> : null}
          {fieldErrors.paymentMethodId ? <p className="text-sm font-medium text-red-700">{fieldErrors.paymentMethodId}</p> : null}
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Reference number</span>
          <input value={form.referenceNumber} onChange={(event) => setField("referenceNumber", event.target.value)} className={fieldClassName} />
        </label>
      </div>

      <label className="space-y-2 text-sm font-medium text-slate-900">
        <span>Notes</span>
        <textarea rows={4} value={form.notes} onChange={(event) => setField("notes", event.target.value)} className={fieldClassName} />
      </label>

      {error ? <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={saving} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:bg-slate-400">{saving ? "Recording..." : "Record Payment"}</button>
        <button type="button" disabled={saving} onClick={() => router.push("/dues/payments")} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50">Cancel</button>
      </div>
    </form>
  );
}

