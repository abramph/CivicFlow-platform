"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { fieldClassName, helperTextClassName } from "@/components/forms/formStyles";

interface WhatsAppSenderView {
  fromNumber: string | null;
  messagingServiceSid: string | null;
  accountSidMasked: string | null;
  senderSource: "database" | "env" | "unconfigured";
}

const SOURCE_LABEL: Record<WhatsAppSenderView["senderSource"], string> = {
  database: "Configured via this dashboard",
  env: "Falling back to WHATSAPP_SANDBOX_FROM_NUMBER (legacy)",
  unconfigured: "Not configured",
};

/**
 * Only the WhatsApp-specific sender identity is editable here — account
 * credentials (Account SID/Auth Token) are shared with SMS and already
 * managed on the SMS Administration page's Twilio Configuration panel; this
 * page just displays the masked Account SID for confirmation, read-only.
 */
export function WhatsAppSenderPanel({ sender }: { sender: WhatsAppSenderView }) {
  const router = useRouter();
  const [form, setForm] = useState({ fromNumber: "", messagingServiceSid: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function setField(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    const body = Object.fromEntries(Object.entries(form).filter(([, value]) => value.trim() !== ""));
    if (Object.keys(body).length === 0) {
      setError("Enter at least one field to update.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/whatsapp/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to save the sender identity.");
        return;
      }
      setSaved(true);
      setForm({ fromNumber: "", messagingServiceSid: "" });
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm md:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Account SID</p>
          <p className="font-mono text-slate-900">{sender.accountSidMasked ?? "Not configured"}</p>
          <p className="text-xs text-slate-500">Shared with SMS — managed on the SMS Administration page.</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">From Number</p>
          <p className="font-mono text-slate-900">{sender.fromNumber ?? "Not set"}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Messaging Service SID</p>
          <p className="font-mono text-slate-900">{sender.messagingServiceSid ?? "Not set"}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Source</p>
          <p className="text-slate-900">{SOURCE_LABEL[sender.senderSource]}</p>
        </div>
      </div>

      <form className="space-y-3" onSubmit={handleSave}>
        <p className="text-sm font-medium text-slate-900">Update sender identity</p>
        <p className={helperTextClassName}>Leave a field blank to keep its current value. Set either the From Number or a Messaging Service SID (not both).</p>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block space-y-1 text-sm text-slate-700">
            <span>From Number</span>
            <input className={fieldClassName} value={form.fromNumber} onChange={(e) => setField("fromNumber", e.target.value)} placeholder="+14155238886" />
          </label>
          <label className="block space-y-1 text-sm text-slate-700">
            <span>Messaging Service SID</span>
            <input className={fieldClassName} value={form.messagingServiceSid} onChange={(e) => setField("messagingServiceSid", e.target.value)} placeholder="MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
          </label>
        </div>

        {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
        {saved ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Sender identity saved.</div> : null}

        <button
          disabled={saving}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save Sender Identity"}
        </button>
      </form>
    </div>
  );
}
