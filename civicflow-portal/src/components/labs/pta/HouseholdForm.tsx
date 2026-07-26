"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function HouseholdForm({ defaultSchoolYear }: { defaultSchoolYear: string }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [schoolYear, setSchoolYear] = useState(defaultSchoolYear);
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/labs/pta/households", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, schoolYear, notes: notes || null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to create household.");
        return;
      }
      router.push(`/labs/pta/households/${data.data.id}`);
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Household name</span>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="The Kim Household"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>School year</span>
          <input value={schoolYear} onChange={(e) => setSchoolYear(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
      </div>
      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Notes (optional)</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </label>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <button
        type="button"
        disabled={pending || !displayName.trim() || !schoolYear.trim()}
        onClick={submit}
        className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
      >
        {pending ? "Creating..." : "Create household"}
      </button>
    </div>
  );
}
