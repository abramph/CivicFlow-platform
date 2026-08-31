"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface HouseholdAgreementStatusLike {
  required: boolean;
  assignedVersion: { id: string; title: string; versionNumber: number; content: string } | null;
  acceptance: { acceptedAt: string; typedName: string | null } | null;
  contractLinkedBuyoutEnabled: boolean;
  contractLinkedEligibleUntil: string | null;
  contractLinkedEligibleNow: boolean;
  periodId: string;
}

/**
 * feature/pta-family-agreement-buyout, FA-6. Family web flow: read the
 * agreement, acknowledge it, and see acceptance/offer status afterward.
 * Explicitly NOT a certified e-signature — see the copy below, which
 * mirrors docs/pta-family-agreement-buyout.md's framing verbatim.
 * Acceptance alone never charges anything; the election choices this
 * offers are just links to the existing buyout election flow, unchanged by
 * this feature.
 */
export function PtaVolunteerAgreementAcceptance({ status, organizationTimezone }: { status: HouseholdAgreementStatusLike; organizationTimezone: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [typedName, setTypedName] = useState("");

  async function accept() {
    if (!acknowledged) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/labs/pta/volunteer-hours/my-household/agreement/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodId: status.periodId, acknowledged: true, typedName: typedName.trim() || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to accept the agreement.");
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (!status.assignedVersion) {
    return <p className="text-sm text-slate-500">No volunteer commitment agreement is currently required for this period.</p>;
  }

  if (status.acceptance) {
    return (
      <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-sm font-semibold text-emerald-900">
          Accepted{status.acceptance.typedName ? ` by ${status.acceptance.typedName}` : ""} on{" "}
          {new Date(status.acceptance.acceptedAt).toLocaleString(undefined, { timeZone: organizationTimezone })} ({organizationTimezone})
        </p>
        <p className="text-xs text-emerald-800">
          Agreement version: v{status.assignedVersion.versionNumber} — {status.assignedVersion.title}
        </p>
        {status.contractLinkedBuyoutEnabled ? (
          status.contractLinkedEligibleNow ? (
            <p className="text-sm text-emerald-900">
              You&apos;re eligible for contract-linked buyout pricing until{" "}
              {status.contractLinkedEligibleUntil ? new Date(status.contractLinkedEligibleUntil).toLocaleString(undefined, { timeZone: organizationTimezone }) : ""}{" "}
              ({organizationTimezone}).
            </p>
          ) : (
            <p className="text-sm text-slate-600">Your contract-linked buyout offer window has closed.</p>
          )
        ) : null}
        <details className="text-xs text-slate-600">
          <summary className="cursor-pointer font-medium">View the agreement you accepted</summary>
          <p className="mt-2 whitespace-pre-wrap">{status.assignedVersion.content}</p>
        </details>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-900">
        {status.assignedVersion.title} (v{status.assignedVersion.versionNumber})
      </h3>
      <div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded border border-slate-100 bg-slate-50 p-3 text-sm text-slate-700">
        {status.assignedVersion.content}
      </div>
      <p className="text-xs text-slate-500">
        This is an electronic acknowledgment, not a certified electronic signature. Accepting does not charge your household anything — if you later choose to
        buy out volunteer hours, that happens through a separate, clearly confirmed checkout.
      </p>
      <label className="flex items-start gap-2 text-sm text-slate-900">
        <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300" />
        <span>I have read and accept this volunteer commitment agreement on behalf of my household.</span>
      </label>
      <label className="block space-y-1 text-sm text-slate-900">
        <span>Your name (optional)</span>
        <input
          value={typedName}
          onChange={(e) => setTypedName(e.target.value)}
          className="w-full max-w-sm rounded border border-slate-300 px-2 py-1 text-sm"
          placeholder="Full name"
        />
      </label>
      <button
        type="button"
        disabled={pending || !acknowledged}
        onClick={accept}
        className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        {pending ? "Submitting..." : "Accept agreement"}
      </button>
      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
