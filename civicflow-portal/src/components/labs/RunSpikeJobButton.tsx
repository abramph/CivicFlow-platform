"use client";

import { useState } from "react";
import { centsToDollarsDisplay } from "@/lib/labs/meeting-intelligence/cost-model";

interface SpikeRunResult {
  providerId: string;
  transcript: { durationMs: number; fullText: string; segments: { speakerLabel: string; text: string }[] };
  draftMinutes: { status: string; motions: unknown[]; actionItems: unknown[]; aiDisclaimer: string };
  costCents: { totalCents: number };
}

export function RunSpikeJobButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SpikeRunResult | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/labs/meeting-intelligence-spike/run", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to run the spike pipeline.");
        return;
      }
      setResult(data.data);
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
        className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
      >
        {pending ? "Running..." : "Run a synthetic job"}
      </button>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {result ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
          <p className="font-semibold text-slate-900">
            Provider: {result.providerId} · Duration: {(result.transcript.durationMs / 60_000).toFixed(1)} min · Estimated cost:{" "}
            {centsToDollarsDisplay(result.costCents.totalCents)}
          </p>
          <p className="mt-2 text-slate-700">Draft minutes status: {result.draftMinutes.status}</p>
          <p className="text-xs text-slate-500">{result.draftMinutes.aiDisclaimer}</p>
        </div>
      ) : null}
    </div>
  );
}
