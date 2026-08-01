"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const PROPERTY_TYPES: { value: string; label: string }[] = [
  { value: "SINGLE_FAMILY", label: "Single-family lot" },
  { value: "CONDO_UNIT", label: "Condo unit" },
  { value: "TOWNHOME", label: "Townhome" },
  { value: "VACANT_LOT", label: "Vacant lot" },
  { value: "COMMON_PROPERTY", label: "Common property (clubhouse, pool, etc.)" },
  { value: "OTHER", label: "Other" },
];

export function PropertyForm() {
  const router = useRouter();
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [unitLabel, setUnitLabel] = useState("");
  const [buildingLabel, setBuildingLabel] = useState("");
  const [propertyType, setPropertyType] = useState("SINGLE_FAMILY");
  const [displayName, setDisplayName] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCommon = propertyType === "COMMON_PROPERTY";

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/hoa/properties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          addressLine1,
          addressLine2: addressLine2 || null,
          city: city || null,
          state: state || null,
          zipCode: zipCode || null,
          unitLabel: unitLabel || null,
          buildingLabel: buildingLabel || null,
          propertyType,
          displayName: displayName || null,
          notes: notes || null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to create property.");
        return;
      }
      router.push(`/hoa/properties/${data.data.id}`);
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
        <span>Property type</span>
        <select value={propertyType} onChange={(e) => setPropertyType(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
          {PROPERTY_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </label>

      {isCommon ? (
        <label className="block space-y-1 text-sm font-medium text-slate-900">
          <span>Name</span>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Clubhouse" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Street address</span>
          <input value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} placeholder="123 Oak Ridge Dr" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Address line 2 (optional)</span>
          <input value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Unit / lot number (optional)</span>
          <input value={unitLabel} onChange={(e) => setUnitLabel(e.target.value)} placeholder="Unit 4B or Lot 12" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Building (optional)</span>
          <input value={buildingLabel} onChange={(e) => setBuildingLabel(e.target.value)} placeholder="Building C" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>City</span>
          <input value={city} onChange={(e) => setCity(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>State</span>
          <input value={state} onChange={(e) => setState(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>ZIP code</span>
          <input value={zipCode} onChange={(e) => setZipCode(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
      </div>

      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Notes (board-only — never shown to residents)</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </label>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <button
        type="button"
        disabled={pending || !addressLine1.trim()}
        onClick={submit}
        className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
      >
        {pending ? "Creating..." : "Create property"}
      </button>
    </div>
  );
}
