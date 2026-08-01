"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function EndResidentRelationshipButton({ propertyId, residentId, memberName }: { propertyId: string; residentId: string; memberName: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/hoa/properties/${propertyId}/residents/${residentId}/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to end this relationship.");
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
      setConfirming(false);
    }
  }

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className="text-sm font-semibold text-red-700 hover:underline">
        End relationship
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span className="text-slate-700">End {memberName}&apos;s relationship to this property?</span>
      {error ? <span className="text-red-700">{error}</span> : null}
      <button type="button" disabled={pending} onClick={submit} className="font-semibold text-red-700 hover:underline disabled:opacity-60">
        {pending ? "Ending..." : "Confirm"}
      </button>
      <button type="button" onClick={() => setConfirming(false)} className="font-semibold text-slate-600 hover:underline">
        Cancel
      </button>
    </span>
  );
}
