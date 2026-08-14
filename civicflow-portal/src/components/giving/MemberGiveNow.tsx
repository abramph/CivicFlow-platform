"use client";

import { useState } from "react";

function money(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

interface FundView {
  id: string;
  name: string;
  description: string | null;
  suggestedAmounts: number[];
  minimumAmount: number | null;
  maximumAmount: number | null;
}

/** CORE-GIVE-B — Give Now + history. The server re-validates everything; the
 * redirect to Stripe never records the gift (the webhook does). */
export function MemberGiveNow({
  organizationId,
  terminology,
  funds,
  yearTotal,
  history,
}: {
  organizationId: string;
  terminology: string;
  funds: FundView[];
  yearTotal: number;
  history: { id: string; contributionNumber: string | null; amount: number; date: string; designation: string }[];
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fundId, setFundId] = useState(funds[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");

  const fund = funds.find((row) => row.id === fundId) ?? null;

  async function giveNow() {
    const value = Number(amount);
    if (!fund || !Number.isFinite(value) || value <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/giving/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, fundId: fund.id, amount: value, memo: memo.trim() || null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || !data.url) {
        setError(data?.error || "Unable to start checkout.");
        return;
      }
      window.location.href = data.url as string;
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-slate-900">Give Now</h2>
        {funds.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">No funds are open for online giving right now.</p>
        ) : (
          <div className="mt-3 space-y-3">
            <label className="block space-y-1 text-sm font-medium text-slate-900">
              <span>Fund</span>
              <select
                value={fundId}
                onChange={(event) => setFundId(event.target.value)}
                className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                {funds.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
            {fund?.description ? <p className="text-xs text-slate-500">{fund.description}</p> : null}
            {fund && fund.suggestedAmounts.length > 0 ? (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Suggested amounts">
                {fund.suggestedAmounts.map((suggested) => (
                  <button
                    key={suggested}
                    type="button"
                    onClick={() => setAmount(String(suggested))}
                    className={`rounded-full border px-4 py-1.5 text-sm font-semibold ${
                      Number(amount) === suggested
                        ? "border-emerald-700 bg-emerald-700 text-white"
                        : "border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
                    }`}
                  >
                    ${suggested}
                  </button>
                ))}
              </div>
            ) : null}
            <label className="block space-y-1 text-sm font-medium text-slate-900">
              <span>Amount ($)</span>
              <input
                type="number"
                inputMode="decimal"
                min={fund?.minimumAmount ?? 1}
                max={fund?.maximumAmount ?? undefined}
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base"
              />
            </label>
            <label className="block space-y-1 text-sm font-medium text-slate-900">
              <span>Note (optional)</span>
              <input
                value={memo}
                onChange={(event) => setMemo(event.target.value)}
                maxLength={200}
                placeholder="In honor of…"
                className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              />
            </label>
            <button
              type="button"
              disabled={pending || !fund || !amount}
              onClick={giveNow}
              className="w-full rounded-lg bg-emerald-700 px-4 py-3 text-base font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {pending ? "Opening secure checkout…" : "Continue to secure payment"}
            </button>
            <p className="text-xs text-slate-500">Card payments are processed by Stripe. Your card details never touch Unestra.</p>
          </div>
        )}
        {error ? (
          <p role="alert" className="mt-2 text-sm font-medium text-red-700">
            {error}
          </p>
        ) : null}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-slate-900">My {terminology}</h2>
          <p className="text-sm text-slate-600">
            {new Date().getFullYear()}: <span className="font-semibold text-slate-900">{money(yearTotal)}</span>
          </p>
        </div>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">No contributions yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">
            {history.map((row) => (
              <li key={row.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-slate-800">
                  {new Date(row.date).toLocaleDateString()} — {row.designation}
                  {row.contributionNumber ? <span className="ml-2 font-mono text-xs text-slate-400">{row.contributionNumber}</span> : null}
                </span>
                <span className="font-semibold text-slate-900">{money(row.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
