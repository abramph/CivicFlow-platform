"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ResidentArchitecturalRequestActions({
  requestId,
  organizationId,
  status,
}: {
  requestId: string;
  organizationId: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resubmitNote, setResubmitNote] = useState("");

  async function post(path: string, body: Record<string, unknown> = {}) {
    setError(null);
    try {
      const res = await fetch(`/api/hoa/architectural-requests/my/${requestId}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, ...body }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to update the request.");
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(null);
    }
  }

  async function submit() {
    setPending("submit");
    await post("submit");
  }

  async function withdraw() {
    setPending("withdraw");
    await post("withdraw");
  }

  async function resubmit() {
    setPending("resubmit");
    await post("resubmit", { projectDescription: resubmitNote || undefined });
  }

  if (status === "DRAFT") {
    return (
      <div className="space-y-3">
        {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending === "submit"}
            onClick={submit}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
          >
            {pending === "submit" ? "Submitting…" : "Submit for review"}
          </button>
          <button
            type="button"
            disabled={pending === "withdraw"}
            onClick={withdraw}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
          >
            {pending === "withdraw" ? "Withdrawing…" : "Discard draft"}
          </button>
        </div>
      </div>
    );
  }

  if (status === "SUBMITTED") {
    return (
      <div className="space-y-3">
        {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
        <button
          type="button"
          disabled={pending === "withdraw"}
          onClick={withdraw}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
        >
          {pending === "withdraw" ? "Withdrawing…" : "Withdraw request"}
        </button>
      </div>
    );
  }

  if (status === "CHANGES_REQUESTED") {
    return (
      <div className="space-y-3">
        <label className="block space-y-1 text-sm font-medium text-slate-900">
          <span>Updated project description (optional — leave blank to resubmit unchanged)</span>
          <textarea value={resubmitNote} onChange={(e) => setResubmitNote(e.target.value)} rows={4} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending === "resubmit"}
            onClick={resubmit}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
          >
            {pending === "resubmit" ? "Resubmitting…" : "Resubmit"}
          </button>
          <button
            type="button"
            disabled={pending === "withdraw"}
            onClick={withdraw}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
          >
            {pending === "withdraw" ? "Withdrawing…" : "Withdraw request"}
          </button>
        </div>
      </div>
    );
  }

  return <p className="text-sm text-slate-600">No further action is available for this request.</p>;
}
