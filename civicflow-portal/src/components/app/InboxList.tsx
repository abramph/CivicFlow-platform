"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export type InboxConversation = {
  id: string;
  subject: string | null;
  lastMessageAt: string | null;
  hasUnread: boolean;
  otherParticipants: { userId: string; displayName: string; role: string }[];
};

const POLL_INTERVAL_MS = 20_000;

export function InboxList({ initialConversations }: { initialConversations: InboxConversation[] }) {
  const [conversations, setConversations] = useState(initialConversations);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const response = await fetch("/api/messages/conversations");
        if (!response.ok) return;
        const payload = (await response.json()) as { ok: boolean; data?: InboxConversation[] };
        if (!cancelled && payload.ok && payload.data) {
          setConversations(payload.data);
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
  }, []);

  if (conversations.length === 0) {
    return <p className="text-sm text-slate-600">No conversations yet.</p>;
  }

  return (
    <ul className="divide-y divide-slate-100">
      {conversations.map((conversation) => {
        const names = conversation.otherParticipants.map((p) => p.displayName).join(", ") || "Conversation";
        return (
          <li key={conversation.id}>
            <Link
              href={`/inbox/${conversation.id}`}
              className="flex items-center justify-between gap-4 px-2 py-3 hover:bg-slate-50"
            >
              <div className="min-w-0">
                <p className={conversation.hasUnread ? "truncate font-semibold text-slate-950" : "truncate font-medium text-slate-800"}>
                  {names}
                </p>
                {conversation.subject ? <p className="truncate text-sm text-slate-600">{conversation.subject}</p> : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {conversation.hasUnread ? <span className="h-2 w-2 rounded-full bg-emerald-600" aria-label="Unread" /> : null}
                <span className="text-xs text-slate-500">
                  {conversation.lastMessageAt ? new Date(conversation.lastMessageAt).toLocaleString() : ""}
                </span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
