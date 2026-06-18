"use client";

import { useState } from "react";

interface Props {
  initialAmountCents: number;
  initialDate: string | null;
  canWrite: boolean;
}

function centsToDisplay(cents: number): string {
  if (!cents) return "";
  return (cents / 100).toFixed(2);
}

export function OpeningBalanceForm({ initialAmountCents, initialDate, canWrite }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const [amount, setAmount] = useState(centsToDisplay(initialAmountCents));
  const [date, setDate] = useState(initialDate ?? today);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const dollars = parseFloat(amount.replace(/[^0-9.]/g, "")) || 0;
      const amountCents = Math.round(dollars * 100);
      const res = await fetch("/api/settings/opening-balance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountCents, date: date || null }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Save failed");
      setMessage({ type: "success", text: "Opening balance saved." });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Save failed." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        If you migrated from another platform, enter the account balance you had on the day you switched to CivicFlow. Leave at $0.00 if you&apos;re starting fresh.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Balance amount ($)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            disabled={!canWrite}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-50 disabled:text-slate-400"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">As of date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={!canWrite}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-50 disabled:text-slate-400"
          />
        </div>
      </div>

      {canWrite && (
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save Opening Balance"}
        </button>
      )}

      {message && (
        <p className={`text-sm ${message.type === "success" ? "text-emerald-700" : "text-red-700"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
