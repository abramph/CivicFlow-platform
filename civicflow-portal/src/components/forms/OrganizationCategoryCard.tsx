"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface CategoryOption {
  value: string;
  label: string;
  description: string;
  givingTerminology: string;
  memberLabel: string;
  groupsLabel: string;
}

/** CORE-GIVE-I (§2/§3) — presentation category selector. Presets are shown
 * before anything applies; applying them is a separate explicit choice. */
export function OrganizationCategoryCard({
  current,
  options,
  canWrite,
}: {
  current: string;
  options: CategoryOption[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(current);
  const [applyPresets, setApplyPresets] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedInfo = options.find((option) => option.value === selected);

  async function save() {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/organization/category", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: selected, applyPresets }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to save the category.");
        return;
      }
      setNotice(applyPresets ? "Category saved and terminology presets applied." : "Category saved.");
      setApplyPresets(false);
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">{notice}</p> : null}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {options.map((option) => (
          <label
            key={option.value}
            className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${
              selected === option.value ? "border-emerald-600 bg-emerald-50" : "border-slate-200 bg-white"
            }`}
          >
            <input
              type="radio"
              name="organization-category"
              checked={selected === option.value}
              disabled={!canWrite || pending}
              onChange={() => setSelected(option.value)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium text-slate-900">{option.label}</span>
              <span className="block text-xs text-slate-600">{option.description}</span>
            </span>
          </label>
        ))}
      </div>
      {selectedInfo ? (
        <p className="text-xs text-slate-600">
          Suggested labels for {selectedInfo.label}: giving is called{" "}
          <span className="font-semibold">“{selectedInfo.givingTerminology}”</span>, people are{" "}
          <span className="font-semibold">“{selectedInfo.memberLabel}s”</span>, groups are{" "}
          <span className="font-semibold">“{selectedInfo.groupsLabel}”</span>.
        </p>
      ) : null}
      {canWrite ? (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-800">
            <input
              type="checkbox"
              checked={applyPresets}
              disabled={pending}
              onChange={(event) => setApplyPresets(event.target.checked)}
            />
            Also apply these suggested labels
          </label>
          <button
            type="button"
            disabled={pending || (selected === current && !applyPresets)}
            onClick={save}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            Save category
          </button>
        </div>
      ) : null}
    </div>
  );
}
