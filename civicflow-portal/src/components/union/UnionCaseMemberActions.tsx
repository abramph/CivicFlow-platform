"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Mirrors the WITHDRAWN row of TRANSITIONS in src/lib/union/cases.ts:
// reachable from NEW/TRIAGE/ASSIGNED/ACTIVE/PENDING, never from a
// RESOLVED/CLOSED/already-WITHDRAWN case. Kept in sync manually since this
// is a client component; a mismatch here only affects whether the button
// is OFFERED, never what's actually allowed (the API route re-validates
// independently via requireUnionCaseMemberAccess + the real state machine).
const WITHDRAWABLE_STATUSES = ["NEW", "TRIAGE", "ASSIGNED", "ACTIVE", "PENDING"];

export function UnionCaseMemberActions({ caseId, organizationId, status }: { caseId: string; organizationId: string; status: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function withdraw() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/union/cases/my/${caseId}/withdraw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to withdraw this case.");
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (!WITHDRAWABLE_STATUSES.includes(status)) {
    return null;
  }

  return (
    <div className="space-y-2">
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        disabled={pending}
        onClick={withdraw}
        className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
      >
        {pending ? "Withdrawing…" : "Withdraw this case"}
      </button>
    </div>
  );
}
