"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function InviteMemberToAppButton({ memberId }: { memberId: string }) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function sendInvite() {
    setSending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/members/${memberId}/invite`, { method: "POST" });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;

      if (!response.ok || !payload?.ok) {
        setMessage(payload?.error || "Failed to send app invite.");
        return;
      }

      setMessage("Invite email sent.");
      router.refresh();
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={sendInvite}
        disabled={sending}
        className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
      >
        {sending ? "Sending..." : "Invite to Mobile App"}
      </button>
      {message ? <p className="text-sm text-slate-700">{message}</p> : null}
    </div>
  );
}
