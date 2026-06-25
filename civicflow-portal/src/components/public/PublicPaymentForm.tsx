"use client";

import { useState, type FormEvent } from "react";

type Props = {
  slug: string;
  fixedAmount: number | null;
  minAmount: number;
};

const fieldClassName =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";

export function PublicPaymentForm({ slug, fixedAmount, minAmount }: Props) {
  const [amount, setAmount] = useState(fixedAmount ? fixedAmount.toFixed(2) : "");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const parsedAmount = fixedAmount ?? Number(amount);
    if (!fixedAmount && (Number.isNaN(parsedAmount) || parsedAmount < minAmount)) {
      setError(`Please enter an amount of at least $${minAmount.toFixed(2)}.`);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/pay/${slug}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: parsedAmount,
          contributorName: name.trim() || undefined,
          contributorEmail: email.trim() || undefined,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; url?: string; error?: string }
        | null;

      if (!response.ok || !payload?.ok || !payload.url) {
        setError(payload?.error ?? "Unable to start checkout. Please try again.");
        return;
      }

      window.location.href = payload.url;
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      {fixedAmount ? (
        <div className="rounded-xl bg-emerald-50 px-4 py-3 text-center">
          <p className="text-sm text-slate-600">Amount</p>
          <p className="text-3xl font-bold text-emerald-700">${fixedAmount.toFixed(2)}</p>
        </div>
      ) : (
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Amount (USD) <span className="text-red-600">*</span></span>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-500">$</span>
            <input
              required
              type="number"
              min={minAmount}
              step="0.01"
              className={`${fieldClassName} pl-7`}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={`${minAmount.toFixed(2)}`}
            />
          </div>
        </label>
      )}

      <label className="space-y-2 text-sm font-medium text-slate-900">
        <span>Your name <span className="text-slate-400 font-normal">(optional)</span></span>
        <input
          type="text"
          className={fieldClassName}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Jane Smith"
        />
      </label>

      <label className="space-y-2 text-sm font-medium text-slate-900">
        <span>Email for receipt <span className="text-slate-400 font-normal">(optional)</span></span>
        <input
          type="email"
          className={fieldClassName}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="jane@example.com"
        />
      </label>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-emerald-700 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        {loading ? "Redirecting to Stripe..." : "Pay now"}
      </button>
    </form>
  );
}
