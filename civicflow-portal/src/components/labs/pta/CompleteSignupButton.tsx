"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CompleteSignupButton({ signupId }: { signupId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [hours, setHours] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/labs/pta/volunteers/signups/${signupId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hoursLogged: hours ? Number(hours) : null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to mark completed.");
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-900 hover:bg-slate-50">
        Mark completed
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <input value={hours} onChange={(e) => setHours(e.target.value)} type="number" min={0} step="0.25" placeholder="Hours" className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-xs" />
      {error ? <span className="text-xs text-red-700">{error}</span> : null}
      <button type="button" disabled={pending} onClick={submit} className="rounded-lg bg-emerald-700 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">
        {pending ? "Saving..." : "Confirm"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs font-semibold text-slate-600 hover:underline">
        Cancel
      </button>
    </span>
  );
}
