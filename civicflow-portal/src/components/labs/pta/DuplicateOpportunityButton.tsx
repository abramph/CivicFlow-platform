"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DuplicateOpportunityButton({ opportunityId }: { opportunityId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function duplicate() {
    setPending(true);
    setError(null);
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

  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" disabled={pending} onClick={duplicate} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60">
        {pending ? "Duplicating..." : "Duplicate"}
      </button>
      {error ? <span className="text-sm text-red-700">{error}</span> : null}
    </span>
  );
}
