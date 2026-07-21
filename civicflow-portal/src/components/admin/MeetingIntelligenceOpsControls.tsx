"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StatusPill } from "@/components/admin/OperationsUI";
import type { ServiceHealth } from "@/lib/platform-operations/types";

/** Inline two-step confirm, mirroring LabEnrollmentControls.tsx's pattern. */
export function RetryFailedJobButton({ jobId, retryable }: { jobId: string; retryable: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!retryable) {
    return <span className="text-xs text-slate-500">Not retryable</span>;
  }

  async function apply() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/meeting-intelligence/jobs/${jobId}/retry`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to retry this job.");
        setConfirming(false);
        return;
      }
      router.refresh();
      setConfirming(false);
    } catch {
      setError("Unable to connect. Please try again.");
      setConfirming(false);
    } finally {
      setPending(false);
    }
  }

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="text-xs text-slate-700">Retry this job?</span>
        <button
          type="button"
          disabled={pending}
          onClick={apply}
          className="rounded-md bg-emerald-700 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
        >
          {pending ? "Retrying..." : "Yes"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setConfirming(false)}
          className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      {error ? <span className="text-xs text-red-700">{error}</span> : null}
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-900 hover:bg-slate-50"
      >
        Retry
      </button>
    </span>
  );
}

/** Explicit, admin-triggered live reachability check — never runs automatically. */
export function RunLiveDiagnosticsButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ServiceHealth[] | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/meeting-intelligence/diagnostics", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Diagnostics failed to run.");
        return;
      }
      setResults(data.data);
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled={pending}
        onClick={run}
        className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
      >
        {pending ? "Running..." : "Run live diagnostics"}
      </button>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {results ? (
        <div className="space-y-2">
          {results.map((service) => (
            <div key={service.service} className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">{service.service}</p>
                <p className="text-xs text-slate-600">{service.message}</p>
                {service.responseTimeMs != null ? <p className="text-xs text-slate-500">{service.responseTimeMs}ms</p> : null}
              </div>
              <StatusPill status={service.status} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
