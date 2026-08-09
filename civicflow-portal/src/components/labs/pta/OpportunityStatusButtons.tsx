"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const NEXT_STATUS_LABEL: Record<string, { status: string; label: string }[]> = {
  // Mirrors VALID_STATUS_TRANSITIONS in volunteers.ts exactly — DRAFT can
  // also go straight to ARCHIVED there (e.g. a draft that's no longer
  // needed and was never published), which this list previously omitted.
  DRAFT: [{ status: "OPEN", label: "Publish (open for signups)" }, { status: "CANCELLED", label: "Cancel" }, { status: "ARCHIVED", label: "Archive" }],
  OPEN: [{ status: "CLOSED", label: "Close signups" }, { status: "CANCELLED", label: "Cancel" }],
  CLOSED: [{ status: "OPEN", label: "Reopen signups" }, { status: "COMPLETED", label: "Mark completed" }, { status: "CANCELLED", label: "Cancel" }],
  COMPLETED: [{ status: "ARCHIVED", label: "Archive" }],
  CANCELLED: [{ status: "ARCHIVED", label: "Archive" }],
  ARCHIVED: [],
};

export function OpportunityStatusButtons({ opportunityId, currentStatus }: { opportunityId: string; currentStatus: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function setStatus(status: string) {
    setPending(status);
    setError(null);
    try {
      const res = await fetch(`/api/labs/pta/volunteers/opportunities/${opportunityId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to change status.");
        return;
      }
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  const options = NEXT_STATUS_LABEL[currentStatus] ?? [];
  if (options.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {options.map((o) => (
        <button
          key={o.status}
          type="button"
          disabled={pending === o.status}
          onClick={() => setStatus(o.status)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
        >
          {pending === o.status ? "Working..." : o.label}
        </button>
      ))}
      {error ? <span className="text-sm text-red-700">{error}</span> : null}
    </div>
  );
}
