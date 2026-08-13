"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DuplicateOpportunityButton({ opportunityId }: { opportunityId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [repeatCount, setRepeatCount] = useState(1);

  async function duplicate() {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/labs/pta/volunteers/opportunities/${opportunityId}/duplicate`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to duplicate.");
        return;
      }
      router.push(`/labs/pta/volunteers/manage/${data.data.id}`);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  /** PTA-G recurrence: dated OPEN repeats, one per week, times carried. */
  async function repeatWeekly() {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/labs/pta/volunteers/opportunities/${opportunityId}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offsetDays: 7, count: repeatCount }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to create repeats.");
        return;
      }
      setMessage(`Created ${Array.isArray(data.data) ? data.data.length : 1} weekly repeat(s).`);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" disabled={pending} onClick={duplicate} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60">
        {pending ? "Working..." : "Duplicate"}
      </button>
      <span className="inline-flex items-center gap-1">
        <button type="button" disabled={pending} onClick={repeatWeekly} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60">
          Repeat weekly ×
        </button>
        <select
          value={repeatCount}
          onChange={(event) => setRepeatCount(Number(event.target.value))}
          disabled={pending}
          aria-label="Number of weekly repeats"
          className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
        >
          {[1, 2, 3, 4, 5, 6, 8, 10, 12].map((count) => (
            <option key={count} value={count}>
              {count}
            </option>
          ))}
        </select>
      </span>
      {message ? <span className="text-sm text-emerald-700">{message}</span> : null}
      {error ? <span className="text-sm text-red-700">{error}</span> : null}
    </span>
  );
}
