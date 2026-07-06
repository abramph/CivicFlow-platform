"use client";

import { useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";
import { fieldClassName } from "@/components/forms/formStyles";

const PAYMENT_METHODS = ["CASH", "CHECK", "ZELLE", "CASH_APP", "VENMO", "PAYPAL", "CARD", "OTHER"];

const CATEGORIES: { value: string; label: string }[] = [
  { value: "MEMBERSHIP_DUES", label: "Membership Dues" },
  { value: "EVENT_REGISTRATION", label: "Event Registration" },
  { value: "DONATION", label: "Donation" },
  { value: "FUNDRAISER", label: "Fundraiser" },
  { value: "MERCHANDISE", label: "Merchandise" },
  { value: "SPONSORSHIP", label: "Sponsorship" },
  { value: "ASSESSMENT", label: "Assessment" },
  { value: "OTHER", label: "Other" },
];

export function MemberReportPaymentForm({ organizationId }: { organizationId: string }) {
  const searchParams = useSearchParams();
  const requestedCategory = searchParams.get("category");
  const initialCategory = CATEGORIES.some((option) => option.value === requestedCategory)
    ? requestedCategory!
    : CATEGORIES[0].value;

  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState(initialCategory);
  const [paymentMethod, setPaymentMethod] = useState(PAYMENT_METHODS[0]);
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [referenceNumber, setReferenceNumber] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/member-portal/report-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          amount: Number(amount),
          category,
          paymentMethod,
          paymentDate: new Date(paymentDate).toISOString(),
          referenceNumber: referenceNumber || null,
          note: note || null,
        }),
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !payload?.ok) {
        setError(payload?.error || "Unable to submit your payment report.");
        return;
      }
      setDone(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
        <p className="text-lg font-semibold text-emerald-900">Payment Reported</p>
        <p className="mt-2 text-sm text-emerald-800">Your organization&apos;s treasurer will review this and confirm it soon.</p>
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>What&apos;s this payment for?</span>
        <select className={fieldClassName} value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Amount</span>
        <input required type="number" step="0.01" min="0.01" className={fieldClassName} value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Payment Method</span>
        <select className={fieldClassName} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
          {PAYMENT_METHODS.map((method) => (
            <option key={method} value={method}>{method.replace("_", " ")}</option>
          ))}
        </select>
      </label>
      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Payment Date</span>
        <input required type="date" className={fieldClassName} value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
      </label>
      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Reference Number (optional)</span>
        <input className={fieldClassName} value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} />
      </label>
      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Note (optional)</span>
        <textarea rows={3} className={fieldClassName} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error ? <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
      <button disabled={submitting} className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
        {submitting ? "Submitting..." : "Submit Payment Report"}
      </button>
      <p className="text-xs text-slate-500">
        To attach a receipt photo, use the CivicFlow mobile app.
      </p>
    </form>
  );
}
