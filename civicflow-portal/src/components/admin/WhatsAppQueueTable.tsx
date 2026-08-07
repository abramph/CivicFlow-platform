"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface QueueMessage {
  id: string;
  organizationName: string;
  phone: string;
  status: string;
  errorMessage: string | null;
  retryCount: number;
  createdAt: string;
  canRetry: boolean;
}

const STATUS_STYLES: Record<string, string> = {
  QUEUED: "bg-slate-100 text-slate-700",
  SENDING: "bg-blue-100 text-blue-800",
  SENT: "bg-slate-100 text-slate-700",
  DELIVERED: "bg-emerald-100 text-emerald-800",
  READ: "bg-emerald-100 text-emerald-800",
  FAILED: "bg-red-100 text-red-800",
  UNDELIVERED: "bg-red-100 text-red-800",
};

function QueueRow({ message }: { message: QueueMessage }) {
  const router = useRouter();
  const [pending, setPending] = useState<"retry" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "retry" | "cancel") {
    setPending(action);
    setError(null);
    try {
      const res = await fetch(`/api/admin/whatsapp/messages/${message.id}/${action}`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || `Unable to ${action} this message.`);
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to connect.");
    } finally {
      setPending(null);
    }
  }

  return (
    <tr className="border-t border-slate-100">
      <td className="px-4 py-3 text-slate-900">{new Date(message.createdAt).toLocaleString()}</td>
      <td className="px-4 py-3 text-slate-900">{message.organizationName}</td>
      <td className="px-4 py-3 font-mono text-slate-900">{message.phone}</td>
      <td className="px-4 py-3">
        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${STATUS_STYLES[message.status] ?? "bg-slate-100 text-slate-700"}`}>
          {message.status}
        </span>
      </td>
      <td className="px-4 py-3 text-slate-700">{message.retryCount}</td>
      <td className="px-4 py-3 text-slate-700">{message.errorMessage ?? "—"}</td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-2">
          {message.status === "FAILED" && message.canRetry ? (
            <button
              type="button"
              disabled={pending !== null}
              onClick={() => act("retry")}
              className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
            >
              Retry
            </button>
          ) : message.status === "FAILED" ? (
            <span className="text-xs text-slate-500" title="Template-based sends have no stored content to resend.">
              Not retryable
            </span>
          ) : null}
          {message.status === "QUEUED" || message.status === "SENDING" ? (
            <button
              type="button"
              disabled={pending !== null}
              onClick={() => act("cancel")}
              className="rounded border border-red-300 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
            >
              Cancel
            </button>
          ) : null}
        </div>
        {error ? <p className="mt-1 text-xs text-red-700">{error}</p> : null}
      </td>
    </tr>
  );
}

export function WhatsAppQueueTable({ messages }: { messages: QueueMessage[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-left text-slate-700">
          <tr>
            <th className="px-4 py-3">Time</th>
            <th className="px-4 py-3">Organization</th>
            <th className="px-4 py-3">Phone</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Retries</th>
            <th className="px-4 py-3">Error</th>
            <th className="px-4 py-3">Actions</th>
          </tr>
        </thead>
        <tbody>
          {messages.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-4 py-6 text-center text-slate-600">
                Nothing needs attention right now.
              </td>
            </tr>
          ) : (
            messages.map((message) => <QueueRow key={message.id} message={message} />)
          )}
        </tbody>
      </table>
    </div>
  );
}
