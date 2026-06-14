"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CommunicationCampaignSendButton({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function send() {
    setSending(true);
    const response = await fetch(`/api/communications/campaigns/${campaignId}/send`, { method: "POST" });
    const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
    setSending(false);
    setMessage(payload?.ok ? "Send processed." : payload?.error || "Send failed.");
    router.refresh();
  }
  return (
    <div className="flex items-center gap-3">
      <button type="button" disabled={sending} onClick={send} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:bg-slate-400">
        {sending ? "Sending..." : "Send Campaign"}
      </button>
      {message ? <span className="text-sm text-slate-700">{message}</span> : null}
    </div>
  );
}
