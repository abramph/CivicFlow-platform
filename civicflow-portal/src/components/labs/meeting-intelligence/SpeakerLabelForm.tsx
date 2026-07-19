"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SpeakerLabelForm({ jobId, speakerLabels, currentMap }: { jobId: string; speakerLabels: string[]; currentMap: Record<string, string> }) {
  const router = useRouter();
  const [names, setNames] = useState<Record<string, string>>(currentMap);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setPending(true);
    setError(null);
    try {
      const labelMap = Object.fromEntries(Object.entries(names).filter(([, value]) => value.trim().length > 0));
      const response = await fetch(`/api/labs/meeting-intelligence/jobs/${jobId}/transcript/speaker-labels`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labelMap }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        setError(payload?.error || "Unable to save speaker names.");
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-4">
      <p className="text-sm font-semibold text-slate-900">Rename speakers (display only — not verified identity)</p>
      <div className="grid gap-3 md:grid-cols-2">
        {speakerLabels.map((label) => (
          <label key={label} className="space-y-1 text-xs font-medium text-slate-700">
            <span>{label}</span>
            <input
              value={names[label] ?? ""}
              onChange={(event) => setNames((current) => ({ ...current, [label]: event.target.value }))}
              placeholder="Attendee name"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
        ))}
      </div>
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
      <button
        type="button"
        disabled={pending}
        onClick={save}
        className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
      >
        {pending ? "Saving..." : "Save Speaker Names"}
      </button>
    </div>
  );
}
