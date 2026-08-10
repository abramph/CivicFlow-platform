"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  slotId: string;
  alreadySignedUp: boolean;
  /** Whether claimPtaVolunteerSlot() would actually accept this claim right
   * now — computed page-side from the same facts the server checks (slot
   * status, signup deadline, capacity), so a guaranteed-rejection action is
   * never rendered as clickable in the first place. */
  claimable: boolean;
  /** Why claiming isn't available, when it isn't — drives the label shown
   * in place of the button. Ignored when claimable is true. */
  unavailableReason: "full" | "closed" | "deadline_passed" | null;
  /** Whether cancelPtaVolunteerSignup() would actually accept a cancel right
   * now — false once the opportunity's cancellation deadline has passed
   * (a known-in-advance fact, not a race), independent of slot open/closed
   * state, matching the server exactly. */
  cancellable: boolean;
}

const UNAVAILABLE_LABEL: Record<NonNullable<Props["unavailableReason"]>, string> = {
  full: "Full",
  closed: "Not open for signups",
  deadline_passed: "Signup deadline passed",
};

export function VolunteerSlotClaimButton({ slotId, alreadySignedUp, claimable, unavailableReason, cancellable }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "claim" | "cancel") {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/labs/pta/volunteers/slots/${slotId}/${action}`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Action failed.");
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (alreadySignedUp) {
    return (
      <div className="flex items-center gap-2">
        {error ? <span className="text-xs text-red-700">{error}</span> : null}
        {cancellable ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => act("cancel")}
            className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
          >
            {pending ? "Cancelling..." : "Cancel signup"}
          </button>
        ) : (
          <span className="text-xs text-slate-500">Cancellation deadline passed — contact your volunteer coordinator</span>
        )}
      </div>
    );
  }

  if (!claimable) {
    return <span className="text-xs font-semibold text-slate-500">{unavailableReason ? UNAVAILABLE_LABEL[unavailableReason] : "Not available"}</span>;
  }

  return (
    <div className="flex items-center gap-2">
      {error ? <span className="text-xs text-red-700">{error}</span> : null}
      <button
        type="button"
        disabled={pending}
        onClick={() => act("claim")}
        className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
      >
        {pending ? "Claiming..." : "Claim slot"}
      </button>
    </div>
  );
}
