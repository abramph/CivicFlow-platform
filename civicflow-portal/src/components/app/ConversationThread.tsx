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
const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

export function ConversationThread({
  conversationId,
  currentUserId,
  initialMessages,
  channel = null,
  lastInboundAt = null,
}: {
  conversationId: string;
  currentUserId: string;
  initialMessages: ThreadMessage[];
  channel?: string | null;
  lastInboundAt?: string | null;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [windowInfo, setWindowInfo] = useState({ channel, lastInboundAt });
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Date.now() is impure — React forbids calling it directly during render
  // (react-hooks/purity). Tracked as state instead, seeded and refreshed
  // from effects, so the window-open calculation below stays a pure
  // function of props/state.
  const [now, setNow] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const response = await fetch(`/api/messages/conversations/${conversationId}`);
        if (!response.ok) return;
        const payload = (await response.json()) as {
          ok: boolean;
          data?: { messages: ThreadMessage[]; channel: string | null; lastInboundAt: string | null };
        };
        if (!cancelled && payload.ok && payload.data) {
          setMessages(payload.data.messages);
          setWindowInfo({ channel: payload.data.channel, lastInboundAt: payload.data.lastInboundAt });
        }
      } catch {
        // Transient network error — the next poll tick will retry.
      }
      if (!cancelled) setNow(Date.now());
    }

    const seedTimer = setTimeout(() => {
      if (!cancelled) setNow(Date.now());
    }, 0);
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(seedTimer);
      clearInterval(interval);
    };
  }, [conversationId]);

  const isWhatsApp = windowInfo.channel === "WHATSAPP";
  const windowOpen =
    isWhatsApp && Boolean(windowInfo.lastInboundAt) && now !== null && now - new Date(windowInfo.lastInboundAt as string).getTime() < WHATSAPP_WINDOW_MS;
  const windowClosesAt =
    isWhatsApp && windowInfo.lastInboundAt ? new Date(new Date(windowInfo.lastInboundAt).getTime() + WHATSAPP_WINDOW_MS) : null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch(`/api/messages/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: trimmed }),
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        data?: { id: string; createdAt: string; whatsappSent?: boolean; whatsappWindowOpen?: boolean };
      } | null;
      if (!response.ok || !payload?.ok || !payload.data) {
        setError(payload?.error || "Failed to send message.");
        setSending(false);
        return;
      }
      setMessages((current) => [
        ...current,
        { id: payload.data!.id, body: trimmed, senderUserId: currentUserId, senderDisplayName: "You", createdAt: payload.data!.createdAt },
      ]);
      if (isWhatsApp && !payload.data.whatsappWindowOpen) {
        setWindowInfo((current) => ({ ...current, lastInboundAt: null }));
      }
      setBody("");
      setSending(false);
    } catch {
      setError("Unable to connect. Please try again.");
      setSending(false);
    }
  }

  return (
    <div className="space-y-4">
      {isWhatsApp ? (
        windowOpen ? (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-800">
            WhatsApp customer-service window open until {windowClosesAt?.toLocaleString()} — replies will also be sent over WhatsApp.
          </p>
        ) : (
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
            Outside the WhatsApp window — replies are in-app only until this member messages again.
          </p>
        )
      ) : null}
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
