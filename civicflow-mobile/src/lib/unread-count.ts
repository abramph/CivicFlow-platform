import { useEffect, useState } from 'react';

import { getConversations, type ConversationSummary } from '@/lib/mobile-api';

/** Pure counting logic, extracted so it's testable without rendering the hook. */
export function countUnreadConversations(conversations: ConversationSummary[]): number {
  return conversations.filter((c) => c.hasUnread).length;
}

/**
 * Polls the caller's conversation list and counts how many have an unread
 * message, for use as both the Inbox tab badge and the Home dashboard's
 * unread count. Best-effort — a failed poll just leaves the count as-is
 * rather than surfacing an error, since this is a secondary indicator.
 */
export function useUnreadConversationCount(organizationId: string | null, intervalMs = 30_000) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!organizationId) return;

    let cancelled = false;
    async function poll() {
      try {
        const conversations = await getConversations(organizationId!);
        if (!cancelled) setCount(countUnreadConversations(conversations));
      } catch {
        // Best-effort — badge just doesn't update this tick.
      }
    }

    poll();
    const timer = setInterval(poll, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [organizationId, intervalMs]);

  return organizationId ? count : 0;
}
