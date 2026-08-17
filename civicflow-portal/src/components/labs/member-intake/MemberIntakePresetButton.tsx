"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { OrganizationVertical } from "@prisma/client";

export function MemberIntakePresetButton({
  vertical,
  presetName,
  fieldCount,
}: {
  vertical: OrganizationVertical;
  presetName: string;
  fieldCount: number;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function useThisPreset() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/member-intake/forms/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vertical }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to create this form.");
        return;
      }
      router.push(`/labs/member-intake/forms/${data.data.id}`);
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-sm font-semibold text-slate-900">{presetName}</p>
        <p className="text-sm text-slate-600">Starts with {fieldCount} fields, ready to review and publish.</p>
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={useThisPreset}
        className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        {pending ? "Creating…" : "Use this preset"}
      </button>
      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
