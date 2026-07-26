"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const METHODS = ["CASH", "CHECK", "ZELLE", "CASH_APP", "VENMO", "PAYPAL", "OTHER"] as const;

export function PtaReportPaymentForm({ duesChargeId }: { duesChargeId: string }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<(typeof METHODS)[number]>("CASH");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function submit() {
    const amountCents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    setPending(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch("/api/labs/pta/my-household/dues/report-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duesChargeId, amountCents, paymentMethod: method, paymentDate, note: note || null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to submit — please try again.");
        return;
      }
      setSuccess(true);
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-sm font-semibold text-slate-900">Already paid another way? Let us know.</p>
      <p className="text-xs text-slate-600">A PTA officer will review and confirm this — your status will update once it&apos;s approved.</p>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="space-y-1 text-xs font-medium text-slate-700">
          <span>Amount paid ($)</span>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min={0.01} step="0.01" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="space-y-1 text-xs font-medium text-slate-700">
          <span>How did you pay?</span>
          <select value={method} onChange={(e) => setMethod(e.target.value as (typeof METHODS)[number])} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {METHODS.map((m) => (
              <option key={m} value={m}>{m.replace(/_/g, " ")}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs font-medium text-slate-700">
          <span>Payment date</span>
          <input value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} type="date" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
      </div>
      <label className="block space-y-1 text-xs font-medium text-slate-700">
        <span>Note (optional)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </label>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-700">Thanks — a PTA officer will review this shortly.</p> : null}
      <button
        type="button"
        disabled={pending}
        onClick={submit}
        className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
      >
        {pending ? "Submitting..." : "Report this payment"}
      </button>
    </div>
  );
}
