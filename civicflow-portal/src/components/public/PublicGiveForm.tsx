"use client";

import { useState } from "react";

interface PublicFund {
  id: string;
  name: string;
  description: string | null;
  suggestedAmounts: number[];
  minimumAmount: number | null;
  maximumAmount: number | null;
}

/** CORE-GIVE-J — guest gift form. The server re-validates everything; this
 * form never sees or reveals anything about the organization's roster. */
export function PublicGiveForm({ slug, funds }: { slug: string; funds: PublicFund[] }) {
  const [fundId, setFundId] = useState(funds[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fund = funds.find((candidate) => candidate.id === fundId) ?? funds[0];

  async function give() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/public/give", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          fundId,
          amount: Number(amount),
          guestName: guestName.trim() || null,
          guestEmail: guestEmail.trim() || null,
          anonymous,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to start your gift. Please try again.");
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  const inputClass =
    "block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-slate-900">Give</h2>
      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">{error}</p> : null}

      {funds.length > 1 ? (
        <label className="block space-y-1 text-sm font-medium text-slate-900">
          <span>Designation</span>
          <select value={fundId} onChange={(event) => setFundId(event.target.value)} className={inputClass}>
            {funds.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="text-sm text-slate-700">
          Giving to <span className="font-semibold">{fund?.name}</span>
        </p>
      )}
      {fund?.description ? <p className="text-xs text-slate-500">{fund.description}</p> : null}

      {fund && fund.suggestedAmounts.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {fund.suggestedAmounts.map((suggested) => (
            <button
              key={suggested}
              type="button"
              onClick={() => setAmount(String(suggested))}
              className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${
                Number(amount) === suggested
                  ? "border-emerald-600 bg-emerald-50 text-emerald-900"
                  : "border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
              }`}
            >
              ${suggested}
            </button>
          ))}
        </div>
      ) : null}

      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Amount (USD)</span>
        <input
          type="number"
          min={fund?.minimumAmount ?? 1}
          max={fund?.maximumAmount ?? undefined}
          step="0.01"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="25.00"
          className={inputClass}
        />
      </label>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block space-y-1 text-sm font-medium text-slate-900">
          <span>Your name (optional)</span>
          <input value={guestName} onChange={(event) => setGuestName(event.target.value)} className={inputClass} autoComplete="name" />
        </label>
        <label className="block space-y-1 text-sm font-medium text-slate-900">
          <span>Email for your receipt (optional)</span>
          <input
            type="email"
            value={guestEmail}
            onChange={(event) => setGuestEmail(event.target.value)}
            className={inputClass}
            autoComplete="email"
          />
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-800">
        <input type="checkbox" checked={anonymous} onChange={(event) => setAnonymous(event.target.checked)} />
        Keep my name off public recognition
      </label>

      <button
        type="button"
        disabled={pending || !fundId || !(Number(amount) > 0)}
        onClick={give}
        className="w-full rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        {pending ? "Preparing…" : "Continue to secure payment"}
      </button>
    </div>
  );
}
