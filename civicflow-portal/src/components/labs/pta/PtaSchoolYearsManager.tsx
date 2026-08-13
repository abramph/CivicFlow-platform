"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface SchoolYearLike {
  id: string;
  label: string;
  isCurrent: boolean;
}

/**
 * PTA-A school-year management (docs/pta-vertical-2.md §3): list the org's
 * years, flip the current one, and prepare the next year ahead of time —
 * creating a year never changes the active one unless explicitly requested.
 */
export function PtaSchoolYearsManager({
  years,
  suggestedNextLabel,
}: {
  years: SchoolYearLike[];
  suggestedNextLabel: string | null;
}) {
  const router = useRouter();
  const [newLabel, setNewLabel] = useState(suggestedNextLabel ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(path: string, init?: RequestInit): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...init });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to save.");
        return false;
      }
      return true;
    } catch {
      setError("Unable to connect. Please try again.");
      return false;
    } finally {
      setPending(false);
    }
  }

  async function makeCurrent(yearId: string) {
    if (await call(`/api/labs/pta/school-years/${yearId}/set-current`, { method: "POST" })) {
      router.refresh();
    }
  }

  async function addYear() {
    if (await call("/api/labs/pta/school-years", { method: "POST", body: JSON.stringify({ label: newLabel.trim() }) })) {
      router.refresh();
    }
  }

  return (
    <div className="space-y-4">
      {years.length === 0 ? (
        <p className="text-sm text-slate-600">
          No school years yet — they appear automatically as you use Unestra, or add the current one below.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {years.map((year) => (
            <li key={year.id} className="flex items-center justify-between gap-3 py-2">
              <span className="text-sm font-medium text-slate-900">
                {year.label}
                {year.isCurrent ? (
                  <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                    Current year
                  </span>
                ) : null}
              </span>
              {!year.isCurrent ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => makeCurrent(year.id)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
                >
                  Make current
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4">
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Add a school year</span>
          <input
            value={newLabel}
            onChange={(event) => setNewLabel(event.target.value)}
            placeholder="2027-2028"
            className="block w-40 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
          />
        </label>
        <button
          type="button"
          disabled={pending || !newLabel.trim()}
          onClick={addYear}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          Add year
        </button>
        <p className="w-full text-xs text-slate-500">
          Adding a year lets you prepare next year&apos;s board and programs early — it does not change the current year.
        </p>
      </div>

      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
