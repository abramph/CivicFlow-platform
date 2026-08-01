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

export interface PropertyEditDefaults {
  id: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  unitLabel: string | null;
  buildingLabel: string | null;
  propertyType: string;
  displayName: string | null;
  notes: string | null;
}

export function PropertyEditForm({ property }: { property: PropertyEditDefaults }) {
  const router = useRouter();
  const [addressLine1, setAddressLine1] = useState(property.addressLine1);
  const [addressLine2, setAddressLine2] = useState(property.addressLine2 ?? "");
  const [city, setCity] = useState(property.city ?? "");
  const [state, setState] = useState(property.state ?? "");
  const [zipCode, setZipCode] = useState(property.zipCode ?? "");
  const [unitLabel, setUnitLabel] = useState(property.unitLabel ?? "");
  const [buildingLabel, setBuildingLabel] = useState(property.buildingLabel ?? "");
  const [propertyType, setPropertyType] = useState(property.propertyType);
  const [displayName, setDisplayName] = useState(property.displayName ?? "");
  const [notes, setNotes] = useState(property.notes ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/hoa/properties/${property.id}`, {
        method: "PATCH",
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
        setError(data?.error || "Unable to save changes.");
        return;
      }
      router.push(`/hoa/properties/${property.id}`);
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

      {propertyType === "COMMON_PROPERTY" ? (
        <label className="block space-y-1 text-sm font-medium text-slate-900">
          <span>Name</span>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Street address</span>
          <input value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Address line 2 (optional)</span>
          <input value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Unit / lot number (optional)</span>
          <input value={unitLabel} onChange={(e) => setUnitLabel(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Building (optional)</span>
          <input value={buildingLabel} onChange={(e) => setBuildingLabel(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
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
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending || !addressLine1.trim()}
          onClick={submit}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
        >
          {pending ? "Saving..." : "Save changes"}
        </button>
      </div>
    </div>
  );
}
