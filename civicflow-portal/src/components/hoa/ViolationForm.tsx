"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ViolationForm({ properties }: { properties: { id: string; label: string }[] }) {
  const router = useRouter();
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? "");
  const [violationType, setViolationType] = useState("");
  const [description, setDescription] = useState("");
  const [cureByDate, setCureByDate] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/hoa/violations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId,
          violationType,
          description,
          cureByDate: cureByDate ? new Date(cureByDate).toISOString() : null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to create violation.");
        return;
      }
      router.push(`/hoa/violations/${data.data.id}`);
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Property</span>
        <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
          {properties.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </label>

      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Violation type</span>
        <input
          value={violationType}
          onChange={(e) => setViolationType(e.target.value)}
          placeholder="Lawn maintenance, unapproved exterior change, parking, noise, ..."
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </label>

      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Description</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          placeholder="What was observed, and when."
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </label>

      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Cure-by date (optional — can also be set when you issue the notice)</span>
        <input type="date" value={cureByDate} onChange={(e) => setCureByDate(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </label>

      <p className="text-sm text-slate-600">
        This creates a <strong>draft</strong> — nothing is sent to the resident until you issue it from the violation&apos;s own page.
      </p>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <button
        type="button"
        disabled={pending || !propertyId || !violationType.trim() || !description.trim()}
        onClick={submit}
        className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
      >
        {pending ? "Saving..." : "Save draft"}
      </button>
    </div>
  );
}
