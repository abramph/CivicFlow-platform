"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface HouseholdAdultResult {
  id: string;
  name: string;
  householdName: string;
}

export function ManualAssignVolunteerForm({ slotId, isFull }: { slotId: string; isFull: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<HouseholdAdultResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overrideCapacity, setOverrideCapacity] = useState(false);

  async function search() {
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const res = await fetch(`/api/labs/pta/households?search=${encodeURIComponent(query)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError("Unable to search households.");
        return;
      }
      type HouseholdRow = { displayName: string; adults: { id: string; name: string }[] };
      const adults: HouseholdAdultResult[] = (data.data as HouseholdRow[]).flatMap((h) => h.adults.map((a) => ({ id: a.id, name: a.name, householdName: h.displayName })));
      setResults(adults);
    } finally {
      setSearching(false);
    }
  }

  async function assign(householdAdultId: string) {
    setPending(householdAdultId);
    setError(null);
    try {
      const res = await fetch(`/api/labs/pta/volunteers/slots/${slotId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ householdAdultId, overrideCapacity }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to assign volunteer.");
        return;
      }
      setResults([]);
      setQuery("");
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-2 rounded-lg bg-slate-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="Search a parent to assign"
          className="w-56 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
        />
        <button type="button" disabled={searching || !query.trim()} onClick={search} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60">
          {searching ? "Searching..." : "Search"}
        </button>
        {isFull ? (
          <label className="flex items-center gap-1.5 text-xs text-amber-800">
            <input type="checkbox" checked={overrideCapacity} onChange={(e) => setOverrideCapacity(e.target.checked)} />
            This shift is full — override capacity (audited)
          </label>
        ) : null}
      </div>
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
      {results.length > 0 ? (
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {results.map((r) => (
            <li key={r.id} className="flex items-center justify-between px-3 py-1.5 text-xs">
              <span>{r.name} <span className="text-slate-500">— {r.householdName}</span></span>
              <button
                type="button"
                disabled={pending === r.id || (isFull && !overrideCapacity)}
                onClick={() => assign(r.id)}
                className="rounded-lg bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
              >
                {pending === r.id ? "Assigning..." : "Assign"}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
