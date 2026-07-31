"use client";

import { useState, type FormEvent } from "react";

type Props = {
  organizationId: string;
  fixedAmount: number | null;
  minAmount: number;
};

/**
 * Replaces a plain link to the anonymous /pay/[slug] page for the member
 * dues-checkout flow. That public flow has no concept of which member is
 * paying, so a card payment there could only ever become an unattributed
 * Contribution — never applied to the member's own dues balance. This posts
 * to the authenticated /api/member-portal/dues/checkout route instead, which
 * stamps the caller's real memberId into the Stripe session server-side.
 */
export function DuesCheckoutButton({ organizationId, fixedAmount, minAmount }: Props) {
  const [amount, setAmount] = useState(fixedAmount ? fixedAmount.toFixed(2) : "");
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
      const response = await fetch("/api/member-portal/dues/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, amount: parsedAmount }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; url?: string; error?: string }
        | null;

      if (!response.ok || !payload?.ok || !payload.url) {
        setError(payload?.error ?? "Unable to start checkout. Please try again.");
        setLoading(false);
        return;
      }

      window.location.href = payload.url;
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      {!fixedAmount ? (
        <label className="block space-y-1 text-sm font-medium text-slate-900">
          <span>Amount (USD)</span>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-500">$</span>
            <input
              required
              type="number"
              min={minAmount}
              step="0.01"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pl-7 text-sm text-slate-950 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={minAmount.toFixed(2)}
            />
          </div>
        </label>
      ) : null}

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <button
        type="submit"
        disabled={loading}
        className="block w-full rounded-lg bg-emerald-600 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        {loading ? "Redirecting to Stripe..." : "Pay Now via Card"}
      </button>
    </form>
  );
}
