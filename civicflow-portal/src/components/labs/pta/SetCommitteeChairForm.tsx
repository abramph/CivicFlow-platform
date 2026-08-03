"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SetCommitteeChairForm({
  committeeId,
  members,
  currentChairAdultId,
  field = "chairAdultId",
  label = "chair",
}: {
  committeeId: string;
  members: { householdAdultId: string; name: string }[];
  currentChairAdultId: string | null;
  /** Which committee field this form writes — "chairAdultId" or
   * "coChairAdultId". Defaults to chair so existing call sites are
   * unaffected. */
  field?: "chairAdultId" | "coChairAdultId";
  /** Human-readable role name used in button/status text ("chair" or "co-chair"). */
  label?: string;
}) {
  const router = useRouter();
  const [chairAdultId, setChairAdultId] = useState(currentChairAdultId ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/labs/pta/committees/${committeeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: chairAdultId || null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || `Unable to set ${label}.`);
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (members.length === 0) {
    return <p className="text-xs text-slate-500">Add a member before assigning a {label}.</p>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select value={chairAdultId} onChange={(e) => setChairAdultId(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
        <option value="">No {label}</option>
        {members.map((m) => (
          <option key={m.householdAdultId} value={m.householdAdultId}>{m.name}</option>
        ))}
      </select>
      <button
        type="button"
        disabled={pending || chairAdultId === (currentChairAdultId ?? "")}
        onClick={submit}
        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
      >
        {pending ? "Saving..." : `Set ${label}`}
      </button>
      {error ? <span className="text-sm text-red-700">{error}</span> : null}
    </div>
  );
}
