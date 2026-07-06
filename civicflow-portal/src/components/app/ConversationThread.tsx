"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { fieldClassName } from "@/components/forms/formStyles";

export type ThreadMessage = {
  id: string;
  body: string;
  senderUserId: string;
  senderDisplayName: string;
  createdAt: string;
};

const POLL_INTERVAL_MS = 15_000;

export function ConversationThread({
  conversationId,
  currentUserId,
  initialMessages,
}: {
  conversationId: string;
  currentUserId: string;
  initialMessages: ThreadMessage[];
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const response = await fetch(`/api/messages/conversations/${conversationId}`);
        if (!response.ok) return;
        const payload = (await response.json()) as { ok: boolean; data?: { messages: ThreadMessage[] } };
        if (!cancelled && payload.ok && payload.data) {
          setMessages(payload.data.messages);
        }
      } catch {
        // Transient network error — the next poll tick will retry.
      }
    }

    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;
    setSending(true);
    setError(null);
    const response = await fetch(`/api/messages/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: trimmed }),
    });
    const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; data?: { id: string; createdAt: string } } | null;
    setSending(false);
    if (!response.ok || !payload?.ok || !payload.data) {
      setError(payload?.error || "Failed to send message.");
      return;
    }
    setMessages((current) => [
      ...current,
      { id: payload.data!.id, body: trimmed, senderUserId: currentUserId, senderDisplayName: "You", createdAt: payload.data!.createdAt },
    ]);
    setBody("");
  }

  return (
    <div className="space-y-4">
      <div className="max-h-96 space-y-3 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-4">
        {messages.length === 0 ? (
          <p className="text-sm text-slate-600">No messages yet.</p>
        ) : (
          messages.map((message) => {
            const isMine = message.senderUserId === currentUserId;
            return (
              <div key={message.id} className={isMine ? "flex justify-end" : "flex justify-start"}>
                <div className={isMine ? "max-w-[80%] rounded-xl bg-emerald-700 px-4 py-2 text-white" : "max-w-[80%] rounded-xl bg-white px-4 py-2 text-slate-900 shadow-sm"}>
                  {!isMine ? <p className="text-xs font-semibold text-slate-600">{message.senderDisplayName}</p> : null}
                  <p className="whitespace-pre-wrap text-sm">{message.body}</p>
                  <p className={isMine ? "mt-1 text-right text-xs text-emerald-100" : "mt-1 text-xs text-slate-500"}>
                    {new Date(message.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {error ? <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}

      <form className="flex gap-2" onSubmit={submit}>
        <textarea
          rows={2}
          className={fieldClassName}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Write a reply..."
        />
        <button disabled={sending || !body.trim()} className="shrink-0 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:bg-slate-400">
          {sending ? "Sending..." : "Send"}
        </button>
      </form>
    </div>
  );
}
