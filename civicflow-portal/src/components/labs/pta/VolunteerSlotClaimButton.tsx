"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function VolunteerSlotClaimButton({ slotId, full, alreadySignedUp }: { slotId: string; full: boolean; alreadySignedUp: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "claim" | "cancel") {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/labs/pta/volunteers/slots/${slotId}/${action}`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Action failed.");
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (alreadySignedUp) {
    return (
      <div className="flex items-center gap-2">
        {error ? <span className="text-xs text-red-700">{error}</span> : null}
        <button
          type="button"
          disabled={pending}
          onClick={() => act("cancel")}
          className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
        >
          {pending ? "Cancelling..." : "Cancel signup"}
        </button>
      </div>
    );
  }

  if (full) {
    return <span className="text-xs font-semibold text-slate-500">Full</span>;
  }

  return (
    <div className="flex items-center gap-2">
      {error ? <span className="text-xs text-red-700">{error}</span> : null}
      <button
        type="button"
        disabled={pending}
        onClick={() => act("claim")}
        className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
      >
        {pending ? "Claiming..." : "Claim slot"}
      </button>
    </div>
  );
}
