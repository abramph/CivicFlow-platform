"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { fieldClassName } from "@/components/forms/formStyles";

export function NewConversationForm({ memberId, memberName }: { memberId: string; memberName: string }) {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const response = await fetch("/api/messages/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberId, subject: subject.trim() || null, body: body.trim() }),
    });
    const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; data?: { id: string } } | null;
    setSaving(false);
    if (!response.ok || !payload?.ok || !payload.data?.id) {
      setError(payload?.error || "Failed to start the conversation.");
      return;
    }
    router.push(`/inbox/${payload.data.id}`);
    router.refresh();
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <label className="space-y-2 text-sm font-medium text-slate-900">
        <span>Subject (optional)</span>
        <input className={fieldClassName} value={subject} onChange={(event) => setSubject(event.target.value)} placeholder={`Message to ${memberName || "member"}`} />
      </label>
      <label className="space-y-2 text-sm font-medium text-slate-900">
        <span>Message</span>
        <textarea required rows={4} className={fieldClassName} value={body} onChange={(event) => setBody(event.target.value)} />
      </label>
      {error ? <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
      <button disabled={saving || !body.trim()} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:bg-slate-400">
        {saving ? "Sending..." : "Send"}
      </button>
    </form>
  );
}
