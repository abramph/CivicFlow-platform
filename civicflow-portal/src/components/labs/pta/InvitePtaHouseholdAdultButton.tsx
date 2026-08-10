"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function InvitePtaHouseholdAdultButton({ householdId, adultId }: { householdId: string; adultId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function sendInvite() {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/labs/pta/households/${householdId}/adults/${adultId}/invite`, { method: "POST" });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;

      if (!response.ok || !payload?.ok) {
        setMessage(payload?.error || "Failed to send app invite.");
        return;
      }

      setMessage("Invite email sent.");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={sendInvite}
        disabled={pending}
        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
      >
        {pending ? "Sending..." : "Invite to app"}
      </button>
      {message ? <p className="text-xs text-slate-500">{message}</p> : null}
    </div>
  );
}
